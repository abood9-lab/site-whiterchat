import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { Readable } from 'node:stream';
import { getEncoding } from 'istextorbinary';
import {
  computeSha256Hex,
  DAYTONA_WORKSPACE_ROOT,
  detectMimeType,
  HttpAuthError,
  MAX_BINARY_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  resolveWorkspaceDirectory,
  resolveWorkspacePath,
  type WorkspaceResolvedPath,
} from '~/lib/.server/security/auth';
import { verifyAndGetProjectSandboxContext, type CachedSandboxContext } from './client';

export interface WorkspaceFileEntry {
  path: string;
  absolutePath: string;
  isDir: boolean;
  sizeBytes: number;
  updatedAt?: string;
}

export interface WorkspaceWriteResult {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string;
  sandboxId: string;
}

export interface WorkspaceUsageStats {
  totalFiles: number;
  totalBytes: number;
}

const STREAM_UPLOAD_THRESHOLD_BYTES = 1024 * 1024; // 1 MB uses streaming transfer
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.vite', '.cache', '__pycache__', '.venv', 'venv']);

async function ensureRemoteParentDir(ctx: CachedSandboxContext, absoluteFilePath: string): Promise<void> {
  const dir = nodePath.posix.dirname(absoluteFilePath);
  if (!dir || dir === '/' || dir === DAYTONA_WORKSPACE_ROOT) {
    return;
  }

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.createFolder(dir, '755').catch(() => undefined);
  } else {
    await ctx.sandbox.fs.mkdir(dir).catch(() => undefined);
  }
}

export async function writeWorkspaceTextFile(options: {
  userId: string;
  projectId: string;
  filePath: string;
  content: string;
  sandboxId?: string | null;
  kind?: 'project' | 'profile';
  env?: NodeJS.ProcessEnv;
}): Promise<WorkspaceWriteResult> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspacePath(options.filePath, DAYTONA_WORKSPACE_ROOT);
  const bytes = Buffer.from(options.content, 'utf8');

  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new HttpAuthError(413, `File "${resolved.relativePath}" exceeds 2 MB text limit.`);
  }

  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    kind: options.kind,
    env,
  });

  await ensureRemoteParentDir(ctx, resolved.absolutePath);

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.uploadFile(bytes, resolved.absolutePath);
  } else {
    await ctx.sandbox.fs.writeText(resolved.absolutePath, options.content, { atomic: true });
  }

  return {
    relativePath: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    sizeBytes: bytes.byteLength,
    sha256: computeSha256Hex(bytes),
    mimeType: detectMimeType(resolved.relativePath),
    sandboxId: binding.sandboxId,
  };
}

export async function writeWorkspaceBinaryFile(options: {
  userId: string;
  projectId: string;
  filePath: string;
  data: Buffer | Uint8Array;
  mimeType?: string;
  sandboxId?: string | null;
  kind?: 'project' | 'profile';
  env?: NodeJS.ProcessEnv;
}): Promise<WorkspaceWriteResult> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspacePath(options.filePath, DAYTONA_WORKSPACE_ROOT);
  const buffer = Buffer.isBuffer(options.data) ? options.data : Buffer.from(options.data);

  if (buffer.byteLength > MAX_BINARY_FILE_BYTES) {
    throw new HttpAuthError(413, `File "${resolved.relativePath}" exceeds 50 MB binary upload limit.`);
  }

  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    kind: options.kind,
    env,
  });

  await ensureRemoteParentDir(ctx, resolved.absolutePath);

  if (ctx.apiVersion === 'v0') {
    if (buffer.byteLength >= STREAM_UPLOAD_THRESHOLD_BYTES) {
      await ctx.sandbox.fs.uploadFileStream(Readable.from(buffer), resolved.absolutePath);
    } else {
      await ctx.sandbox.fs.uploadFile(buffer, resolved.absolutePath);
    }
  } else if (buffer.byteLength >= STREAM_UPLOAD_THRESHOLD_BYTES) {
    const tmpDir = await nodeFs.mkdtemp(nodePath.join(nodeOs.tmpdir(), 'wc-upload-'));
    const tmpFile = nodePath.join(tmpDir, 'payload.bin');
    try {
      await nodeFs.writeFile(tmpFile, buffer);
      await ctx.sandbox.fs.uploadFile(tmpFile, resolved.absolutePath);
    } finally {
      await nodeFs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    await ctx.sandbox.fs.writeBytes(resolved.absolutePath, buffer, { atomic: true });
  }

  return {
    relativePath: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    sizeBytes: buffer.byteLength,
    sha256: computeSha256Hex(buffer),
    mimeType: options.mimeType || detectMimeType(resolved.relativePath),
    sandboxId: binding.sandboxId,
  };
}

