import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/node';
import crypto from 'node:crypto';
import {
  cloneGitRepoIntoWorkspace,
  deleteWorkspacePath,
  getWorkspaceUsage,
  listWorkspaceFilesRecursive,
  mkdirWorkspaceDir,
  readWorkspaceFileText,
  renameWorkspacePath,
  snapshotWorkspaceTextFiles,
  statWorkspaceFile,
  writeWorkspaceBinaryFile,
  writeWorkspaceFilesBatch,
  writeWorkspaceTextFile,
} from '~/lib/.server/daytona/files';
import { beginWorkspaceOperation, endWorkspaceOperation } from '~/lib/.server/daytona/lifecycle';
import { firestoreRestUpsertFileMeta } from '~/lib/.server/firebase/firestoreRest';
import {
  assertProjectAccess,
  assertValidIdentifier,
  enforceRateLimit,
  HttpAuthError,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

function makeFileMetaId(userId: string, projectId: string, relPath: string): string {
  const hash = crypto.createHash('sha1').update(`${userId}:${projectId}:${relPath}`).digest('hex').slice(0, 16);
  return `f_${projectId.slice(0, 20)}_${hash}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const requester = await requireAuthenticatedUser(request);
    const url = new URL(request.url);
    const targetUid = url.searchParams.get('userId')
      ? assertValidIdentifier(url.searchParams.get('userId'), 'userId')
      : requester.uid;
    assertProjectAccess(requester, targetUid);

    const projectId = assertValidIdentifier(url.searchParams.get('projectId'), 'projectId');
    const mode = url.searchParams.get('mode') || 'list';
    const sandboxId = url.searchParams.get('sandboxId');
    const filePath = url.searchParams.get('path') || '';

    switch (mode) {
      case 'list': {
        const entries = await listWorkspaceFilesRecursive({
          userId: targetUid,
          projectId,
          basePath: filePath || undefined,
          sandboxId,
          env: process.env,
        });
        return json({ ok: true, entries });
      }

      case 'snapshot': {
        const snap = await snapshotWorkspaceTextFiles({
          userId: targetUid,
          projectId,
          sandboxId,
          env: process.env,
        });
        return json({ ok: true, ...snap });
      }

      case 'read': {
        const result = await readWorkspaceFileText({
          userId: targetUid,
          projectId,
          filePath,
          sandboxId,
          env: process.env,
        });
        return json({ ok: true, ...result });
      }

      case 'stat': {
        const info = await statWorkspaceFile({
          userId: targetUid,
          projectId,
          filePath,
          sandboxId,
          env: process.env,
        });
        return json({ ok: true, ...info });
      }

      case 'usage': {
        const usage = await getWorkspaceUsage({
          userId: targetUid,
          projectId,
          sandboxId,
          env: process.env,
        });
        return json({ ok: true, usage });
      }

      default:
        return json({ error: 'Unsupported mode' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Workspace read operation failed';
    return json({ error: message }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`files:${requester.uid}`, 180, 60_000);

    const body = (await request.json()) as {
      action?: 'writeText' | 'writeBatch' | 'writeBinaryBase64' | 'mkdir' | 'rename' | 'delete' | 'gitClone';
      userId?: string;
      projectId?: string;
      sandboxId?: string;
      filePath?: string;
      sourcePath?: string;
      destinationPath?: string;
      content?: string;
      contentBase64?: string;
      mimeType?: string;
      files?: Array<{ path: string; content: string }>;
      recursive?: boolean;
      repoUrl?: string;
      branch?: string;
      targetDir?: string;
      depth?: number;
    };

    const targetUid = body.userId ? assertValidIdentifier(body.userId, 'userId') : requester.uid;
    assertProjectAccess(requester, targetUid);

    const projectId = assertValidIdentifier(body.projectId, 'projectId');
    const opId = `fs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    beginWorkspaceOperation(targetUid, projectId, opId);

    try {
      switch (body.action) {
        case 'writeText': {
          const result = await writeWorkspaceTextFile({
            userId: targetUid,
            projectId,
            filePath: body.filePath || '',
            content: body.content ?? '',
            sandboxId: body.sandboxId,
            env: process.env,
          });

          await firestoreRestUpsertFileMeta(
            {
              userId: targetUid,
              projectId,
              fileId: makeFileMetaId(targetUid, projectId, result.relativePath),
              relativePath: result.relativePath,
              mimeType: result.mimeType,
              sizeBytes: result.sizeBytes,
              sha256: result.sha256,
            },
            requester.idToken,
          ).catch(() => undefined);

          return json({ ok: true, ...result });
        }

        case 'writeBatch': {
          if (!Array.isArray(body.files)) {
            return json({ error: 'Missing files array' }, { status: 400 });
          }

          const result = await writeWorkspaceFilesBatch({
            userId: targetUid,
            projectId,
            files: body.files,
            sandboxId: body.sandboxId,
            env: process.env,
          });

          await Promise.all(
            result.written.slice(0, 40).map((item) =>
              firestoreRestUpsertFileMeta(
                {
                  userId: targetUid,
                  projectId,
                  fileId: makeFileMetaId(targetUid, projectId, item.relativePath),
                  relativePath: item.relativePath,
                  mimeType: item.mimeType,
                  sizeBytes: item.sizeBytes,
                  sha256: item.sha256,
                },
                requester.idToken,
              ).catch(() => undefined),
            ),
          );

          return json({ ok: true, count: result.written.length, ...result });
        }

        case 'writeBinaryBase64': {
          if (!body.contentBase64) {
            return json({ error: 'Missing contentBase64' }, { status: 400 });
          }
          const clean = body.contentBase64.includes(',') ? body.contentBase64.split(',')[1] : body.contentBase64;
          const buffer = Buffer.from(clean, 'base64');

          const result = await writeWorkspaceBinaryFile({
            userId: targetUid,
            projectId,
            filePath: body.filePath || '',
            data: buffer,
            mimeType: body.mimeType,
            sandboxId: body.sandboxId,
            env: process.env,
          });

          return json({ ok: true, ...result });
        }

        case 'mkdir': {
          const result = await mkdirWorkspaceDir({
            userId: targetUid,
            projectId,
            dirPath: body.filePath || '',
            sandboxId: body.sandboxId,
            env: process.env,
          });
          return json({ ok: true, ...result });
        }

        case 'rename': {
          const result = await renameWorkspacePath({
            userId: targetUid,
            projectId,
            sourcePath: body.sourcePath || '',
            destinationPath: body.destinationPath || '',
            sandboxId: body.sandboxId,
            env: process.env,
          });
          return json({ ok: true, ...result });
        }

        case 'delete': {
          const result = await deleteWorkspacePath({
            userId: targetUid,
            projectId,
            targetPath: body.filePath || '',
            recursive: body.recursive,
            sandboxId: body.sandboxId,
            env: process.env,
          });
          return json({ ok: true, ...result });
        }

        case 'gitClone': {
          if (!body.repoUrl) {
            return json({ error: 'Missing repoUrl' }, { status: 400 });
          }

          const cloned = await cloneGitRepoIntoWorkspace({
            userId: targetUid,
            projectId,
            repoUrl: body.repoUrl,
            branch: body.branch,
            targetDir: body.targetDir,
            depth: body.depth,
            sandboxId: body.sandboxId,
            env: process.env,
          });

          return json({ ok: true, ...cloned });
        }

        default:
          return json({ error: 'Unsupported workspace file action' }, { status: 400 });
      }
    } finally {
      endWorkspaceOperation(targetUid, projectId, opId);
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Workspace file operation failed';
    return json({ error: message }, { status: 500 });
  }
}
