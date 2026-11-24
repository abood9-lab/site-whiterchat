import crypto from 'node:crypto';
import { getCloudinaryConfig, type CloudinaryConfig } from '~/lib/.server/cloudinary';
import {
  readWorkspaceFileBytes,
  statWorkspaceFile,
  writeWorkspaceBinaryFile,
  writeWorkspaceTextFile,
} from '~/lib/.server/daytona/files';
import { buildIsolatedProjectSubpath, getProjectVolumeName } from '~/lib/.server/daytona/volumes';
import {
  firestoreRestListCollection,
  firestoreRestPatchDoc,
  firestoreRestUpsertFileMeta,
  firestoreRestUpsertProject,
} from '~/lib/.server/firebase/firestoreRest';
import {
  assertValidIdentifier,
  computeSha256Hex,
  detectMimeType,
  resolveWorkspacePath,
} from '~/lib/.server/security/auth';

export type MigrationItemStatus =
  | 'pending'
  | 'downloading'
  | 'uploading'
  | 'verifying'
  | 'completed'
  | 'skipped'
  | 'failed';

export type MigrationJobStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface DiscoveredLegacyAsset {
  itemId: string;
  ownerId: string;
  projectId: string;
  kind: 'project' | 'profile';
  relativePath: string;
  cloudinaryPublicId: string;
  cloudinaryUrl: string;
  resourceType: 'image' | 'raw' | 'video';
  format?: string;
  bytes?: number;
}

export interface MigrationItemRecord extends DiscoveredLegacyAsset {
  status: MigrationItemStatus;
  destinationSubpath: string;
  sha256?: string;
  verifiedBytes?: number;
  attempts: number;
  errorMessage?: string;
  updatedAt: string;
}

export interface MigrationJobState {
  jobId: string;
  startedBy: string;
  status: MigrationJobStatus;
  totalDiscovered: number;
  completedCount: number;
  skippedCount: number;
  failedCount: number;
  lastCursor?: string;
  startedAt: string;
  updatedAt: string;
  items: MigrationItemRecord[];
  errorSummary?: string;
}

const DEFAULT_PROJECT_BUCKET_ID = 'default_workspace';
let currentJob: MigrationJobState | null = null;
let pauseRequested = false;
let activeRunnerPromise: Promise<void> | null = null;

export function decodeLegacyCloudinarySegment(segment: string): string {
  if (segment.startsWith('_dot_')) {
    return `.${segment.slice(5)}`;
  }
  return segment;
}

export function normalizeLegacyRelativePath(rawPath: string): string {
  const cleaned = rawPath.replace(/^\/home\/project\/?/, '').replace(/^\/+/, '');
  return cleaned
    .split('/')
    .filter(Boolean)
    .map(decodeLegacyCloudinarySegment)
    .join('/');
}

export function parseCloudinaryPublicIdTarget(publicId: string): {
  ownerId: string;
  projectId: string;
  kind: 'project' | 'profile';
  relativePath: string;
} | null {
  const clean = publicId.replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);

  if (parts[0] !== 'bolt_projects' || parts.length < 3) {
    return null;
  }

  const ownerId = parts[1].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  if (!ownerId) {
    return null;
  }

  // Case 1: bolt_projects/{uid}/profile_avatars/...
  if (parts[2] === 'profile_avatars' && parts.length >= 4) {
    const fileParts = parts.slice(3).map(decodeLegacyCloudinarySegment);
    return {
      ownerId,
      projectId: '_profile',
      kind: 'profile',
      relativePath: `avatars/${fileParts.join('/')}`,
    };
  }

  // Case 2: bolt_projects/{uid}/{chatId}/{...relativePath}
  if (parts.length >= 4) {
    const projectId = parts[2].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || DEFAULT_PROJECT_BUCKET_ID;
    const rel = parts.slice(3).map(decodeLegacyCloudinarySegment).join('/');
    if (!rel) {
      return null;
    }
    return {
      ownerId,
      projectId,
      kind: 'project',
      relativePath: rel,
    };
  }

  // Case 3: bolt_projects/{uid}/{filename} (global upload with no chatId)
  const rel = parts.slice(2).map(decodeLegacyCloudinarySegment).join('/');
  return {
    ownerId,
    projectId: DEFAULT_PROJECT_BUCKET_ID,
    kind: 'project',
    relativePath: rel,
  };
}

