import { json, type ActionFunctionArgs } from '@remix-run/node';
import {
  beginWorkspaceOperation,
  endWorkspaceOperation,
  endWorkspaceSession,
  ensurePresenceSweeperStarted,
  heartbeatWorkspaceSession,
  registerWorkspaceSession,
  shutdownAllUserSandboxesOnLogout,
} from '~/lib/.server/daytona/lifecycle';
import { firestoreRestUpsertProject } from '~/lib/.server/firebase/firestoreRest';
import { getProjectVolumeName, buildIsolatedProjectSubpath } from '~/lib/.server/daytona/volumes';
import {
  assertProjectAccess,
  assertValidIdentifier,
  enforceRateLimit,
  HttpAuthError,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  ensurePresenceSweeperStarted();

  try {
    const rawText = await request.text();
    const body = (rawText ? JSON.parse(rawText) : {}) as {
      action?: 'register' | 'heartbeat' | 'end' | 'logoutAll' | 'opStart' | 'opEnd';
      idToken?: string;
      userId?: string;
      projectId?: string;
      sessionId?: string;
      sandboxId?: string;
      operationId?: string;
      graceDelayMs?: number;
    };

    const requester = await requireAuthenticatedUser(request, body.idToken || null);
    enforceRateLimit(`session:${requester.uid}`, 120, 60_000);

    if (body.action === 'logoutAll') {
      const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
      assertProjectAccess(requester, targetUid);

      const res = await shutdownAllUserSandboxesOnLogout(targetUid, process.env);
      return json({ ok: true, ...res });
    }

    const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);
    const projectId = assertValidIdentifier(body.projectId, 'projectId');

    switch (body.action) {
      case 'register': {
        const sessionId = assertValidIdentifier(body.sessionId, 'sessionId');
        const session = registerWorkspaceSession({
          sessionId,
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId || '',
        });
        return json({ ok: true, session });
      }

      case 'heartbeat': {
        const sessionId = assertValidIdentifier(body.sessionId, 'sessionId');
        const session = heartbeatWorkspaceSession({
          sessionId,
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
        });
        return json({ ok: true, active: Boolean(session), session });
      }

      case 'opStart': {
        const operationId = assertValidIdentifier(body.operationId, 'operationId');
        beginWorkspaceOperation(targetUid, projectId, operationId);
        return json({ ok: true });
      }

      case 'opEnd': {
        const operationId = assertValidIdentifier(body.operationId, 'operationId');
        endWorkspaceOperation(targetUid, projectId, operationId);
        return json({ ok: true });
      }

      case 'end': {
        const sessionId = assertValidIdentifier(body.sessionId, 'sessionId');
        const result = await endWorkspaceSession({
          sessionId,
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          graceDelayMs: typeof body.graceDelayMs === 'number' ? body.graceDelayMs : 10_000,
          env: process.env,
        });

        if (result.stoppedImmediately) {
          await firestoreRestUpsertProject(
            {
              userId: targetUid,
              projectId,
              volumeName: getProjectVolumeName(process.env),
              volumeSubpath: buildIsolatedProjectSubpath(targetUid, projectId),
              sandboxStatus: 'stopped',
              lastStoppedAt: new Date().toISOString(),
            },
            requester.idToken,
          ).catch(() => undefined);
        }

        return json({ ok: true, ...result });
      }

      default:
        return json({ error: 'Unsupported session action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Workspace session request failed';
    return json({ error: message }, { status: 500 });
  }
}
