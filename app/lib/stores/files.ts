import type { PathWatcherEvent, WebContainer } from '@webcontainer/api';
import { getEncoding } from 'istextorbinary';
import { map, type MapStore } from 'nanostores';
import { Buffer } from 'node:buffer';
import { normalizeWorkspaceRelPath, posixDirname, posixRelative } from '~/utils/posixPath';
import {
  deleteWorkspaceFileClient,
  mkdirWorkspaceDirectoryClient,
  renameWorkspaceFileClient,
  writeWorkspaceFile,
} from '~/lib/daytona/workspace.client';
import { bufferWatchEvents } from '~/utils/buffer';
import { WORK_DIR } from '~/utils/constants';
import { computeFileModifications } from '~/utils/diff';
import { createScopedLogger } from '~/utils/logger';
import {
  activeProjectIdStore,
  daytonaStateStore,
  markWorkspaceFileSynced,
  markWorkspaceFilesSynced,
} from './runtime';

const logger = createScopedLogger('FilesStore');

const utf8TextDecoder = new TextDecoder('utf8', { fatal: true });

export interface File {
  type: 'file';
  content: string;
  isBinary: boolean;
}

export interface Folder {
  type: 'folder';
}

type Dirent = File | Folder;

export type FileMap = Record<string, Dirent | undefined>;

export class FilesStore {
  #webcontainer: Promise<WebContainer>;
  #size = 0;
  #modifiedFiles: Map<string, string> = import.meta.hot?.data.modifiedFiles ?? new Map();
  files: MapStore<FileMap> = import.meta.hot?.data.files ?? map({});

