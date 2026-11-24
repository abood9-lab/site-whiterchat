import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import {
  cloneGitRepoToDaytonaClient,
  exportProjectToGitHubClient,
  readWorkspaceSnapshot,
  type WorkspaceSnapshotEntry,
  type WorkspaceSnapshotFile,
} from '~/lib/daytona/workspace.client';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { WORK_DIR } from '~/utils/constants';
import { normalizeWorkspaceRelPath } from '~/utils/posixPath';
import { unreachable } from '~/utils/unreachable';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import {
  activeProjectIdStore,
  daytonaStateStore,
  emitDaytonaTerminalLog,
  ensureDaytonaSandbox,
  subscribeDaytonaWorkspaceMutation,
  syncAllFilesToDaytona,
} from './runtime';
import { TerminalStore } from './terminal';

export interface ArtifactState {
  id: string;
  title: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'preview' | 'plan' | 'secrets';

export interface ActiveWorkbenchPlan {
  title: string;
  markdown: string;
  messageId?: string;
  isApproved?: boolean;
}

export interface PlanActionHandlers {
  onApproveAndBuild: (plan: ActiveWorkbenchPlan) => void;
  onRequestRevision: (feedback: string, plan: ActiveWorkbenchPlan) => void;
}

const PREFERRED_ENTRY_FILES = [
  'src/App.tsx',
  'src/App.jsx',
  'app/page.tsx',
  'src/main.tsx',
  'src/main.ts',
  'src/index.tsx',
  'src/index.ts',
  'index.html',
  'main.py',
  'app.py',
  'package.json',
  'README.md',
];

function isSensitiveDotEnv(filePath: string): boolean {
  const name = filePath.split('/').pop() || '';
  return name === '.env' || name.startsWith('.env.');
}

function pickBestEditorFile(files: FileMap): string | undefined {
  for (const rel of PREFERRED_ENTRY_FILES) {
    const candidate = `${WORK_DIR}/${rel}`;
    const dirent = files[candidate];
    if (dirent?.type === 'file' && !dirent.isBinary) {
      return candidate;
    }
  }

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file' && !dirent.isBinary && !isSensitiveDotEnv(filePath)) {
      return filePath;
    }
  }

  for (const [filePath, dirent] of Object.entries(files)) {
    if (dirent?.type === 'file') {
      return filePath;
    }
  }

  return undefined;
}

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  currentPlan: WritableAtom<ActiveWorkbenchPlan | null> = import.meta.hot?.data.currentPlan ?? atom(null);
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  isSyncingFromDaytona: WritableAtom<boolean> = atom(false);
  openCloneRepoTrigger: WritableAtom<number> = atom(0);
  openExportGitHubTrigger: WritableAtom<number> = atom(0);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #planActionHandlers: PlanActionHandlers | null = null;
  #daytonaSyncPromise: Promise<{ filesCount: number; entriesCount: number }> | null = null;

  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.currentPlan = this.currentPlan;
    }

    if (!import.meta.env.SSR) {
      subscribeDaytonaWorkspaceMutation((event) => {
        if (event.source === 'terminal') {
          void this.syncFromDaytona({
            projectId: event.projectId,
            openWorkbench: true,
            selectDefaultFile: true,
            pruneRemoved: true,
          });
        }
      });
    }
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  async syncToDaytona() {
    return syncAllFilesToDaytona(this.files.get());
  }

  upsertWorkspaceFileFromAI(relativePath: string, content: string) {
    const fullPath = this.#filesStore.upsertFileFromAction(relativePath, content);
    if (!fullPath) {
      return;
    }

    const updatedFiles = this.files.get();
    this.#editorStore.setDocuments(updatedFiles);
    this.showWorkbench.set(true);

    const currentSelected = this.selectedFile.get();
    const isCurrentEnv = currentSelected ? isSensitiveDotEnv(currentSelected) : false;
    if (!currentSelected || !updatedFiles[currentSelected] || (isCurrentEnv && !isSensitiveDotEnv(fullPath))) {
      this.setSelectedFile(fullPath);
    }
  }

  hydrateFromDaytonaSnapshot(
    snapshotFiles: WorkspaceSnapshotFile[],
    snapshotEntries?: WorkspaceSnapshotEntry[],
    options?: {
      projectId?: string;
      pruneRemoved?: boolean;
      onlyIfDifferent?: boolean;
      openWorkbench?: boolean;
      switchToCode?: boolean;
      selectDefaultFile?: boolean;
    },
  ) {
    this.#filesStore.hydrateFromDaytona(snapshotFiles, snapshotEntries, {
      projectId: options?.projectId,
      pruneRemoved: options?.pruneRemoved,
      onlyIfDifferent: options?.onlyIfDifferent,
    });

    const updatedFiles = this.files.get();
    this.#editorStore.setDocuments(updatedFiles);

    const currentSelected = this.selectedFile.get();
    const selectionMissing = !currentSelected || updatedFiles[currentSelected]?.type !== 'file';
    if (selectionMissing || options?.selectDefaultFile) {
      const nextFile = pickBestEditorFile(updatedFiles);
      if (nextFile && (selectionMissing || isSensitiveDotEnv(currentSelected || ''))) {
        this.setSelectedFile(nextFile);
      } else if (selectionMissing) {
        this.setSelectedFile(undefined);
      }
    }

    if (options?.openWorkbench && (snapshotFiles.length > 0 || (snapshotEntries?.length ?? 0) > 0)) {
      this.showWorkbench.set(true);
    }

    if (options?.switchToCode) {
      this.currentView.set('code');
    }
  }

  async syncFromDaytona(options?: {
    projectId?: string;
    openWorkbench?: boolean;
    switchToCode?: boolean;
    selectDefaultFile?: boolean;
    pruneRemoved?: boolean;
  }): Promise<{ filesCount: number; entriesCount: number }> {
    if (this.#daytonaSyncPromise) {
      return this.#daytonaSyncPromise;
    }

    const run = async () => {
      this.isSyncingFromDaytona.set(true);
      try {
        const projectId = options?.projectId || activeProjectIdStore.get() || daytonaStateStore.get().projectId;
        const sandboxId = daytonaStateStore.get().sandboxId || (await ensureDaytonaSandbox(projectId));
        const snapshot = await readWorkspaceSnapshot(projectId, sandboxId);

        this.hydrateFromDaytonaSnapshot(snapshot.files, snapshot.entries, {
          projectId,
          pruneRemoved: options?.pruneRemoved ?? true,
          openWorkbench: options?.openWorkbench ?? true,
          switchToCode: options?.switchToCode,
          selectDefaultFile: options?.selectDefaultFile ?? true,
        });

        return {
          filesCount: snapshot.files.length,
          entriesCount: snapshot.entries.length,
        };
      } finally {
        this.isSyncingFromDaytona.set(false);
        this.#daytonaSyncPromise = null;
      }
    };

    this.#daytonaSyncPromise = run();
    return this.#daytonaSyncPromise;
  }

  async cloneGitHubRepoInDaytona(options: { repoUrl: string; branch?: string; targetDir?: string }) {
    const projectId = activeProjectIdStore.get() || daytonaStateStore.get().projectId;
    this.isSyncingFromDaytona.set(true);
    try {
      const sandboxId = daytonaStateStore.get().sandboxId || (await ensureDaytonaSandbox(projectId));
      emitDaytonaTerminalLog(
        'system',
        `\r\n\x1b[36m[Daytona Git]\x1b[0m Cloning ${options.repoUrl}${options.branch ? ` (${options.branch})` : ''}...\r\n`,
      );
      const res = await cloneGitRepoToDaytonaClient({
        projectId,
        repoUrl: options.repoUrl,
        branch: options.branch,
        targetDir: options.targetDir,
        sandboxId,
      });

      daytonaStateStore.setKey('configured', true);
      daytonaStateStore.setKey('sandboxId', res.sandboxId);
      daytonaStateStore.setKey('status', 'ready');

      this.hydrateFromDaytonaSnapshot(res.files, res.entries, {
        projectId,
        pruneRemoved: true,
        openWorkbench: true,
        switchToCode: true,
        selectDefaultFile: true,
      });

      if (res.clonedPath && res.clonedPath !== '/') {
        const prefix = normalizeWorkspaceRelPath(res.clonedPath);
        const filesMap = this.files.get();
        const clonedCandidate = Object.keys(filesMap).find(
          (k) => k.startsWith(`${WORK_DIR}/${prefix}/`) && filesMap[k]?.type === 'file' && !filesMap[k]?.isBinary,
        );
        if (clonedCandidate) {
          this.setSelectedFile(clonedCandidate);
        }
      }

      emitDaytonaTerminalLog(
        'system',
        `\x1b[32m[Daytona Git]\x1b[0m Cloned into ${res.clonedPath} — loaded ${res.files.length} files into Editor.\r\n`,
      );
      return res;
    } finally {
      this.isSyncingFromDaytona.set(false);
    }
  }

  async exportToGitHub(options: { githubToken: string; repoName?: string; commitMessage?: string; isPrivate?: boolean }) {
    await this.saveAllFiles();
    const projectId = activeProjectIdStore.get() || daytonaStateStore.get().projectId;
    const sandboxId = daytonaStateStore.get().sandboxId || (await ensureDaytonaSandbox(projectId));

    emitDaytonaTerminalLog(
      'system',
      `\r\n\x1b[36m[Daytona GitHub Export]\x1b[0m Exporting workspace project to GitHub...\r\n`,
    );

    const res = await exportProjectToGitHubClient({
      projectId,
      githubToken: options.githubToken,
      repoName: options.repoName,
      commitMessage: options.commitMessage,
      isPrivate: options.isPrivate,
      sandboxId,
    });

    emitDaytonaTerminalLog(
      'system',
      `\x1b[32m[Daytona GitHub Export]\x1b[0m Successfully pushed to ${res.htmlUrl}\r\n`,
    );

    return res;
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      const best = pickBestEditorFile(files);
      if (best) {
        this.setSelectedFile(best);
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  setCurrentPlan(plan: ActiveWorkbenchPlan | null) {
    this.currentPlan.set(plan);

    if (!plan && this.currentView.get() === 'plan') {
      this.currentView.set('code');
    }
  }

  openPlanInWorkbench(plan: ActiveWorkbenchPlan) {
    this.currentPlan.set(plan);
    this.showWorkbench.set(true);
    this.currentView.set('plan');
  }

  openSecretsInWorkbench() {
    this.showWorkbench.set(true);
    this.currentView.set('secrets');
  }

  openGitHubClonePanel() {
    this.showWorkbench.set(true);
    this.currentView.set('code');
    this.openCloneRepoTrigger.set(this.openCloneRepoTrigger.get() + 1);
  }

  openExportGitHubPanel() {
    this.showWorkbench.set(true);
    this.currentView.set('code');
    this.openExportGitHubTrigger.set(this.openExportGitHubTrigger.get() + 1);
  }

  setPlanActionHandlers(handlers: PlanActionHandlers | null) {
    this.#planActionHandlers = handlers;
  }

  approvePlanFromWorkbench(plan: ActiveWorkbenchPlan) {
    this.#planActionHandlers?.onApproveAndBuild(plan);
  }

  requestPlanRevisionFromWorkbench(feedback: string, plan: ActiveWorkbenchPlan) {
    this.#planActionHandlers?.onRequestRevision(feedback, plan);
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  async createFileInWorkspace(relativePath: string, content = '') {
    return this.#filesStore.createFile(relativePath, content);
  }

  async createFolderInWorkspace(relativePath: string) {
    return this.#filesStore.createFolder(relativePath);
  }

  async deletePathInWorkspace(filePath: string) {
    return this.#filesStore.deletePath(filePath);
  }

  async renamePathInWorkspace(sourcePath: string, destinationPath: string) {
    return this.#filesStore.renamePath(sourcePath, destinationPath);
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  addArtifact({ messageId, title, id }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(messageId);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(messageId)) {
      this.artifactIdList.push(messageId);
    }

    this.artifacts.setKey(messageId, {
      id,
      title,
      closed: false,
      runner: new ActionRunner(webcontainer, {
        onFileWritten: (relativePath, content) => {
          this.upsertWorkspaceFileFromAI(relativePath, content);
        },
        onDaytonaShellComplete: async (cmd, exitCode) => {
          if (exitCode === 0 || /\bgit\s+clone\b/i.test(cmd)) {
            await this.syncFromDaytona({
              openWorkbench: true,
              selectDefaultFile: true,
              pruneRemoved: false,
            }).catch(() => undefined);
          }
        },
      }),
    });
  }

  updateArtifact({ messageId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(messageId, { ...artifact, ...state });
  }

  async addAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    artifact.runner.addAction(data);
  }

  async runAction(data: ActionCallbackData) {
    const { messageId } = data;

    const artifact = this.#getArtifact(messageId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    artifact.runner.runAction(data);
  }

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }
}

export const workbenchStore = new WorkbenchStore();