export async function writeWorkspaceFilesBatch(options: {
  userId: string;
  projectId: string;
  files: Array<{ path: string; content: string }>;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ sandboxId: string; written: WorkspaceWriteResult[] }> {
  const env = options.env ?? process.env;
  const resolvedItems: Array<{
    relativePath: string;
    absolutePath: string;
    bytes: Buffer;
  }> = [];

  for (const item of options.files) {
    const resolved = resolveWorkspacePath(item.path, DAYTONA_WORKSPACE_ROOT);
    const bytes = Buffer.from(item.content ?? '', 'utf8');
    if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
      throw new HttpAuthError(413, `File "${resolved.relativePath}" exceeds 2 MB text limit.`);
    }
    resolvedItems.push({
      relativePath: resolved.relativePath,
      absolutePath: resolved.absolutePath,
      bytes,
    });
  }

  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  if (resolvedItems.length === 0) {
    return { sandboxId: binding.sandboxId, written: [] };
  }

  const dirs = new Set<string>();
  for (const item of resolvedItems) {
    const dir = nodePath.posix.dirname(item.absolutePath);
    if (dir && dir !== '/' && dir !== DAYTONA_WORKSPACE_ROOT) {
      dirs.add(dir);
    }
  }

  const sortedDirs = Array.from(dirs).sort((a, b) => a.length - b.length);
  for (const dir of sortedDirs) {
    if (ctx.apiVersion === 'v0') {
      await ctx.sandbox.fs.createFolder(dir, '755').catch(() => undefined);
    } else {
      await ctx.sandbox.fs.mkdir(dir).catch(() => undefined);
    }
  }

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.uploadFiles(
      resolvedItems.map((item) => ({
        source: item.bytes,
        destination: item.absolutePath,
      })),
    );
  } else {
    const payload: Record<string, Uint8Array> = {};
    for (const item of resolvedItems) {
      payload[item.absolutePath] = item.bytes;
    }
    await ctx.sandbox.fs.writeMany(payload, { atomic: true });
  }

  const written: WorkspaceWriteResult[] = resolvedItems.map((item) => ({
    relativePath: item.relativePath,
    absolutePath: item.absolutePath,
    sizeBytes: item.bytes.byteLength,
    sha256: computeSha256Hex(item.bytes),
    mimeType: detectMimeType(item.relativePath),
    sandboxId: binding.sandboxId,
  }));

  return { sandboxId: binding.sandboxId, written };
}

export async function readWorkspaceFileBytes(options: {
  userId: string;
  projectId: string;
  filePath: string;
  sandboxId?: string | null;
  kind?: 'project' | 'profile';
  env?: NodeJS.ProcessEnv;
}): Promise<{
  bytes: Buffer;
  relativePath: string;
  absolutePath: string;
  mimeType: string;
  sha256: string;
  sandboxId: string;
}> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspacePath(options.filePath, DAYTONA_WORKSPACE_ROOT);

  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    kind: options.kind,
    env,
  });

  let bytes: Buffer;
  if (ctx.apiVersion === 'v0') {
    const raw = await ctx.sandbox.fs.downloadFile(resolved.absolutePath);
    bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  } else {
    const raw = await ctx.sandbox.fs.readBytes(resolved.absolutePath, { maxResponseBytes: MAX_BINARY_FILE_BYTES });
    bytes = Buffer.from(raw);
  }

  return {
    bytes,
    relativePath: resolved.relativePath,
    absolutePath: resolved.absolutePath,
    mimeType: detectMimeType(resolved.relativePath),
    sha256: computeSha256Hex(bytes),
    sandboxId: binding.sandboxId,
  };
}

