import type { LoaderFunctionArgs } from '@remix-run/node';
import { readWorkspaceFileBytes } from '~/lib/.server/daytona/files';
import {
  assertProjectAccess,
  assertValidIdentifier,
  HttpAuthError,
  requireAuthenticatedUser,
  verifyMediaSignedToken,
} from '~/lib/.server/security/auth';

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const tokenParam = url.searchParams.get('token');

    let uid: string;
    let projectId: string;
    let filePath: string;
    let scope: 'project' | 'profile' = 'project';

    if (tokenParam) {
      const verifiedPayload = verifyMediaSignedToken(tokenParam, process.env);
      if (!verifiedPayload) {
        return new Response('Invalid or expired media token', { status: 401 });
      }
      uid = assertValidIdentifier(verifiedPayload.uid, 'uid');
      projectId = assertValidIdentifier(verifiedPayload.projectId, 'projectId');
      filePath = verifiedPayload.relativePath;
      scope = verifiedPayload.scope === 'profile' ? 'profile' : 'project';
    } else {
      const requester = await requireAuthenticatedUser(request);
      const targetUid = url.searchParams.get('userId')
        ? assertValidIdentifier(url.searchParams.get('userId'), 'userId')
        : requester.uid;
      assertProjectAccess(requester, targetUid);
      uid = targetUid;
      projectId = assertValidIdentifier(url.searchParams.get('projectId'), 'projectId');
      filePath = url.searchParams.get('path') || '';
      scope = url.searchParams.get('scope') === 'profile' ? 'profile' : 'project';
    }

    const file = await readWorkspaceFileBytes({
      userId: uid,
      projectId,
      filePath,
      kind: scope,
      env: process.env,
    });

    const totalSize = file.bytes.byteLength;
    const rangeHeader = request.headers.get('Range');

    if (rangeHeader && totalSize > 0) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
      if (match) {
        const start = match[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match[2] ? Math.min(Number.parseInt(match[2], 10), totalSize - 1) : totalSize - 1;

        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
          return new Response(null, {
            status: 416,
            headers: {
              'Content-Range': `bytes */${totalSize}`,
            },
          });
        }

        const slice = file.bytes.subarray(start, end + 1);
        return new Response(new Uint8Array(slice), {
          status: 206,
          headers: {
            'Content-Type': file.mimeType,
            'Content-Length': String(slice.byteLength),
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=300',
            'ETag': `"${file.sha256}"`,
          },
        });
      }
    }

    return new Response(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(totalSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
        'ETag': `"${file.sha256}"`,
      },
    });
  } catch (error) {
    if (error instanceof HttpAuthError) {
      return new Response(error.message, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Media fetch failed';
    return new Response(message, { status: 404 });
  }
}