function buildItemId(ownerId: string, projectId: string, relativePath: string): string {
  const hash = crypto.createHash('sha1').update(`${ownerId}:${projectId}:${relativePath}`).digest('hex').slice(0, 16);
  return `mig_${ownerId.slice(0, 16)}_${projectId.slice(0, 16)}_${hash}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function signCloudinaryDownloadUrl(
  config: CloudinaryConfig,
  publicId: string,
  resourceType: 'image' | 'raw' | 'video',
  format?: string,
): string {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    public_id: publicId,
    timestamp,
  };
  if (format) {
    params.format = format;
  }

  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const signature = crypto.createHash('sha1').update(`${paramString}${config.apiSecret}`).digest('hex');

  const qs = new URLSearchParams({
    ...params,
    api_key: config.apiKey,
    signature,
  });

  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/download?${qs.toString()}`;
}

export async function downloadLegacyCloudinaryAsset(
  asset: DiscoveredLegacyAsset,
  config: CloudinaryConfig,
): Promise<Buffer> {
  // Prefer direct secure_url first; fall back to authenticated Cloudinary Admin download endpoint
  if (asset.cloudinaryUrl && asset.cloudinaryUrl.startsWith('https://res.cloudinary.com/')) {
    const directRes = await fetch(asset.cloudinaryUrl);
    if (directRes.ok) {
      const arrayBuf = await directRes.arrayBuffer();
      return Buffer.from(arrayBuf);
    }
  }

  const signedUrl = signCloudinaryDownloadUrl(config, asset.cloudinaryPublicId, asset.resourceType, asset.format);
  const signedRes = await fetch(signedUrl);
  if (!signedRes.ok) {
    throw new Error(`Cloudinary download failed with HTTP ${signedRes.status} for ${asset.cloudinaryPublicId}`);
  }

  return Buffer.from(await signedRes.arrayBuffer());
}

