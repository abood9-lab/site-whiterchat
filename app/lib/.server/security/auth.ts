import crypto from 'node:crypto';
import * as nodePath from 'node:path';
import firebaseConfig from '../../../../firebase-applet-config.json';

export const DAYTONA_WORKSPACE_ROOT = '/workspace';
export const SAFE_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per text file
export const MAX_BINARY_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per binary upload

const RUNTIME_MEDIA_SECRET = crypto.randomBytes(32).toString('hex');

export interface VerifiedRequester {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName?: string;
  isAdmin: boolean;
  idToken: string;
}

export interface WorkspaceResolvedPath {
  absolutePath: string;
  relativePath: string;
}

export interface MediaTokenPayload {
  uid: string;
  projectId: string;
  relativePath: string;
  scope?: 'project' | 'profile';
  exp: number;
}

function getAdminEmailAllowlist(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const configured = (env.ADMIN_EMAILS || 'shahedalmefleh850@gmail.com')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  return new Set(configured);
}

export function isEmailAdmin(email: string | undefined, emailVerified: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!email || !emailVerified) {
    return false;
  }

  return getAdminEmailAllowlist(env).has(email.trim().toLowerCase());
}

export async function verifyFirebaseIdToken(
  idToken: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedRequester | null> {
  const trimmed = idToken.trim();
  if (!trimmed || !firebaseConfig.apiKey) {
    return null;
  }

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: trimmed }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
      }>;
    };

    const account = payload.users?.[0];
    if (!account?.localId) {
      return null;
    }

    const email = (account.email || '').trim();
    const emailVerified = Boolean(account.emailVerified);

    return {
      uid: account.localId,
      email,
      emailVerified,
      displayName: account.displayName,
      isAdmin: isEmailAdmin(email, emailVerified, env),
      idToken: trimmed,
    };
  } catch {
    return null;
  }
}

export function extractBearerToken(request: Request, fallbackToken?: string | null): string {
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  if (fallbackToken && typeof fallbackToken === 'string') {
    return fallbackToken.trim();
  }

  return '';
}

export async function requireAuthenticatedUser(
  request: Request,
  fallbackToken?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedRequester> {
  const token = extractBearerToken(request, fallbackToken);
  if (!token) {
    throw new HttpAuthError(401, 'Authentication required. Please sign in.');
  }

  const verified = await verifyFirebaseIdToken(token, env);
  if (!verified) {
    throw new HttpAuthError(401, 'Invalid or expired authentication session.');
  }

  return verified;
}

export class HttpAuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function assertValidIdentifier(raw: unknown, fieldName: string): string {
  if (typeof raw !== 'string') {
    throw new HttpAuthError(400, `Missing or invalid ${fieldName}.`);
  }

  const trimmed = raw.trim();
  if (!SAFE_ID_REGEX.test(trimmed)) {
    throw new HttpAuthError(400, `Invalid ${fieldName} format.`);
  }

  return trimmed;
}

export function assertProjectAccess(requester: VerifiedRequester, targetOwnerUid: string): void {
  if (requester.uid !== targetOwnerUid && !requester.isAdmin) {
    throw new HttpAuthError(403, 'Forbidden: you do not have access to this workspace project.');
  }
}

export function resolveWorkspacePath(
  rawPath: unknown,
  workdir: string = DAYTONA_WORKSPACE_ROOT,
): WorkspaceResolvedPath {
  if (typeof rawPath !== 'string') {
    throw new HttpAuthError(400, 'File path must be a non-empty string.');
  }

  if (rawPath.includes('\0') || /[\r\n]/.test(rawPath)) {
    throw new HttpAuthError(400, 'File path contains illegal control characters.');
  }

  let candidate = rawPath.trim().replace(/\\/g, '/');

  // Strip known client virtual prefixes cleanly
  candidate = candidate
    .replace(/^\/home\/project\/?/, '')
    .replace(/^\/home\/daytona\/project\/?/, '')
    .replace(/^\/workspace\/?/, '')
    .replace(/^\/+/, '');

  if (!candidate) {
    throw new HttpAuthError(400, 'File path cannot resolve to empty or root directory.');
  }

  if (candidate.length > 512) {
    throw new HttpAuthError(400, 'File path exceeds maximum allowed length.');
  }

  const segments = candidate.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new HttpAuthError(400, 'Invalid empty file path.');
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new HttpAuthError(400, 'Path traversal segments ("." or "..") are forbidden.');
    }
  }

  const normalizedRoot = nodePath.posix.normalize(workdir).replace(/\/+$/, '') || DAYTONA_WORKSPACE_ROOT;
  const relativePath = segments.join('/');
  const absolutePath = nodePath.posix.normalize(`${normalizedRoot}/${relativePath}`);

  if (absolutePath !== normalizedRoot && !absolutePath.startsWith(`${normalizedRoot}/`)) {
    throw new HttpAuthError(403, 'Resolved path escapes workspace root.');
  }

  return {
    absolutePath,
    relativePath,
  };
}

