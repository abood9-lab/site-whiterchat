import { assertValidIdentifier } from '~/lib/.server/security/auth';
import { flushWorkspaceVolumeChanges, stopProjectSandbox } from './client';

export const HEARTBEAT_EXPIRE_MS = 120_000; // 2 minutes grace before automatic sandbox shutdown
export const LOGOUT_OPERATION_WAIT_MS = 8_000;
const SWEEP_INTERVAL_MS = 15_000;

export interface ActivePresenceSession {
  sessionId: string;
  userId: string;
  projectId: string;
  sandboxId: string;
  lastHeartbeatAt: number;
  createdAt: number;
}

interface PendingStopTimer {
  timer: ReturnType<typeof setTimeout>;
  scheduledAt: number;
}

const sessions = new Map<string, ActivePresenceSession>();
const projectOperations = new Map<string, Set<string>>();
const pendingShutdowns = new Map<string, PendingStopTimer>();
const shutdownLocks = new Set<string>();
const projectSandboxMap = new Map<string, { userId: string; projectId: string; sandboxId: string }>();
const lifecycleAuditLog: Array<{ timestamp: string; event: string; projectId: string; userId: string; sandboxId: string; detail?: string }> = [];

function projKey(userId: string, projectId: string): string {
  return `${userId}:${projectId}`;
}

function recordLifecycleEvent(
  event: string,
  userId: string,
  projectId: string,
  sandboxId: string,
  detail?: string,
) {
  lifecycleAuditLog.unshift({
    timestamp: new Date().toISOString(),
    event,
    userId,
    projectId,
    sandboxId,
    detail,
  });
  if (lifecycleAuditLog.length > 100) {
    lifecycleAuditLog.length = 100;
  }
}

function cancelPendingShutdown(key: string) {
  const existing = pendingShutdowns.get(key);
  if (existing) {
    clearTimeout(existing.timer);
    pendingShutdowns.delete(key);
  }
}

export function getActiveSessionsForProject(userId: string, projectId: string): ActivePresenceSession[] {
  const results: ActivePresenceSession[] = [];
  for (const session of sessions.values()) {
    if (session.userId === userId && session.projectId === projectId) {
      results.push(session);
    }
  }
  return results;
}

export function getActiveOperationsCount(userId: string, projectId: string): number {
  return projectOperations.get(projKey(userId, projectId))?.size ?? 0;
}

export function registerWorkspaceSession(params: {
  sessionId: string;
  userId: string;
  projectId: string;
  sandboxId: string;
}): ActivePresenceSession {
  const sessionId = assertValidIdentifier(params.sessionId, 'sessionId');
  const userId = assertValidIdentifier(params.userId, 'userId');
  const projectId = assertValidIdentifier(params.projectId, 'projectId');
  const now = Date.now();
  const key = projKey(userId, projectId);

  // User returned or opened another tab -> cancel any pending auto-shutdown
  cancelPendingShutdown(key);

  const session: ActivePresenceSession = {
    sessionId,
    userId,
    projectId,
    sandboxId: params.sandboxId,
    lastHeartbeatAt: now,
    createdAt: sessions.get(sessionId)?.createdAt ?? now,
  };

  sessions.set(sessionId, session);
  projectSandboxMap.set(key, { userId, projectId, sandboxId: params.sandboxId });
  recordLifecycleEvent('session_active', userId, projectId, params.sandboxId, sessionId);
  return session;
}

export function heartbeatWorkspaceSession(params: {
  sessionId: string;
  userId: string;
  projectId: string;
  sandboxId?: string;
}): ActivePresenceSession | null {
  const sessionId = assertValidIdentifier(params.sessionId, 'sessionId');
  const userId = assertValidIdentifier(params.userId, 'userId');
  const projectId = assertValidIdentifier(params.projectId, 'projectId');
  const key = projKey(userId, projectId);

  cancelPendingShutdown(key);

  const existing = sessions.get(sessionId);
  if (existing) {
    if (existing.userId !== userId || existing.projectId !== projectId) {
      return null;
    }
    existing.lastHeartbeatAt = Date.now();
    if (params.sandboxId) {
      existing.sandboxId = params.sandboxId;
      projectSandboxMap.set(key, { userId, projectId, sandboxId: params.sandboxId });
    }
    return existing;
  }

  if (params.sandboxId) {
    return registerWorkspaceSession({
      sessionId,
      userId,
      projectId,
      sandboxId: params.sandboxId,
    });
  }

  return null;
}