export async function discoverCloudinaryLegacyAssets(options?: {
  config?: CloudinaryConfig | null;
  firestoreFiles?: Array<{
    id?: string;
    userId?: string;
    chatId?: string;
    path?: string;
    cloudinaryUrl?: string;
    publicId?: string;
    resourceType?: string;
    bytes?: number;
  }>;
  idToken?: string;
}): Promise<DiscoveredLegacyAsset[]> {
  const discovered = new Map<string, DiscoveredLegacyAsset>();

  // 1. Seed from Firestore `files` collection if idToken available or explicit records passed
  let firestoreRecords = options?.firestoreFiles || [];
  if (firestoreRecords.length === 0 && options?.idToken) {
    firestoreRecords = await firestoreRestListCollection<{
      id?: string;
      userId?: string;
      chatId?: string;
      path?: string;
      cloudinaryUrl?: string;
      publicId?: string;
      resourceType?: string;
      bytes?: number;
    }>('files', options.idToken, 300);
  }

  for (const doc of firestoreRecords) {
    if (!doc.userId || !doc.path || !doc.cloudinaryUrl) {
      continue;
    }

    const ownerId = doc.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const isProfile = doc.chatId === 'profile_avatars';
    const rawProjectId = isProfile
      ? '_profile'
      : (doc.chatId || DEFAULT_PROJECT_BUCKET_ID).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
    const relPath = isProfile
      ? `avatars/${normalizeLegacyRelativePath(doc.path.replace(/^uploads\//, ''))}`
      : normalizeLegacyRelativePath(doc.path);

    if (!relPath) {
      continue;
    }

    const publicId = doc.publicId || `bolt_projects/${ownerId}/${doc.chatId || DEFAULT_PROJECT_BUCKET_ID}/${relPath}`;
    const itemId = buildItemId(ownerId, rawProjectId, relPath);
    const resType: 'image' | 'raw' | 'video' =
      doc.resourceType === 'image' ? 'image' : doc.resourceType === 'video' ? 'video' : 'raw';

    discovered.set(`${ownerId}:${rawProjectId}:${relPath}`, {
      itemId,
      ownerId,
      projectId: rawProjectId,
      kind: isProfile ? 'profile' : 'project',
      relativePath: relPath,
      cloudinaryPublicId: publicId,
      cloudinaryUrl: doc.cloudinaryUrl,
      resourceType: resType,
      bytes: doc.bytes,
    });
  }

  // 2. Scan Cloudinary Admin API directly for anything under bolt_projects/
  const config = options?.config ?? getCloudinaryConfig();
  if (config) {
    const authToken = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');

    for (const resourceType of ['raw', 'image', 'video'] as const) {
      let nextCursor: string | undefined;
      let pageGuard = 0;

      do {
        pageGuard += 1;
        const params = new URLSearchParams({
          type: 'upload',
          prefix: 'bolt_projects/',
          max_results: '100',
        });
        if (nextCursor) {
          params.set('next_cursor', nextCursor);
        }

        const apiUrl = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/resources/${resourceType}?${params.toString()}`;
        const res = await fetch(apiUrl, {
          headers: {
            Authorization: `Basic ${authToken}`,
          },
        });

        if (!res.ok) {
          break;
        }

        const payload = (await res.json()) as {
          resources?: Array<{
            public_id: string;
            secure_url: string;
            resource_type?: string;
            format?: string;
            bytes?: number;
          }>;
          next_cursor?: string;
        };

        for (const item of payload.resources || []) {
          const parsed = parseCloudinaryPublicIdTarget(item.public_id);
          if (!parsed) {
            continue;
          }

          const key = `${parsed.ownerId}:${parsed.projectId}:${parsed.relativePath}`;
          if (discovered.has(key)) {
            continue;
          }

          discovered.set(key, {
            itemId: buildItemId(parsed.ownerId, parsed.projectId, parsed.relativePath),
            ownerId: parsed.ownerId,
            projectId: parsed.projectId,
            kind: parsed.kind,
            relativePath: parsed.relativePath,
            cloudinaryPublicId: item.public_id,
            cloudinaryUrl: item.secure_url,
            resourceType,
            format: item.format,
            bytes: item.bytes,
          });
        }

        nextCursor = payload.next_cursor;
      } while (nextCursor && pageGuard < 30);
    }
  }

  return Array.from(discovered.values());
}

function isLikelyTextExtension(filePath: string): boolean {
  const mime = detectMimeType(filePath);
  return (
    mime.startsWith('text/') ||
    mime.includes('javascript') ||
    mime.includes('json') ||
    mime.includes('yaml') ||
    mime.includes('xml') ||
    mime.includes('toml') ||
    filePath.endsWith('.env') ||
    filePath.endsWith('.gitignore') ||
    filePath.endsWith('.prettierrc') ||
    filePath.endsWith('.eslintrc')
  );
}

async function migrateSingleAssetWithVerification(
  item: MigrationItemRecord,
  config: CloudinaryConfig,
  idToken?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrationItemRecord> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    item.attempts = attempt;
    item.updatedAt = new Date().toISOString();

    try {
      const safeRel = resolveWorkspacePath(item.relativePath).relativePath;

      // Download original asset bytes from Cloudinary (read-only)
      item.status = 'downloading';
      const buffer = await downloadLegacyCloudinaryAsset(item, config);
      const sourceSha = computeSha256Hex(buffer);

      // Idempotency check: skip upload if Daytona already holds identical byte checksum
      try {
        const existingStat = await statWorkspaceFile({
          userId: item.ownerId,
          projectId: item.projectId === '_profile' ? 'profile' : item.projectId,
          filePath: safeRel,
          env,
        });

        if (existingStat.exists && !existingStat.isDir && existingStat.sizeBytes === buffer.byteLength) {
          const existingRead = await readWorkspaceFileBytes({
            userId: item.ownerId,
            projectId: item.projectId === '_profile' ? 'profile' : item.projectId,
            filePath: safeRel,
            kind: item.kind,
            env,
          });
          if (existingRead.sha256 === sourceSha) {
            item.status = 'skipped';
            item.sha256 = sourceSha;
            item.verifiedBytes = existingRead.bytes.byteLength;
            item.errorMessage = undefined;
            item.updatedAt = new Date().toISOString();
            return item;
          }
        }
      } catch {
        // Proceed with write when file does not exist yet
      }

      // Upload into owner's isolated Daytona Volume subpath
      item.status = 'uploading';
      const targetProjectId = item.kind === 'profile' ? 'profile' : assertValidIdentifier(item.projectId, 'projectId');

      if (isLikelyTextExtension(safeRel) && item.resourceType === 'raw') {
        await writeWorkspaceTextFile({
          userId: item.ownerId,
          projectId: targetProjectId,
          filePath: safeRel,
          content: buffer.toString('utf8'),
          kind: item.kind,
          env,
        });
      } else {
        await writeWorkspaceBinaryFile({
          userId: item.ownerId,
          projectId: targetProjectId,
          filePath: safeRel,
          data: buffer,
          mimeType: detectMimeType(safeRel),
          kind: item.kind,
          env,
        });
      }

      // Read back from Daytona Volume & verify byte length + SHA-256
      item.status = 'verifying';
      const verified = await readWorkspaceFileBytes({
        userId: item.ownerId,
        projectId: targetProjectId,
        filePath: safeRel,
        kind: item.kind,
        env,
      });

      if (verified.bytes.byteLength !== buffer.byteLength || verified.sha256 !== sourceSha) {
        throw new Error(
          `Integrity check failed for ${safeRel}: expected ${buffer.byteLength}B/${sourceSha.slice(0, 8)}, got ${verified.bytes.byteLength}B/${verified.sha256.slice(0, 8)}.`,
        );
      }

      item.status = 'completed';
      item.sha256 = verified.sha256;
      item.verifiedBytes = verified.bytes.byteLength;
      item.errorMessage = undefined;
      item.updatedAt = new Date().toISOString();

      // Update Firestore project & file metadata if admin idToken provided (non-fatal)
      if (idToken && item.kind === 'project') {
        const volumeName = getProjectVolumeName(env);
        const subpath = buildIsolatedProjectSubpath(item.ownerId, targetProjectId);
        await firestoreRestUpsertProject(
          {
            userId: item.ownerId,
            projectId: targetProjectId,
            volumeName,
            volumeSubpath: subpath,
            migrationStatus: 'in_progress',
          },
          idToken,
        ).catch(() => undefined);

        await firestoreRestUpsertFileMeta(
          {
            userId: item.ownerId,
            projectId: targetProjectId,
            fileId: item.itemId,
            relativePath: safeRel,
            mimeType: detectMimeType(safeRel),
            sizeBytes: verified.bytes.byteLength,
            sha256: verified.sha256,
            legacyCloudinaryPublicId: item.cloudinaryPublicId,
          },
          idToken,
        ).catch(() => undefined);
      }

      return item;
    } catch (error) {
      item.errorMessage = error instanceof Error ? error.message : 'Migration step failed';
      item.updatedAt = new Date().toISOString();
      if (attempt >= maxAttempts) {
        item.status = 'failed';
      } else {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
  }

  return item;
}

async function persistMigrationProgressToFirestore(job: MigrationJobState, idToken?: string): Promise<void> {
  if (!idToken) {
    return;
  }

  await firestoreRestPatchDoc(
    `migrations/${job.jobId}`,
    {
      jobId: job.jobId,
      startedBy: job.startedBy,
      status: job.status,
      totalDiscovered: job.totalDiscovered,
      completedCount: job.completedCount,
      skippedCount: job.skippedCount,
      failedCount: job.failedCount,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
    },
    idToken,
  ).catch(() => undefined);
}

function recalculateCounts(job: MigrationJobState) {
  let completed = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of job.items) {
    if (item.status === 'completed') completed += 1;
    else if (item.status === 'skipped') skipped += 1;
    else if (item.status === 'failed') failed += 1;
  }
  job.completedCount = completed;
  job.skippedCount = skipped;
  job.failedCount = failed;
  job.updatedAt = new Date().toISOString();
}

export async function startCloudinaryMigration(options: {
  startedByUid: string;
  idToken?: string;
  onlyFailedRetry?: boolean;
  env?: NodeJS.ProcessEnv;
}): Promise<MigrationJobState> {
  const env = options.env ?? process.env;
  const config = getCloudinaryConfig(env);
  if (!config) {
    throw new Error('Cloudinary credentials are required to run the read-only migration.');
  }

  if (activeRunnerPromise && currentJob?.status === 'running') {
    return getMigrationJobStatus();
  }

  pauseRequested = false;

  if (!currentJob || !options.onlyFailedRetry) {
    const assets = await discoverCloudinaryLegacyAssets({
      config,
      idToken: options.idToken,
    });

    const now = new Date().toISOString();
    const existingByKey = new Map<string, MigrationItemRecord>();
    if (currentJob) {
      for (const prev of currentJob.items) {
        existingByKey.set(prev.itemId, prev);
      }
    }

    const items: MigrationItemRecord[] = assets.map((asset) => {
      const prev = existingByKey.get(asset.itemId);
      if (prev && (prev.status === 'completed' || prev.status === 'skipped')) {
        return prev;
      }

      const subpath =
        asset.kind === 'profile'
          ? `users/${asset.ownerId}/_profile/${asset.relativePath}`
          : `${buildIsolatedProjectSubpath(asset.ownerId, asset.projectId)}/${asset.relativePath}`;

      return {
        ...asset,
        status: 'pending',
        destinationSubpath: subpath,
        attempts: 0,
        updatedAt: now,
      };
    });

    currentJob = {
      jobId: currentJob?.jobId || `migjob_${Date.now().toString(36)}`,
      startedBy: options.startedByUid,
      status: 'running',
      totalDiscovered: items.length,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startedAt: currentJob?.startedAt || now,
      updatedAt: now,
      items,
    };
  } else {
    currentJob.status = 'running';
    for (const item of currentJob.items) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.errorMessage = undefined;
      }
    }
  }

  recalculateCounts(currentJob);
  await persistMigrationProgressToFirestore(currentJob, options.idToken);

  const jobRef = currentJob;
  activeRunnerPromise = (async () => {
    try {
      for (const item of jobRef.items) {
        if (pauseRequested) {
          jobRef.status = 'paused';
          recalculateCounts(jobRef);
          await persistMigrationProgressToFirestore(jobRef, options.idToken);
          return;
        }

        if (item.status === 'completed' || item.status === 'skipped') {
          continue;
        }

        if (options.onlyFailedRetry && item.status !== 'pending') {
          continue;
        }

        await migrateSingleAssetWithVerification(item, config, options.idToken, env);
        recalculateCounts(jobRef);
        await persistMigrationProgressToFirestore(jobRef, options.idToken);
      }

      recalculateCounts(jobRef);
      jobRef.status = jobRef.failedCount > 0 ? 'failed' : 'completed';
      await persistMigrationProgressToFirestore(jobRef, options.idToken);
    } finally {
      activeRunnerPromise = null;
    }
  })();

  return getMigrationJobStatus();
}

export function pauseCloudinaryMigration(): MigrationJobState {
  pauseRequested = true;
  if (currentJob && currentJob.status === 'running') {
    currentJob.status = 'paused';
    currentJob.updatedAt = new Date().toISOString();
  }
  return getMigrationJobStatus();
}

export function getMigrationJobStatus(): MigrationJobState {
  if (!currentJob) {
    return {
      jobId: 'none',
      startedBy: '',
      status: 'idle',
      totalDiscovered: 0,
      completedCount: 0,
      skippedCount: 0,
      failedCount: 0,
      startedAt: '',
      updatedAt: '',
      items: [],
    };
  }

  return {
    ...currentJob,
    items: currentJob.items.slice(0, 200),
  };
}