  get filesCount() {
    return this.#size;
  }

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.files = this.files;
      import.meta.hot.data.modifiedFiles = this.#modifiedFiles;
    }

    this.#init();
  }

  async #getReadyWebContainer(timeoutMs = 1500): Promise<WebContainer | null> {
    try {
      const wc = await Promise.race([
        this.#webcontainer,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      return wc;
    } catch {
      return null;
    }
  }

  #recomputeFilesCount() {
    let count = 0;
    for (const dirent of Object.values(this.files.get())) {
      if (dirent?.type === 'file') {
        count++;
      }
    }
    this.#size = count;
  }

  #ensureParentFolderEntries(relPath: string) {
    const segments = relPath.split('/').filter(Boolean);
    let curr = WORK_DIR;
    for (let i = 0; i < segments.length - 1; i++) {
      curr = `${curr}/${segments[i]}`;
      if (!this.files.get()[curr]) {
        this.files.setKey(curr, { type: 'folder' });
      }
    }
  }

  getFile(filePath: string) {
    const dirent = this.files.get()[filePath];

    if (dirent?.type !== 'file') {
      return undefined;
    }

    return dirent;
  }

  getFileModifications() {
    return computeFileModifications(this.files.get(), this.#modifiedFiles);
  }

  resetFileModifications() {
    this.#modifiedFiles.clear();
  }

  upsertFileFromAction(filePath: string, content: string): string | null {
    const relPath = normalizeWorkspaceRelPath(filePath);
    if (!relPath) {
      return null;
    }

    const fullPath = `${WORK_DIR}/${relPath}`;
    const existed = this.files.get()[fullPath]?.type === 'file';
    this.#ensureParentFolderEntries(relPath);
    this.files.setKey(fullPath, { type: 'file', content, isBinary: false });
    if (!existed) {
      this.#size++;
    }
    return fullPath;
  }

  hydrateFromDaytona(
    snapshotFiles: Array<{ path: string; content: string; isBinary: boolean; sizeBytes?: number }>,
    snapshotEntries?: Array<{ path: string; isDir: boolean }>,
    options?: { projectId?: string; pruneRemoved?: boolean; onlyIfDifferent?: boolean },
  ): string[] {
    const projectId = options?.projectId || activeProjectIdStore.get() || daytonaStateStore.get().projectId;
    const orderedFiles = [...snapshotFiles].sort((a, b) => {
      const aPriority = a.path === '.env' || a.path === '.gitignore' ? 0 : 1;
      const bPriority = b.path === '.env' || b.path === '.gitignore' ? 0 : 1;
      return aPriority - bPriority;
    });

    const keepPaths = new Set<string>();
    const hydratedFullPaths: string[] = [];
    const textFilesToSyncMark: Array<{ path: string; content: string }> = [];
    const wcWriteQueue: Array<{ relPath: string; content: string }> = [];

    if (snapshotEntries) {
      for (const entry of snapshotEntries) {
        if (!entry.isDir) {
          continue;
        }
        const relDir = normalizeWorkspaceRelPath(entry.path);
        if (!relDir) {
          continue;
        }
        const fullDir = `${WORK_DIR}/${relDir}`;
        keepPaths.add(fullDir);
        const parts = relDir.split('/').filter(Boolean);
        let curr = WORK_DIR;
        for (const part of parts) {
          curr = `${curr}/${part}`;
          keepPaths.add(curr);
          if (!this.files.get()[curr]) {
            this.files.setKey(curr, { type: 'folder' });
          }
        }
      }
    }

    for (const file of orderedFiles) {
      const relPath = normalizeWorkspaceRelPath(file.path);
      if (!relPath) {
        continue;
      }

      const fullPath = `${WORK_DIR}/${relPath}`;
      keepPaths.add(fullPath);

      const segments = relPath.split('/').filter(Boolean);
      let curr = WORK_DIR;
      for (let i = 0; i < segments.length - 1; i++) {
        curr = `${curr}/${segments[i]}`;
        keepPaths.add(curr);
        if (!this.files.get()[curr]) {
          this.files.setKey(curr, { type: 'folder' });
        }
      }

      const existing = this.files.get()[fullPath];
      const textContent = file.isBinary ? '' : file.content;

      if (!options?.onlyIfDifferent || existing?.type !== 'file' || existing.content !== textContent || existing.isBinary !== file.isBinary) {
        this.files.setKey(fullPath, {
          type: 'file',
          content: textContent,
          isBinary: file.isBinary,
        });
      }

      hydratedFullPaths.push(fullPath);

      if (!file.isBinary) {
        textFilesToSyncMark.push({ path: relPath, content: textContent });
        wcWriteQueue.push({ relPath, content: textContent });
      }
    }

    if (options?.pruneRemoved) {
      for (const existingPath of Object.keys(this.files.get())) {
        if (existingPath.startsWith(`${WORK_DIR}/`) && !keepPaths.has(existingPath)) {
          this.files.setKey(existingPath, undefined);
        }
      }
    }

    if (projectId && textFilesToSyncMark.length > 0) {
      markWorkspaceFilesSynced(projectId, textFilesToSyncMark);
    }

    this.#recomputeFilesCount();

    if (wcWriteQueue.length > 0) {
      void this.#mirrorToWebContainer(wcWriteQueue, options?.onlyIfDifferent ?? false);
    }

    return hydratedFullPaths;
  }

  async #mirrorToWebContainer(
    files: Array<{ relPath: string; content: string }>,
    onlyIfDifferent: boolean,
  ): Promise<void> {
    const wc = await this.#getReadyWebContainer(4000);
    if (!wc) {
      return;
    }

    for (const file of files) {
      try {
        if (onlyIfDifferent) {
          const existing = await wc.fs.readFile(file.relPath, 'utf-8').catch(() => null);
          if (existing === file.content) {
            continue;
          }
        }
        const dir = posixDirname(file.relPath).replace(/\/+$/g, '');
        if (dir && dir !== '.') {
          await wc.fs.mkdir(dir, { recursive: true }).catch(() => undefined);
        }
        await wc.fs.writeFile(file.relPath, file.content);
      } catch {
        // Non-fatal WebContainer mirror error
      }
    }
  }

  async saveFile(filePath: string, content: string) {
    try {
      const relativePath = normalizeWorkspaceRelPath(filePath);

      if (!relativePath) {
        throw new Error(`EINVAL: invalid file path, write '${filePath}'`);
      }

      const oldContent = this.getFile(filePath)?.content ?? '';

      const wc = await this.#getReadyWebContainer();
      if (wc) {
        const wcRel = posixRelative(wc.workdir, filePath) || relativePath;
        const dir = posixDirname(wcRel).replace(/\/+$/g, '');
        if (dir && dir !== '.') {
          await wc.fs.mkdir(dir, { recursive: true }).catch(() => undefined);
        }
        await wc.fs.writeFile(wcRel, content).catch(() => undefined);
      }

      // Persist directly to Daytona Volume when Daytona is configured
      const daytonaState = daytonaStateStore.get();
      if (daytonaState.configured) {
        const targetProject = activeProjectIdStore.get() || daytonaState.projectId;
        await writeWorkspaceFile(targetProject, relativePath, content, daytonaState.sandboxId)
          .then(() => {
            markWorkspaceFileSynced(targetProject, relativePath, content);
          })
          .catch((err) => {
            logger.warn('Daytona volume file save fallback warning', err);
          });
      }

      if (!this.#modifiedFiles.has(filePath)) {
        this.#modifiedFiles.set(filePath, oldContent);
      }

      this.#ensureParentFolderEntries(relativePath);
      this.files.setKey(filePath, { type: 'file', content, isBinary: false });
      this.#recomputeFilesCount();
      logger.info('File updated');
    } catch (error) {
      logger.error('Failed to update file content\n\n', error);
      throw error;
    }
  }

  async createFile(relativePath: string, content = '') {
    const rel = normalizeWorkspaceRelPath(relativePath);
    if (!rel) {
      throw new Error('Invalid file path');
    }

    const fullPath = `${WORK_DIR}/${rel}`;
    const wc = await this.#getReadyWebContainer();
    if (wc) {
      const dir = posixDirname(rel).replace(/\/+$/g, '');
      if (dir && dir !== '.') {
        await wc.fs.mkdir(dir, { recursive: true }).catch(() => undefined);
      }
      await wc.fs.writeFile(rel, content).catch(() => undefined);
    }

    const daytonaState = daytonaStateStore.get();
    if (daytonaState.configured) {
      const targetProject = activeProjectIdStore.get() || daytonaState.projectId;
      await writeWorkspaceFile(targetProject, rel, content, daytonaState.sandboxId);
      markWorkspaceFileSynced(targetProject, rel, content);
    }

    this.#ensureParentFolderEntries(rel);
    this.files.setKey(fullPath, { type: 'file', content, isBinary: false });
    this.#recomputeFilesCount();
    return fullPath;
  }

  async createFolder(relativePath: string) {
    const rel = normalizeWorkspaceRelPath(relativePath);
    if (!rel) {
      return;
    }
    const wc = await this.#getReadyWebContainer();
    if (wc) {
      await wc.fs.mkdir(rel, { recursive: true }).catch(() => undefined);
    }

    const daytonaState = daytonaStateStore.get();
    if (daytonaState.configured) {
      await mkdirWorkspaceDirectoryClient(
        activeProjectIdStore.get() || daytonaState.projectId,
        rel,
        daytonaState.sandboxId,
      );
    }
    this.#ensureParentFolderEntries(`${rel}/_`);
    this.files.setKey(`${WORK_DIR}/${rel}`, { type: 'folder' });
  }

  async deletePath(filePath: string) {
    const rel = normalizeWorkspaceRelPath(filePath);
    if (!rel) {
      return;
    }
    const wc = await this.#getReadyWebContainer();
    if (wc) {
      await wc.fs.rm(rel, { recursive: true, force: true }).catch(() => undefined);
    }

    const daytonaState = daytonaStateStore.get();
    if (daytonaState.configured) {
      await deleteWorkspaceFileClient(
        activeProjectIdStore.get() || daytonaState.projectId,
        rel,
        true,
        daytonaState.sandboxId,
      );
    }

    const targetAbs = `${WORK_DIR}/${rel}`;
    this.files.setKey(targetAbs, undefined);
    for (const [k] of Object.entries(this.files.get())) {
      if (k.startsWith(`${targetAbs}/`)) {
        this.files.setKey(k, undefined);
      }
    }
    this.#recomputeFilesCount();
  }

  async renamePath(sourcePath: string, destinationPath: string) {
    const srcRel = normalizeWorkspaceRelPath(sourcePath);
    const dstRel = normalizeWorkspaceRelPath(destinationPath);
    if (!srcRel || !dstRel) {
      return;
    }

    const existing = this.getFile(`${WORK_DIR}/${srcRel}`);
    const wc = await this.#getReadyWebContainer();
    if (wc && existing && !existing.isBinary) {
      const dstDir = posixDirname(dstRel).replace(/\/+$/g, '');
      if (dstDir && dstDir !== '.') {
        await wc.fs.mkdir(dstDir, { recursive: true }).catch(() => undefined);
      }
      await wc.fs.writeFile(dstRel, existing.content).catch(() => undefined);
      await wc.fs.rm(srcRel, { force: true }).catch(() => undefined);
    }

    const daytonaState = daytonaStateStore.get();
    if (daytonaState.configured) {
      await renameWorkspaceFileClient(
        activeProjectIdStore.get() || daytonaState.projectId,
        srcRel,
        dstRel,
        daytonaState.sandboxId,
      );
    }

    if (existing) {
      this.files.setKey(`${WORK_DIR}/${srcRel}`, undefined);
      this.#ensureParentFolderEntries(dstRel);
      this.files.setKey(`${WORK_DIR}/${dstRel}`, existing);
      if (!existing.isBinary) {
        const targetProject = activeProjectIdStore.get() || daytonaState.projectId;
        markWorkspaceFileSynced(targetProject, dstRel, existing.content);
      }
    }
  }

  async #init() {
    const webcontainer = await this.#webcontainer.catch(() => null);
    if (!webcontainer) {
      return;
    }

    webcontainer.internal.watchPaths(
      { include: [`${WORK_DIR}/**`], exclude: ['**/node_modules', '.git'], includeContent: true },
      bufferWatchEvents(100, this.#processEventBuffer.bind(this)),
    );
  }

  #processEventBuffer(events: Array<[events: PathWatcherEvent[]]>) {
    const watchEvents = events.flat(2);

    for (const { type, path, buffer } of watchEvents) {
      const sanitizedPath = path.replace(/\/+$/g, '');

      switch (type) {
        case 'add_dir': {
          this.files.setKey(sanitizedPath, { type: 'folder' });
          break;
        }
        case 'remove_dir': {
          this.files.setKey(sanitizedPath, undefined);

          for (const [direntPath] of Object.entries(this.files.get())) {
            if (direntPath.startsWith(sanitizedPath)) {
              this.files.setKey(direntPath, undefined);
            }
          }

          break;
        }
        case 'add_file':
        case 'change': {
          if (type === 'add_file') {
            this.#size++;
          }

          let content = '';
          const isBinary = isBinaryFile(buffer);

          if (!isBinary) {
            content = this.#decodeFileContent(buffer);
          }

          this.files.setKey(sanitizedPath, { type: 'file', content, isBinary });

          break;
        }
        case 'remove_file': {
          this.#size--;
          this.files.setKey(sanitizedPath, undefined);
          break;
        }
        case 'update_directory': {
          break;
        }
      }
    }
  }

  #decodeFileContent(buffer?: Uint8Array) {
    if (!buffer || buffer.byteLength === 0) {
      return '';
    }

    try {
      return utf8TextDecoder.decode(buffer);
    } catch (error) {
      console.log(error);
      return '';
    }
  }
}

function isBinaryFile(buffer: Uint8Array | undefined) {
  if (buffer === undefined) {
    return false;
  }

  return getEncoding(convertToBuffer(buffer), { chunkLength: 100 }) === 'binary';
}

function convertToBuffer(view: Uint8Array): Buffer {
  const buffer = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  Object.setPrototypeOf(buffer, Buffer.prototype);
  return buffer as Buffer;
}