export function beginWorkspaceOperation(userId: string, projectId: string, operationId: string): void {
  const key = projKey(userId, projectId);
  cancelPendingShutdown(key);

  let set = projectOperations.get(key);
  if (!set) {
    set = new Set();
    projectOperations.set(key, set);
  }
  set.add(operationId);
}

export function endWorkspaceOperation(userId: string, projectId: string, operationId: string): void {
  const key = projKey(userId, projectId);
  const set = projectOperations.get(key);
  if (set) {
    set.delete(operationId);
    if (set.size === 0) {
      projectOperations.delete(key);
    }
  }
}

async function waitForActiveOperations(userId: string, projectId: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (getActiveOperationsCount(userId, projectId) > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export async function attemptProjectSandboxShutdown(params: {
  userId: string;
  projectId: string;
  sandboxId?: string;
  reason: string;
  forceImmediate?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<{ stopped: boolean; reason: string; activeSessionsRemaining: number }> {
  const key = projKey(params.userId, params.projectId);
  const activeSessions = getActiveSessionsForProject(params.userId, params.projectId);

  if (activeSessions.length > 0 && !params.forceImmediate) {
    return {
      stopped: false,
      reason: 'other_tabs_active',
      activeSessionsRemaining: activeSessions.length,
    };
  }

  if (getActiveOperationsCount(params.userId, params.projectId) > 0) {
    if (!params.forceImmediate) {
      return {
        stopped: false,
        reason: 'operations_in_progress',
        activeSessionsRemaining: activeSessions.length,
      };
    }

    // Wait briefly so pending file saves/writes flush safely before stop
    await waitForActiveOperations(params.userId, params.projectId, LOGOUT_OPERATION_WAIT_MS);
  }

  if (shutdownLocks.has(key)) {
    return {
      stopped: false,
      reason: 'shutdown_already_in_progress',
      activeSessionsRemaining: activeSessions.length,
    };
  }

  const targetSandboxId = params.sandboxId || projectSandboxMap.get(key)?.sandboxId;
  if (!targetSandboxId) {
    return {
      stopped: false,
      reason: 'no_sandbox_bound',
      activeSessionsRemaining: 0,
    };
  }

  // Re-check right before issuing stop in case the user reconnected
  if (getActiveSessionsForProject(params.userId, params.projectId).length > 0 && !params.forceImmediate) {
    return {
      stopped: false,
      reason: 'reconnected_before_stop',
      activeSessionsRemaining: getActiveSessionsForProject(params.userId, params.projectId).length,
    };
  }

  shutdownLocks.add(key);
  try {
    await flushWorkspaceVolumeChanges(targetSandboxId, params.env ?? process.env);
    const result = await stopProjectSandbox(targetSandboxId, {
      userId: params.userId,
      projectId: params.projectId,
      env: params.env ?? process.env,
    });

    if (result.stopped) {
      recordLifecycleEvent('sandbox_stopped', params.userId, params.projectId, targetSandboxId, params.reason);
    }

    return {
      stopped: result.stopped,
      reason: params.reason,
      activeSessionsRemaining: 0,
    };
  } finally {
    shutdownLocks.delete(key);
  }
}

export async function endWorkspaceSession(params: {
  sessionId: string;
  userId: string;
  projectId: string;
  sandboxId?: string;
  graceDelayMs?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<{ ended: boolean; stoppedImmediately: boolean; scheduledShutdown: boolean; activeSessionsRemaining: number }> {
  const sessionId = assertValidIdentifier(params.sessionId, 'sessionId');
  const userId = assertValidIdentifier(params.userId, 'userId');
  const projectId = assertValidIdentifier(params.projectId, 'projectId');
  const key = projKey(userId, projectId);

  const existing = sessions.get(sessionId);
  const resolvedSandboxId = params.sandboxId || existing?.sandboxId || projectSandboxMap.get(key)?.sandboxId;
  if (existing && existing.userId === userId) {
    sessions.delete(sessionId);
  }

  const remaining = getActiveSessionsForProject(userId, projectId).length;
  if (remaining > 0) {
    return {
      ended: true,
      stoppedImmediately: false,
      scheduledShutdown: false,
      activeSessionsRemaining: remaining,
    };
  }

  const graceMs = params.graceDelayMs ?? 10_000;
  if (graceMs <= 0) {
    const res = await attemptProjectSandboxShutdown({
      userId,
      projectId,
      sandboxId: resolvedSandboxId,
      reason: 'session_ended',
      forceImmediate: false,
      env: params.env,
    });
    return {
      ended: true,
      stoppedImmediately: res.stopped,
      scheduledShutdown: false,
      activeSessionsRemaining: res.activeSessionsRemaining,
    };
  }

  cancelPendingShutdown(key);
  const timer = setTimeout(() => {
    pendingShutdowns.delete(key);
    void attemptProjectSandboxShutdown({
      userId,
      projectId,
      sandboxId: resolvedSandboxId,
      reason: 'grace_period_elapsed',
      forceImmediate: true,
      env: params.env,
    });
  }, graceMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  pendingShutdowns.set(key, { timer, scheduledAt: Date.now() });
  return {
    ended: true,
    stoppedImmediately: false,
    scheduledShutdown: true,
    activeSessionsRemaining: 0,
  };
}

export async function shutdownAllUserSandboxesOnLogout(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stoppedSandboxIds: string[] }> {
  const safeUid = assertValidIdentifier(userId, 'userId');
  const targetProjects = new Map<string, string>();

  for (const [sid, session] of sessions.entries()) {
    if (session.userId === safeUid) {
      targetProjects.set(session.projectId, session.sandboxId);
      sessions.delete(sid);
    }
  }

  for (const binding of projectSandboxMap.values()) {
    if (binding.userId === safeUid && binding.sandboxId) {
      targetProjects.set(binding.projectId, binding.sandboxId);
    }
  }

  const stoppedSandboxIds: string[] = [];

  await Promise.all(
    Array.from(targetProjects.entries()).map(async ([projectId, sandboxId]) => {
      cancelPendingShutdown(projKey(safeUid, projectId));
      const res = await attemptProjectSandboxShutdown({
        userId: safeUid,
        projectId,
        sandboxId,
        reason: 'explicit_user_logout',
        forceImmediate: true,
        env,
      });

      if (res.stopped && sandboxId) {
        stoppedSandboxIds.push(sandboxId);
      }
    }),
  );

  return { stoppedSandboxIds };
}

export async function sweepExpiredPresenceSessions(
  now: number = Date.now(),
  expireAfterMs: number = HEARTBEAT_EXPIRE_MS,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ expiredSessionsCount: number; stoppedProjects: string[] }> {
  const expiredKeys = new Set<string>();
  let expiredSessionsCount = 0;

  for (const [sid, session] of sessions.entries()) {
    if (now - session.lastHeartbeatAt > expireAfterMs) {
      sessions.delete(sid);
      expiredKeys.add(projKey(session.userId, session.projectId));
      expiredSessionsCount += 1;
    }
  }

  const stoppedProjects: string[] = [];

  for (const key of expiredKeys) {
    const binding = projectSandboxMap.get(key);
    if (!binding) {
      continue;
    }

    const res = await attemptProjectSandboxShutdown({
      userId: binding.userId,
      projectId: binding.projectId,
      sandboxId: binding.sandboxId,
      reason: 'heartbeat_timeout_sweep',
      forceImmediate: true,
      env,
    });

    if (res.stopped) {
      stoppedProjects.push(binding.projectId);
    }
  }

  return { expiredSessionsCount, stoppedProjects };
}

export function getPresenceAdminSnapshot() {
  return {
    activeSessions: Array.from(sessions.values()),
    activeOperationProjects: Array.from(projectOperations.entries()).map(([key, ops]) => ({
      projectKey: key,
      activeCount: ops.size,
    })),
    pendingShutdownsCount: pendingShutdowns.size,
    recentEvents: lifecycleAuditLog.slice(0, 30),
  };
}

let sweeperStarted = false;
export function ensurePresenceSweeperStarted(): void {
  if (sweeperStarted || process.env.NODE_ENV === 'test') {
    return;
  }

  sweeperStarted = true;
  const interval = setInterval(() => {
    void sweepExpiredPresenceSessions().catch(() => undefined);
  }, SWEEP_INTERVAL_MS);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }
}

export function __resetLifecycleStateForTests(): void {
  sessions.clear();
  projectOperations.clear();
  for (const pending of pendingShutdowns.values()) {
    clearTimeout(pending.timer);
  }
  pendingShutdowns.clear();
  shutdownLocks.clear();
  projectSandboxMap.clear();
  lifecycleAuditLog.length = 0;
}