export function resolveWorkspaceDirectory(
  rawPath: unknown,
  workdir: string = DAYTONA_WORKSPACE_ROOT,
): WorkspaceResolvedPath {
  if (typeof rawPath !== 'string') {
    throw new HttpAuthError(400, 'Directory path must be a string.');
  }

  const cleaned = rawPath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/home\/project\/?/, '')
    .replace(/^\/home\/daytona\/project\/?/, '')
    .replace(/^\/workspace\/?/, '')
    .replace(/^\/+|\/+$/g, '');

  if (!cleaned) {
    return {
      absolutePath: workdir,
      relativePath: '',
    };
  }

  return resolveWorkspacePath(cleaned, workdir);
}

function getMediaSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DAYTONA_MEDIA_SECRET?.trim();
  if (explicit) {
    return explicit;
  }

  const apiKey = env.DAYTONA_API_KEY?.trim();
  if (apiKey) {
    return crypto.createHash('sha256').update(`whiterchat_media_v1:${apiKey}`).digest('hex');
  }

  return RUNTIME_MEDIA_SECRET;
}

export function createMediaSignedToken(
  payload: Omit<MediaTokenPayload, 'exp'>,
  ttlSeconds = 7200,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fullPayload: MediaTokenPayload = {
    ...payload,
    scope: payload.scope ?? 'project',
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };

  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getMediaSigningSecret(env))
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

export function verifyMediaSignedToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): MediaTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [encoded, signature] = parts;
  if (!encoded || !signature) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', getMediaSigningSecret(env))
    .update(encoded)
    .digest('base64url');

  const actualBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');

  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MediaTokenPayload;
    if (!parsed.uid || !parsed.projectId || !parsed.relativePath || typeof parsed.exp !== 'number') {
      return null;
    }

    if (parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function buildMediaAccessUrl(
  params: { uid: string; projectId: string; relativePath: string; scope?: 'project' | 'profile' },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = createMediaSignedToken(params, 7200, env);
  return `/api/workspace/media?token=${encodeURIComponent(token)}`;
}

// In-memory sliding window rate limiter
const rateBuckets = new Map<string, number[]>();

export function enforceRateLimit(bucketKey: string, maxRequests: number, windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs;
  const existing = rateBuckets.get(bucketKey) || [];
  const active = existing.filter((ts) => ts > cutoff);

  if (active.length >= maxRequests) {
    throw new HttpAuthError(429, 'Too many requests. Please slow down and try again shortly.');
  }

  active.push(now);
  rateBuckets.set(bucketKey, active);

  if (rateBuckets.size > 5000) {
    for (const [key, timestamps] of rateBuckets.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        rateBuckets.delete(key);
      }
    }
  }
}

export function computeSha256Hex(data: Buffer | Uint8Array | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function detectMimeType(filePath: string): string {
  const ext = nodePath.posix.extname(filePath).toLowerCase();
  const table: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.cjs': 'application/javascript; charset=utf-8',
    '.ts': 'text/typescript; charset=utf-8',
    '.tsx': 'text/typescript-jsx; charset=utf-8',
    '.jsx': 'text/javascript-jsx; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.pdf': 'application/pdf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.wasm': 'application/wasm',
    '.zip': 'application/zip',
    '.py': 'text/x-python; charset=utf-8',
    '.yaml': 'application/yaml; charset=utf-8',
    '.yml': 'application/yaml; charset=utf-8',
    '.toml': 'application/toml; charset=utf-8',
    '.xml': 'application/xml; charset=utf-8',
  };

  return table[ext] || 'application/octet-stream';
}
