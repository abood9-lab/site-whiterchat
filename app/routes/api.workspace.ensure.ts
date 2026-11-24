import { json, type ActionFunctionArgs } from '@remix-run/node';
import { ensureProjectSandbox, isDaytonaConfigured } from '~/lib/.server/daytona/client';
import { snapshotWorkspaceTextFiles } from '~/lib/.server/daytona/files';
import {
  ensurePresenceSweeperStarted,
  registerWorkspaceSession,
} from '~/lib/.server/daytona/lifecycle';
import { firestoreRestUpsertProject } from '~/lib/.server/firebase/firestoreRest';
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
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`ensure:${requester.uid}`, 40, 60_000);

    if (!isDaytonaConfigured(process.env)) {
      return json(
        {
          configured: false,
          error: 'DAYTONA_API_KEY is not configured in server secrets.',
        },
        { status: 503 },
      );
    }

    const body = (await request.json()) as {
      userId?: string;
      projectId?: string;
      projectName?: string;
      sessionId?: string;
      requestedSandboxId?: string;
      includeFiles?: boolean;
    };

    const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);

    const projectId = assertValidIdentifier(body.projectId, 'projectId');
    const binding = await ensureProjectSandbox({
      userId: targetUid,
      projectId,
      requestedSandboxId: body.requestedSandboxId,
      env: process.env,
    });

    if (body.sessionId) {
      const safeSessionId = assertValidIdentifier(body.sessionId, 'sessionId');
      registerWorkspaceSession({
        sessionId: safeSessionId,
        userId: targetUid,
        projectId,
        sandboxId: binding.sandboxId,
      });
    }

    const snapshot = body.includeFiles
      ? await snapshotWorkspaceTextFiles({
          userId: targetUid,
          projectId,
          sandboxId: binding.sandboxId,
          env: process.env,
        })
      : null;

    await firestoreRestUpsertProject(
      {
        userId: targetUid,
        projectId,
        name: body.projectName || projectId,
        volumeName: binding.volumeName,
        volumeId: binding.volumeId,
        volumeSubpath: binding.volumeSubpath,
        sandboxId: binding.sandboxId,
        sandboxStatus: 'started',
        ...(snapshot
          ? {
              totalFiles: snapshot.usage.totalFiles,
              totalBytes: snapshot.usage.totalBytes,
            }
          : {}),
        lastActiveAt: new Date().toISOString(),
      },
      requester.idToken,
    ).catch(() => undefined);

    return json({
      configured: true,
      sandboxId: binding.sandboxId,
      workdir: binding.workdir,
      volumeId: binding.volumeId,
      volumeName: binding.volumeName,
      volumeSubpath: binding.volumeSubpath,
      status: binding.status,
      ...(snapshot
        ? {
            files: snapshot.files,
            entries: snapshot.entries,
            usage: snapshot.usage,
          }
        : {}),
    });
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to ensure workspace sandbox';
    return json({ error: message }, { status: 500 });
  }
}
