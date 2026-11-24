import { json, type ActionFunctionArgs } from '@remix-run/node';
import {
  deleteDaytonaSandbox,
  ensureProjectSandbox,
  getDaytonaPreviewInfo,
  isDaytonaConfigured,
  killDaytonaProcess,
  listDaytonaOpenPorts,
  stopProjectSandbox,
  verifyAndGetProjectSandboxContext,
} from '~/lib/.server/daytona/client';
import { writeWorkspaceFilesBatch, writeWorkspaceTextFile } from '~/lib/.server/daytona/files';
import { beginWorkspaceOperation, endWorkspaceOperation } from '~/lib/.server/daytona/lifecycle';
import {
  assertProjectAccess,
  assertValidIdentifier,
  enforceRateLimit,
  HttpAuthError,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

export async function loader() {
  return json({
    configured: isDaytonaConfigured(process.env),
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const configured = isDaytonaConfigured(process.env);
  if (!configured) {
    return json(
      {
        configured: false,
        error: 'DAYTONA_API_KEY is not configured in server secrets. Add DAYTONA_API_KEY to use Daytona Cloud Sandboxes.',
      },
      { status: 400 },
    );
  }

  try {
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`daytona:${requester.uid}`, 120, 60_000);

    const body = (await request.json()) as {
      action: 'create' | 'stop' | 'delete' | 'writeFile' | 'syncFiles' | 'killProcess' | 'preview' | 'ports';
      userId?: string;
      projectId?: string;
      sandboxId?: string;
      filePath?: string;
      content?: string;
      files?: Array<{ path: string; content: string }>;
      processId?: string;
      port?: number;
    };

    const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);
    const projectId = assertValidIdentifier(body.projectId || 'default_workspace', 'projectId');

    switch (body.action) {
      case 'create': {
        const binding = await ensureProjectSandbox({
          userId: targetUid,
          projectId,
          requestedSandboxId: body.sandboxId,
          env: process.env,
        });
        return json({
          configured: true,
          sandboxId: binding.sandboxId,
          workdir: binding.workdir,
          volumeId: binding.volumeId,
          volumeName: binding.volumeName,
          volumeSubpath: binding.volumeSubpath,
        });
      }

      case 'stop': {
        const { binding } = await verifyAndGetProjectSandboxContext({
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          env: process.env,
        });
        const res = await stopProjectSandbox(binding.sandboxId, {
          userId: targetUid,
          projectId,
          env: process.env,
        });
        return json({ ok: true, ...res });
      }

      case 'delete': {
        const { binding } = await verifyAndGetProjectSandboxContext({
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          env: process.env,
        });
        await deleteDaytonaSandbox(binding.sandboxId, process.env);
        return json({ ok: true });
      }

      case 'writeFile': {
        if (!body.filePath) {
          return json({ error: 'Missing filePath' }, { status: 400 });
        }
        const opId = `dw_${Date.now().toString(36)}`;
        beginWorkspaceOperation(targetUid, projectId, opId);
        try {
          const result = await writeWorkspaceTextFile({
            userId: targetUid,
            projectId,
            filePath: body.filePath,
            content: body.content ?? '',
            sandboxId: body.sandboxId,
            env: process.env,
          });
          return json({ ok: true, path: result.absolutePath, relativePath: result.relativePath, sandboxId: result.sandboxId });
        } finally {
          endWorkspaceOperation(targetUid, projectId, opId);
        }
      }

      case 'syncFiles': {
        if (!Array.isArray(body.files)) {
          return json({ error: 'Missing files array' }, { status: 400 });
        }
        const opId = `ds_${Date.now().toString(36)}`;
        beginWorkspaceOperation(targetUid, projectId, opId);
        try {
          const result = await writeWorkspaceFilesBatch({
            userId: targetUid,
            projectId,
            files: body.files,
            sandboxId: body.sandboxId,
            env: process.env,
          });
          return json({ ok: true, count: result.written.length, sandboxId: result.sandboxId });
        } finally {
          endWorkspaceOperation(targetUid, projectId, opId);
        }
      }

      case 'killProcess': {
        if (!body.processId) {
          return json({ error: 'Missing processId' }, { status: 400 });
        }
        const { binding } = await verifyAndGetProjectSandboxContext({
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          env: process.env,
        });
        await killDaytonaProcess(binding.sandboxId, body.processId, process.env);
        return json({ ok: true });
      }

      case 'preview': {
        if (typeof body.port !== 'number') {
          return json({ error: 'Missing port' }, { status: 400 });
        }
        const { binding } = await verifyAndGetProjectSandboxContext({
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          env: process.env,
        });
        const info = await getDaytonaPreviewInfo(binding.sandboxId, body.port, process.env);
        return json(info);
      }

      case 'ports': {
        const { binding } = await verifyAndGetProjectSandboxContext({
          userId: targetUid,
          projectId,
          sandboxId: body.sandboxId,
          env: process.env,
        });
        const ports = await listDaytonaOpenPorts(binding.sandboxId, process.env);
        return json({ ports });
      }

      default:
        return json({ error: 'Unsupported Daytona action' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ configured: true, error: error.message }, { status: error.status });
    }
    console.error('[api.daytona]', error);
    const message = error instanceof Error ? error.message : 'Daytona request failed';
    return json({ configured: true, error: message }, { status: 500 });
  }
}