export async function readWorkspaceFileText(options: {
  userId: string;
  projectId: string;
  filePath: string;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  content: string;
  isBinary: boolean;
  sizeBytes: number;
  sha256: string;
  relativePath: string;
}> {
  const res = await readWorkspaceFileBytes(options);
  const isBinary = getEncoding(res.bytes, { chunkLength: 512 }) === 'binary';

  return {
    content: isBinary ? '' : res.bytes.toString('utf8'),
    isBinary,
    sizeBytes: res.bytes.byteLength,
    sha256: res.sha256,
    relativePath: res.relativePath,
  };
}

export async function statWorkspaceFile(options: {
  userId: string;
  projectId: string;
  filePath: string;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ exists: boolean; isDir: boolean; sizeBytes: number; updatedAt?: string; relativePath: string }> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspacePath(options.filePath, DAYTONA_WORKSPACE_ROOT);

  const { ctx } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  try {
    if (ctx.apiVersion === 'v0') {
      const info = await ctx.sandbox.fs.getFileDetails(resolved.absolutePath);
      return {
        exists: true,
        isDir: Boolean(info.isDir),
        sizeBytes: Number(info.size || 0),
        updatedAt: info.modTime,
        relativePath: resolved.relativePath,
      };
    }

    const info = await ctx.sandbox.fs.stat(resolved.absolutePath);
    return {
      exists: true,
      isDir: info.isDir,
      sizeBytes: Number(info.size || 0),
      updatedAt: info.modifiedAt,
      relativePath: resolved.relativePath,
    };
  } catch {
    return {
      exists: false,
      isDir: false,
      sizeBytes: 0,
      relativePath: resolved.relativePath,
    };
  }
}

export async function mkdirWorkspaceDir(options: {
  userId: string;
  projectId: string;
  dirPath: string;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ relativePath: string; absolutePath: string }> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspaceDirectory(options.dirPath, DAYTONA_WORKSPACE_ROOT);

  const { ctx } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.createFolder(resolved.absolutePath, '755');
  } else {
    await ctx.sandbox.fs.mkdir(resolved.absolutePath);
  }

  return resolved;
}

export async function deleteWorkspacePath(options: {
  userId: string;
  projectId: string;
  targetPath: string;
  recursive?: boolean;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ deleted: string }> {
  const env = options.env ?? process.env;
  const resolved = resolveWorkspacePath(options.targetPath, DAYTONA_WORKSPACE_ROOT);

  const { ctx } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.deleteFile(resolved.absolutePath, options.recursive ?? true);
  } else {
    await ctx.sandbox.fs.remove(resolved.absolutePath, { recursive: options.recursive ?? true });
  }

  return { deleted: resolved.relativePath };
}

