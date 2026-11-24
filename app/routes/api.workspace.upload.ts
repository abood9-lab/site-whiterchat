import { json, type ActionFunctionArgs } from '@remix-run/node';
import crypto from 'node:crypto';
import { writeWorkspaceBinaryFile } from '~/lib/.server/daytona/files';
import { beginWorkspaceOperation, endWorkspaceOperation } from '~/lib/.server/daytona/lifecycle';
import { firestoreRestUpsertFileMeta } from '~/lib/.server/firebase/firestoreRest';
import {
  assertProjectAccess,
  assertValidIdentifier,
  buildMediaAccessUrl,
  enforceRateLimit,
  HttpAuthError,
  MAX_BINARY_FILE_BYTES,
  requireAuthenticatedUser,
} from '~/lib/.server/security/auth';

function sanitizeUploadFilename(rawName: string): string {
  const base = rawName.split('/').pop()?.split('\\').pop() || 'upload.bin';
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, 'file.');
  return cleaned.slice(0, 120) || 'upload.bin';
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const requester = await requireAuthenticatedUser(request);
    enforceRateLimit(`upload:${requester.uid}`, 40, 60_000);

    const contentType = request.headers.get('Content-Type') || '';
    let userId = requester.uid;
    let projectId = 'default_workspace';
    let kind: 'project' | 'profile' = 'project';
    let targetFolder = 'uploads';
    let fileName = `asset_${Date.now()}.bin`;
    let mimeType = 'application/octet-stream';
    let buffer: Buffer;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const fileField = formData.get('file');
      if (!fileField || !(fileField instanceof File)) {
        return json({ error: 'Missing file in multipart form-data upload.' }, { status: 400 });
      }

      if (fileField.size > MAX_BINARY_FILE_BYTES) {
        return json({ error: 'Uploaded file exceeds 50 MB limit.' }, { status: 413 });
      }

      const rawUserId = formData.get('userId');
      if (typeof rawUserId === 'string' && rawUserId.trim()) {
        userId = assertValidIdentifier(rawUserId, 'userId');
      }
      assertProjectAccess(requester, userId);

      const rawKind = formData.get('kind');
      kind = rawKind === 'profile' ? 'profile' : 'project';

      const rawProjectId = formData.get('projectId');
      projectId = kind === 'profile'
        ? 'profile'
        : assertValidIdentifier(typeof rawProjectId === 'string' && rawProjectId.trim() ? rawProjectId : 'default_workspace', 'projectId');

      const rawFolder = formData.get('folder');
      if (typeof rawFolder === 'string' && rawFolder.trim()) {
        targetFolder = rawFolder.trim().replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9/_-]/g, '_');
      } else if (kind === 'profile') {
        targetFolder = 'avatars';
      }

      fileName = sanitizeUploadFilename(fileField.name);
      mimeType = fileField.type || 'application/octet-stream';
      buffer = Buffer.from(await fileField.arrayBuffer());
    } else {
      const body = (await request.json()) as {
        userId?: string;
        projectId?: string;
        kind?: 'project' | 'profile';
        folder?: string;
        fileName?: string;
        mimeType?: string;
        contentBase64?: string;
      };

      if (!body.contentBase64) {
        return json({ error: 'Missing file payload (contentBase64 or multipart file).' }, { status: 400 });
      }

      if (body.userId) {
        userId = assertValidIdentifier(body.userId, 'userId');
      }
      assertProjectAccess(requester, userId);

      kind = body.kind === 'profile' ? 'profile' : 'project';
      projectId = kind === 'profile'
        ? 'profile'
        : assertValidIdentifier(body.projectId || 'default_workspace', 'projectId');
      targetFolder = (body.folder || (kind === 'profile' ? 'avatars' : 'uploads'))
        .replace(/^\/+|\/+$/g, '')
        .replace(/[^a-zA-Z0-9/_-]/g, '_');

      fileName = sanitizeUploadFilename(body.fileName || 'upload.bin');
      mimeType = body.mimeType || 'application/octet-stream';

      const cleanBase64 = body.contentBase64.includes(',') ? body.contentBase64.split(',')[1] : body.contentBase64;
      buffer = Buffer.from(cleanBase64, 'base64');

      if (buffer.byteLength > MAX_BINARY_FILE_BYTES) {
        return json({ error: 'Uploaded file exceeds 50 MB limit.' }, { status: 413 });
      }
    }

    const relativePath = `${targetFolder}/${Date.now()}_${fileName}`;
    const opId = `upl_${Date.now().toString(36)}`;
    beginWorkspaceOperation(userId, projectId, opId);

    try {
      const result = await writeWorkspaceBinaryFile({
        userId,
        projectId,
        filePath: relativePath,
        data: buffer,
        mimeType,
        kind,
        env: process.env,
      });

      const mediaUrl = buildMediaAccessUrl(
        {
          uid: userId,
          projectId,
          relativePath: result.relativePath,
          scope: kind,
        },
        process.env,
      );

      if (kind === 'project') {
        const metaHash = crypto.createHash('sha1').update(`${userId}:${projectId}:${result.relativePath}`).digest('hex').slice(0, 16);
        await firestoreRestUpsertFileMeta(
          {
            userId,
            projectId,
            fileId: `u_${metaHash}`,
            relativePath: result.relativePath,
            mimeType: result.mimeType,
            sizeBytes: result.sizeBytes,
            sha256: result.sha256,
          },
          requester.idToken,
        ).catch(() => undefined);
      }

      return json({
        ok: true,
        path: result.relativePath,
        sizeBytes: result.sizeBytes,
        sha256: result.sha256,
        mimeType: result.mimeType,
        sandboxId: result.sandboxId,
        mediaUrl,
      });
    } finally {
      endWorkspaceOperation(userId, projectId, opId);
    }
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Workspace media upload failed';
    return json({ error: message }, { status: 500 });
  }
}
