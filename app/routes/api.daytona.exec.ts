import { json, type ActionFunctionArgs } from '@remix-run/node';
import {
  isDaytonaConfigured,
  runDaytonaCommandStream,
  verifyAndGetProjectSandboxContext,
} from '~/lib/.server/daytona/client';
import { beginWorkspaceOperation, endWorkspaceOperation } from '~/lib/.server/daytona/lifecycle';
import {
  assertProjectAccess,
  assertValidIdentifier,
  enforceRateLimit,
  HttpAuthError,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

const DEV_SERVER_COMMAND_REGEX = /\b(vite|next\s+dev|remix\s+vite:dev|uvicorn|gunicorn|flask\s+run|npm\s+run\s+dev|pnpm\s+dev|yarn\s+dev|npm\s+start|http\.server)\b/i;

export async function action({ request }: ActionFunctionArgs) {
  if (!isDaytonaConfigured(process.env)) {
    return json(
      {
        error: 'DAYTONA_API_KEY is not configured in server secrets.',
      },
      { status: 400 },
    );
  }

  try {
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`daytona_exec:${requester.uid}`, 60, 60_000);

    const { sandboxId, projectId: rawProjectId, userId: rawUserId, command, waitForServer } =
      (await request.json()) as {
        sandboxId?: string;
        projectId?: string;
        userId?: string;
        command?: string;
        waitForServer?: boolean;
      };

    if (!command?.trim()) {
      return json({ error: 'Missing command' }, { status: 400 });
    }

    const targetUid = rawUserId ? assertValidIdentifier(rawUserId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);
    const projectId = assertValidIdentifier(rawProjectId || 'default_workspace', 'projectId');

    const { binding } = await verifyAndGetProjectSandboxContext({
      userId: targetUid,
      projectId,
      sandboxId,
      env: process.env,
    });

    const trimmedCmd = command.trim();
    const isLikelyServer = Boolean(waitForServer) && DEV_SERVER_COMMAND_REGEX.test(trimmedCmd);
    const encoder = new TextEncoder();
    const opId = `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    beginWorkspaceOperation(targetUid, projectId, opId);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          await runDaytonaCommandStream({
            sandboxId: binding.sandboxId,
            command: trimmedCmd,
            isLikelyServer,
            env: process.env,
            onEvent: (event) => {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            },
          });
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Daytona command failed';
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', data: msg })}\n`));
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'exit', exitCode: 1 })}\n`));
        } finally {
          endWorkspaceOperation(targetUid, projectId, opId);
          controller.close();
        }
      },
      cancel() {
        endWorkspaceOperation(targetUid, projectId, opId);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error('[api.daytona.exec]', error);
    const message = error instanceof Error ? error.message : 'Daytona command failed';
    return json({ error: message }, { status: 500 });
  }
}