export async function renameWorkspacePath(options: {
  userId: string;
  projectId: string;
  sourcePath: string;
  destinationPath: string;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{ from: string; to: string }> {
  const env = options.env ?? process.env;
  const src = resolveWorkspacePath(options.sourcePath, DAYTONA_WORKSPACE_ROOT);
  const dst = resolveWorkspacePath(options.destinationPath, DAYTONA_WORKSPACE_ROOT);

  const { ctx } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  await ensureRemoteParentDir(ctx, dst.absolutePath);

  if (ctx.apiVersion === 'v0') {
    await ctx.sandbox.fs.moveFiles(src.absolutePath, dst.absolutePath);
  } else {
    await ctx.sandbox.fs.move(src.absolutePath, dst.absolutePath);
  }

  return { from: src.relativePath, to: dst.relativePath };
}

async function listDirectoryChildren(
  ctx: CachedSandboxContext,
  dirAbsPath: string,
): Promise<Array<{ name: string; isDir: boolean; sizeBytes: number; updatedAt?: string }>> {
  try {
    if (ctx.apiVersion === 'v0') {
      const items = await ctx.sandbox.fs.listFiles(dirAbsPath);
      return (items || []).map((item) => ({
        name: item.name,
        isDir: Boolean(item.isDir),
        sizeBytes: Number(item.size || 0),
        updatedAt: item.modTime,
      }));
    }

    const page = await ctx.sandbox.fs.list(dirAbsPath, { depth: 1 });
    return (page.items || []).map((item) => ({
      name: item.name,
      isDir: item.isDir,
      sizeBytes: Number(item.size || 0),
      updatedAt: item.modifiedAt,
    }));
  } catch {
    return [];
  }
}

export async function listWorkspaceFilesRecursive(options: {
  userId: string;
  projectId: string;
  basePath?: string;
  includeExcluded?: boolean;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkspaceFileEntry[]> {
  const env = options.env ?? process.env;
  const base = options.basePath
    ? resolveWorkspaceDirectory(options.basePath, DAYTONA_WORKSPACE_ROOT)
    : { absolutePath: DAYTONA_WORKSPACE_ROOT, relativePath: '' };

  const { ctx } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  const collected: WorkspaceFileEntry[] = [];
  const queue: string[] = [base.absolutePath];
  const visited = new Set<string>();
  const LIST_CONCURRENCY = 8;

  while (queue.length > 0 && collected.length < 2500) {
    const batchDirs: string[] = [];
    while (queue.length > 0 && batchDirs.length < LIST_CONCURRENCY) {
      const dir = queue.shift()!;
      if (!visited.has(dir)) {
        visited.add(dir);
        batchDirs.push(dir);
      }
    }

    if (batchDirs.length === 0) {
      break;
    }

    const batchResults = await Promise.all(
      batchDirs.map(async (currentDir) => ({
        currentDir,
        children: await listDirectoryChildren(ctx, currentDir),
      })),
    );

    for (const { currentDir, children } of batchResults) {
      for (const child of children) {
        if (!child.name || child.name === '.' || child.name === '..') {
          continue;
        }

        if (child.isDir && !options.includeExcluded && EXCLUDED_DIRS.has(child.name)) {
          continue;
        }

        const absChild = nodePath.posix.join(currentDir, child.name);
        const relChild = absChild.startsWith(`${DAYTONA_WORKSPACE_ROOT}/`)
          ? absChild.slice(DAYTONA_WORKSPACE_ROOT.length + 1)
          : child.name;

        collected.push({
          path: relChild,
          absolutePath: absChild,
          isDir: child.isDir,
          sizeBytes: child.sizeBytes,
          updatedAt: child.updatedAt,
        });

        if (child.isDir && collected.length < 2500) {
          queue.push(absChild);
        }
      }
    }
  }

  return collected;
}

function decodeSnapshotBuffer(
  path: string,
  bytes: Buffer,
  sizeHint: number,
): { path: string; content: string; isBinary: boolean; sizeBytes: number } {
  const actualSize = bytes.byteLength || sizeHint;
  if (actualSize > MAX_TEXT_FILE_BYTES) {
    return { path, content: '', isBinary: true, sizeBytes: actualSize };
  }
  const isBinary = getEncoding(bytes, { chunkLength: 512 }) === 'binary';
  return {
    path,
    content: isBinary ? '' : bytes.toString('utf8'),
    isBinary,
    sizeBytes: actualSize,
  };
}

export async function snapshotWorkspaceTextFiles(options: {
  userId: string;
  projectId: string;
  sandboxId?: string | null;
  maxFiles?: number;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  entries: WorkspaceFileEntry[];
  files: Array<{ path: string; content: string; isBinary: boolean; sizeBytes: number }>;
  usage: WorkspaceUsageStats;
}> {
  const env = options.env ?? process.env;
  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  const entries = await listWorkspaceFilesRecursive({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: binding.sandboxId,
    env,
  });

  const fileEntries = entries.filter((e) => !e.isDir);
  const totalBytes = fileEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const usage: WorkspaceUsageStats = {
    totalFiles: fileEntries.length,
    totalBytes,
  };

  const maxFiles = options.maxFiles ?? 400;
  const targetEntries = fileEntries.slice(0, maxFiles);
  const files: Array<{ path: string; content: string; isBinary: boolean; sizeBytes: number }> = [];

  const textCandidates: WorkspaceFileEntry[] = [];
  for (const entry of targetEntries) {
    if (entry.sizeBytes > MAX_TEXT_FILE_BYTES) {
      files.push({
        path: entry.path,
        content: '',
        isBinary: true,
        sizeBytes: entry.sizeBytes,
      });
    } else {
      textCandidates.push(entry);
    }
  }

  const BULK_CHUNK_SIZE = 30;
  for (let i = 0; i < textCandidates.length; i += BULK_CHUNK_SIZE) {
    const chunk = textCandidates.slice(i, i + BULK_CHUNK_SIZE);
    const missingFromBulk: WorkspaceFileEntry[] = [];

    try {
      if (ctx.apiVersion === 'v0') {
        const res = await ctx.sandbox.fs.downloadFiles(chunk.map((entry) => ({ source: entry.absolutePath })));
        const bySource = new Map<string, Buffer>();
        for (const item of res || []) {
          if (item.result !== undefined && item.result !== null && !item.error) {
            const buf =
              typeof item.result === 'string'
                ? Buffer.from(item.result, 'utf8')
                : Buffer.isBuffer(item.result)
                  ? item.result
                  : Buffer.from(item.result);
            bySource.set(item.source, buf);
          }
        }
        for (const entry of chunk) {
          const buf = bySource.get(entry.absolutePath);
          if (buf) {
            files.push(decodeSnapshotBuffer(entry.path, buf, entry.sizeBytes));
          } else {
            missingFromBulk.push(entry);
          }
        }
      } else {
        const res = await ctx.sandbox.fs.readMany(
          chunk.map((entry) => entry.absolutePath),
          { maxResponseBytes: 32 * 1024 * 1024 },
        );
        for (const entry of chunk) {
          const raw = res.files[entry.absolutePath];
          if (raw) {
            files.push(decodeSnapshotBuffer(entry.path, Buffer.from(raw), entry.sizeBytes));
          } else {
            missingFromBulk.push(entry);
          }
        }
      }
    } catch {
      missingFromBulk.push(...chunk);
    }

    if (missingFromBulk.length > 0) {
      const CONCURRENCY = 6;
      for (let j = 0; j < missingFromBulk.length; j += CONCURRENCY) {
        const sub = missingFromBulk.slice(j, j + CONCURRENCY);
        const loaded = await Promise.all(
          sub.map(async (entry) => {
            try {
              const readRes = await readWorkspaceFileText({
                userId: options.userId,
                projectId: options.projectId,
                filePath: entry.path,
                sandboxId: binding.sandboxId,
                env,
              });
              return {
                path: entry.path,
                content: readRes.content,
                isBinary: readRes.isBinary,
                sizeBytes: readRes.sizeBytes,
              };
            } catch {
              return null;
            }
          }),
        );
        for (const item of loaded) {
          if (item) {
            files.push(item);
          }
        }
      }
    }
  }

  return { entries, files, usage };
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function runSandboxShell(
  ctx: CachedSandboxContext,
  command: string,
): Promise<{ exitCode: number; output: string }> {
  if (ctx.apiVersion === 'v0') {
    const res = await ctx.sandbox.process.executeCommand(command);
    const rawCode = (res as { exitCode?: number }).exitCode;
    return {
      exitCode: typeof rawCode === 'number' ? rawCode : 0,
      output: String((res as { result?: string }).result ?? ''),
    };
  }

  const res = await ctx.sandbox.exec(command);
  return {
    exitCode: typeof res.exitCode === 'number' ? res.exitCode : 0,
    output: String(res.output || `${res.stdout || ''}${res.stderr || ''}` || ''),
  };
}

function classifyGitCloneError(rawMessage: string): HttpAuthError {
  const clean = rawMessage.replace(/[\r\n]+/g, ' ').trim();
  const lower = clean.toLowerCase();

  if (
    lower.includes('could not read username') ||
    lower.includes('authentication failed') ||
    lower.includes('terminal prompts disabled') ||
    lower.includes('permission denied')
  ) {
    return new HttpAuthError(
      403,
      'Repository is private or requires GitHub authentication. Only public repositories can be cloned directly.',
    );
  }

  if (lower.includes('repository not found') || lower.includes('not found') || lower.includes('404')) {
    return new HttpAuthError(404, 'GitHub repository or branch was not found. Check the URL and branch name.');
  }

  if (lower.includes('remote branch') && lower.includes('not found')) {
    return new HttpAuthError(404, 'The requested branch was not found in the repository.');
  }

  if (lower.includes('function not implemented') || lower.includes('enosys')) {
    return new HttpAuthError(
      502,
      'Daytona Volume rejected direct git metadata writes; retrying via local staging failed. Try again or specify a fresh directory.',
    );
  }

  return new HttpAuthError(502, clean || 'Failed to clone Git repository into Daytona workspace.');
}

export function normalizeGitRepoUrl(rawInput: string): { repoUrl: string; repoName: string; parsedBranch?: string } {
  const trimmed = rawInput.trim();
  if (!trimmed || /[\0\r\n\s"'`$;|&<>]/.test(trimmed)) {
    throw new HttpAuthError(400, 'Invalid repository URL.');
  }

  let candidate = trimmed;

  // Support git@github.com:owner/repo(.git) by normalizing to HTTPS
  const sshMatch = candidate.match(/^git@([a-zA-Z0-9.-]+):([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/);
  if (sshMatch) {
    candidate = `https://${sshMatch[1]}/${sshMatch[2]}.git`;
  } else if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+(?:\.git)?$/.test(candidate)) {
    // Support owner/repo shorthand (defaults to GitHub)
    candidate = `https://github.com/${candidate}`;
  } else if (/^(?:github\.com|gitlab\.com|bitbucket\.org)\/[^\s]+$/i.test(candidate)) {
    // Support domain/owner/repo without explicit scheme
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new HttpAuthError(400, 'Repository URL must be a valid https:// Git URL or owner/repo.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new HttpAuthError(400, 'Only HTTP/HTTPS Git repository URLs are permitted.');
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    throw new HttpAuthError(400, 'Private or loopback repository hosts are blocked.');
  }

  // Strip GitHub /tree/<branch> or /blob/<branch> suffixes if user pasted a browser URL
  let parsedBranch: string | undefined;
  let pathname = parsed.pathname.replace(/\/+$/, '');
  const treeOrBlobMatch = pathname.match(/^(\/[^/]+\/[^/]+)\/(?:tree|blob)\/([^/]+)(?:\/.*)?$/);
  if (host === 'github.com' && treeOrBlobMatch) {
    pathname = treeOrBlobMatch[1];
    parsedBranch = decodeURIComponent(treeOrBlobMatch[2]);
  }

  const lastSeg = pathname.split('/').filter(Boolean).pop() || 'repo';
  const repoName = lastSeg.replace(/\.git$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-') || 'repo';
  const cleanUrl = `${parsed.origin}${pathname}`;

  return { repoUrl: cleanUrl, repoName, parsedBranch };
}

const SYSTEM_ROOT_ENTRIES = new Set(['.', '..', 'lost+found', '.whiterchat']);

async function pickUniqueSubdirInWorkspace(ctx: CachedSandboxContext, baseName: string): Promise<WorkspaceResolvedPath> {
  const rootChildren = await listDirectoryChildren(ctx, DAYTONA_WORKSPACE_ROOT);
  const existingNames = new Set(rootChildren.map((c) => c.name));

  let candidateName = baseName;
  let suffix = 2;
  while (existingNames.has(candidateName) && suffix <= 50) {
    candidateName = `${baseName}-${suffix}`;
    suffix++;
  }

  return resolveWorkspaceDirectory(candidateName, DAYTONA_WORKSPACE_ROOT);
}

export async function cloneGitRepoIntoWorkspace(options: {
  userId: string;
  projectId: string;
  repoUrl: string;
  branch?: string;
  targetDir?: string;
  depth?: number;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  sandboxId: string;
  repoUrl: string;
  branch?: string;
  clonedPath: string;
  entries: WorkspaceFileEntry[];
  files: Array<{ path: string; content: string; isBinary: boolean; sizeBytes: number }>;
  usage: WorkspaceUsageStats;
}> {
  const env = options.env ?? process.env;
  const { repoUrl, repoName, parsedBranch } = normalizeGitRepoUrl(options.repoUrl);
  const branch = options.branch?.trim() || parsedBranch;
  if (branch && (!/^[a-zA-Z0-9._/-]{1,120}$/.test(branch) || branch.startsWith('-'))) {
    throw new HttpAuthError(400, 'Invalid git branch name.');
  }

  const { ctx, binding } = await verifyAndGetProjectSandboxContext({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: options.sandboxId,
    env,
  });

  const existingRootItems = await listDirectoryChildren(ctx, DAYTONA_WORKSPACE_ROOT);
  const hasUserEntries = existingRootItems.some((item) => item.name && !SYSTEM_ROOT_ENTRIES.has(item.name));

  let destAbsPath = DAYTONA_WORKSPACE_ROOT;
  let clonedRelPath = '';

  if (options.targetDir && options.targetDir.trim() && options.targetDir.trim() !== '.') {
    const resolvedDir = resolveWorkspaceDirectory(options.targetDir.trim(), DAYTONA_WORKSPACE_ROOT);
    destAbsPath = resolvedDir.absolutePath;
    clonedRelPath = resolvedDir.relativePath;
  } else if (hasUserEntries) {
    const resolvedDir = await pickUniqueSubdirInWorkspace(ctx, repoName);
    destAbsPath = resolvedDir.absolutePath;
    clonedRelPath = resolvedDir.relativePath;
  }

  const urlCandidates = [repoUrl];
  if (!repoUrl.endsWith('.git') && /^https?:\/\/(?:github\.com|gitlab\.com|bitbucket\.org)\//i.test(repoUrl)) {
    urlCandidates.push(`${repoUrl}.git`);
  }

  const runSdkGitClone = async (url: string, targetAbs: string, shallowDepth?: number) => {
    if (ctx.apiVersion === 'v0') {
      await ctx.sandbox.git.clone(url, targetAbs, branch, undefined, undefined, undefined, undefined, shallowDepth);
    } else {
      await ctx.sandbox.git.clone(url, {
        path: targetAbs,
        ...(branch ? { branch } : {}),
        ...(shallowDepth !== undefined ? { depth: shallowDepth } : {}),
      });
    }
  };

  const runCliGitClone = async (url: string, targetAbs: string, shallowDepth?: number) => {
    const args: string[] = ['GIT_TERMINAL_PROMPT=0', 'git', 'clone'];
    if (shallowDepth !== undefined && shallowDepth > 0) {
      args.push('--depth', String(shallowDepth));
    }
    if (branch) {
      args.push('--branch', quoteShellArg(branch));
    }
    args.push('--', quoteShellArg(url), quoteShellArg(targetAbs));

    const res = await runSandboxShell(ctx, args.join(' '));
    if (res.exitCode !== 0) {
      throw new Error(res.output || `git clone failed with exit code ${res.exitCode}`);
    }
  };

  const cloneIntoStagingAndMove = async (url: string, targetAbs: string, shallowDepth?: number) => {
    const tmpDir = `/tmp/wc-clone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      try {
        await runSdkGitClone(url, tmpDir, shallowDepth);
      } catch {
        await runSandboxShell(ctx, `rm -rf ${quoteShellArg(tmpDir)}`).catch(() => undefined);
        await runCliGitClone(url, tmpDir, shallowDepth);
      }

      // Daytona Volumes are FUSE-mounted and reject certain POSIX calls on .git/config, xattrs, or symlinks.
      // Stage in /tmp, strip .git, and stream working-tree files into the volume without preserving owner/mode.
      const moveCmd = [
        `mkdir -p ${quoteShellArg(targetAbs)}`,
        `rm -rf ${quoteShellArg(`${tmpDir}/.git`)}`,
        `(((cd ${quoteShellArg(tmpDir)} && tar -cf - .) | (cd ${quoteShellArg(targetAbs)} && tar --no-same-owner --no-same-permissions -xf -)) || ((cd ${quoteShellArg(tmpDir)} && tar -chf - .) | (cd ${quoteShellArg(targetAbs)} && tar --no-same-owner --no-same-permissions -xf -)) || cp -rfL --no-preserve=all ${quoteShellArg(tmpDir)}/. ${quoteShellArg(targetAbs)}/ || cp -rf ${quoteShellArg(tmpDir)}/. ${quoteShellArg(targetAbs)}/)`,
        `rm -rf ${quoteShellArg(tmpDir)}`,
      ].join(' && ');

      const moveRes = await runSandboxShell(ctx, moveCmd);
      if (moveRes.exitCode !== 0) {
        throw new Error(moveRes.output || 'Failed to move cloned repository files into workspace.');
      }
    } catch (err) {
      await runSandboxShell(ctx, `rm -rf ${quoteShellArg(tmpDir)}`).catch(() => undefined);
      throw err;
    }
  };

  const requestedDepth = options.depth ?? 1;
  const depthAttempts: Array<number | undefined> =
    requestedDepth > 0 ? [requestedDepth, undefined] : [undefined];

  let lastError: unknown = null;
  let succeeded = false;

  outer: for (const candidateUrl of urlCandidates) {
    for (const attemptDepth of depthAttempts) {
      try {
        // Always stage via /tmp regardless of whether target is /workspace or /workspace/<subdir>
        await cloneIntoStagingAndMove(candidateUrl, destAbsPath, attemptDepth);
        succeeded = true;
        break outer;
      } catch (err) {
        lastError = err;
      }
    }
  }

  if (!succeeded) {
    const rawMsg = lastError instanceof Error ? lastError.message : String(lastError || 'Clone failed');
    throw classifyGitCloneError(rawMsg);
  }

  const { flushWorkspaceVolumeChanges } = await import('./client');
  await flushWorkspaceVolumeChanges(binding.sandboxId, env).catch(() => undefined);

  const snapshot = await snapshotWorkspaceTextFiles({
    userId: options.userId,
    projectId: options.projectId,
    sandboxId: binding.sandboxId,
    env,
  });

  return {
    sandboxId: binding.sandboxId,
    repoUrl,
    branch,
    clonedPath: clonedRelPath || '/',
    ...snapshot,
  };
}

export async function getWorkspaceUsage(options: {
  userId: string;
  projectId: string;
  sandboxId?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<WorkspaceUsageStats> {
  const entries = await listWorkspaceFilesRecursive(options);
  const files = entries.filter((e) => !e.isDir);
  return {
    totalFiles: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
  };
}
