import { useStore } from '@nanostores/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels';
import {
  CodeMirrorEditor,
  type EditorDocument,
  type EditorSettings,
  type OnChangeCallback as OnEditorChange,
  type OnSaveCallback as OnEditorSave,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { shortcutEventEmitter } from '~/lib/hooks';
import type { FileMap } from '~/lib/stores/files';
import { activeTerminalTabStore, daytonaStateStore, setActiveTerminalTab, type RuntimePreference } from '~/lib/stores/runtime';
import { themeStore } from '~/lib/stores/theme';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { WORK_DIR } from '~/utils/constants';
import { renderLogger } from '~/utils/logger';
import { isMobile } from '~/utils/mobile';
import { RuntimeSelector } from '~/components/chat/RuntimeSelector.client';
import { toast } from 'react-toastify';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileTree } from './FileTree';
import { DaytonaTerminal } from './terminal/DaytonaTerminal.client';
import { Terminal, type TerminalRef } from './terminal/Terminal';

interface EditorPanelProps {
  files?: FileMap;
  unsavedFiles?: Set<string>;
  editorDocument?: EditorDocument;
  selectedFile?: string | undefined;
  isStreaming?: boolean;
  onEditorChange?: OnEditorChange;
  onEditorScroll?: OnEditorScroll;
  onFileSelect?: (value?: string) => void;
  onFileSave?: OnEditorSave;
  onFileReset?: () => void;
}

const MAX_TERMINALS = 3;
const DEFAULT_TERMINAL_SIZE = 28;
const DEFAULT_EDITOR_SIZE = 100 - DEFAULT_TERMINAL_SIZE;

const editorSettings: EditorSettings = { tabSize: 2 };

export const EditorPanel = memo(
  ({
    files,
    unsavedFiles,
    editorDocument,
    selectedFile,
    isStreaming,
    onFileSelect,
    onEditorChange,
    onEditorScroll,
    onFileSave,
    onFileReset,
  }: EditorPanelProps) => {
    renderLogger.trace('EditorPanel');

    const theme = useStore(themeStore);
    const showTerminal = useStore(workbenchStore.showTerminal);
    const activeTerminalTab = useStore(activeTerminalTabStore);
    const daytonaState = useStore(daytonaStateStore);

    const isSyncingFromDaytona = useStore(workbenchStore.isSyncingFromDaytona);
    const openCloneRepoTrigger = useStore(workbenchStore.openCloneRepoTrigger);

    const terminalRefs = useRef<Array<TerminalRef | null>>([]);
    const terminalPanelRef = useRef<ImperativePanelHandle>(null);
    const terminalToggledByShortcut = useRef(false);

    const [activeTerminal, setActiveTerminal] = useState(0);
    const [terminalCount, setTerminalCount] = useState(1);
    const [creatingFile, setCreatingFile] = useState(false);
    const [newFilePath, setNewFilePath] = useState('');
    const [cloningRepo, setCloningRepo] = useState(false);
    const [repoUrlInput, setRepoUrlInput] = useState('');
    const [repoBranchInput, setRepoBranchInput] = useState('');
    const [cloneError, setCloneError] = useState<string | null>(null);
    const [exportingGitHub, setExportingGitHub] = useState(false);
    const [gitHubTokenInput, setGitHubTokenInput] = useState('');
    const [gitHubRepoNameInput, setGitHubRepoNameInput] = useState('');
    const [gitHubPrivateInput, setGitHubPrivateInput] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);
    const [renamingFile, setRenamingFile] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const activeFileSegments = useMemo(() => {
      if (!editorDocument) {
        return undefined;
      }

      return editorDocument.filePath.split('/');
    }, [editorDocument]);

    const activeFileUnsaved = useMemo(() => {
      return editorDocument !== undefined && unsavedFiles?.has(editorDocument.filePath);
    }, [editorDocument, unsavedFiles]);

    useEffect(() => {
      const unsubscribeFromEventEmitter = shortcutEventEmitter.on('toggleTerminal', () => {
        terminalToggledByShortcut.current = true;
      });

      const unsubscribeFromThemeStore = themeStore.subscribe(() => {
        for (const ref of Object.values(terminalRefs.current)) {
          ref?.reloadStyles();
        }
      });

      return () => {
        unsubscribeFromEventEmitter();
        unsubscribeFromThemeStore();
      };
    }, []);

    useEffect(() => {
      const { current: terminal } = terminalPanelRef;

      if (!terminal) {
        return;
      }

      const isCollapsed = terminal.isCollapsed();

      if (!showTerminal && !isCollapsed) {
        terminal.collapse();
      } else if (showTerminal && isCollapsed) {
        terminal.resize(DEFAULT_TERMINAL_SIZE);
      }

      terminalToggledByShortcut.current = false;
    }, [showTerminal]);

    useEffect(() => {
      if (openCloneRepoTrigger > 0) {
        setCreatingFile(false);
        setExportingGitHub(false);
        setCloneError(null);
        setCloningRepo(true);
      }
    }, [openCloneRepoTrigger]);

    const openExportGitHubTrigger = useStore(workbenchStore.openExportGitHubTrigger);
    useEffect(() => {
      if (openExportGitHubTrigger > 0) {
        setCreatingFile(false);
        setCloningRepo(false);
        setExportError(null);
        setExportingGitHub(true);
      }
    }, [openExportGitHubTrigger]);

    const addTerminal = () => {
      if (terminalCount < MAX_TERMINALS) {
        setTerminalCount(terminalCount + 1);
        setActiveTerminal(terminalCount);
        setActiveTerminalTab('webcontainer');
      }
    };

    const handleRuntimePreferenceChange = (nextPreference: RuntimePreference) => {
      if (nextPreference === 'daytona') {
        if (daytonaState.statusLoaded && !daytonaState.configured) {
          toast.warning('DAYTONA_API_KEY is missing in server secrets. Configure it to run Daytona commands.');
          return;
        }

        if (files && Object.keys(files).length > 0) {
          void workbenchStore
            .syncToDaytona()
            .then((count) => {
              if (count > 0) {
                toast.success(`Switched to Daytona & synced ${count} files`);
              }
            })
            .catch((error: any) => {
              toast.error(error?.message || 'Switched to Daytona (sandbox connection failed)');
            });
        }
      }
    };

    const handleCreateWorkspaceFile = async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = newFilePath.trim();
      if (!trimmed) {
        return;
      }
      try {
        const createdFullPath = await workbenchStore.createFileInWorkspace(trimmed, '');
        setCreatingFile(false);
        setNewFilePath('');
        onFileSelect?.(createdFullPath);
        toast.success(`Created ${trimmed}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to create file');
      }
    };

    const handleRenameWorkspaceFile = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!editorDocument) {
        return;
      }
      const trimmed = renameValue.trim();
      if (!trimmed) {
        return;
      }
      try {
        await workbenchStore.renamePathInWorkspace(editorDocument.filePath, trimmed);
        setRenamingFile(false);
        onFileSelect?.(`${WORK_DIR}/${trimmed.replace(/^\/+/, '')}`);
        toast.success(`Renamed to ${trimmed}`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to rename file');
      }
    };

    const handleDeleteWorkspaceFile = async () => {
      if (!editorDocument) {
        return;
      }
      try {
        await workbenchStore.deletePathInWorkspace(editorDocument.filePath);
        setConfirmDelete(false);
        onFileSelect?.(undefined);
        toast.success('File deleted from workspace');
      } catch (err: any) {
        toast.error(err?.message || 'Failed to delete file');
      }
    };

    const handlePullFromDaytona = async () => {
      try {
        const res = await workbenchStore.syncFromDaytona({
          openWorkbench: true,
          selectDefaultFile: true,
          pruneRemoved: true,
        });
        toast.success(`Loaded ${res.filesCount} files from Daytona`);
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load files from Daytona');
      }
    };

    const handleExportGitHubRepo = async (e: React.FormEvent) => {
      e.preventDefault();
      const token = gitHubTokenInput.trim();
      if (!token) {
        toast.error('Enter a valid GitHub Personal Access Token');
        return;
      }

      setExportError(null);

      try {
        const res = await workbenchStore.exportToGitHub({
          githubToken: token,
          repoName: gitHubRepoNameInput.trim() || undefined,
          isPrivate: gitHubPrivateInput,
          commitMessage: 'Exported from WhiterChat Daytona Workspace',
        });
        setExportingGitHub(false);
        setExportError(null);
        toast.success(`Successfully pushed project to ${res.htmlUrl}`);
      } catch (err: any) {
        const message = err?.message || 'Failed to export project to GitHub';
        setExportError(message);
        toast.error(message);
      }
    };

    const handleCloneGitHubRepo = async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmedUrl = repoUrlInput.trim();
      if (!trimmedUrl) {
        return;
      }

      setCloneError(null);

      try {
        const res = await workbenchStore.cloneGitHubRepoInDaytona({
          repoUrl: trimmedUrl,
          branch: repoBranchInput.trim() || undefined,
        });
        setCloningRepo(false);
        setRepoUrlInput('');
        setRepoBranchInput('');
        setCloneError(null);
        toast.success(`Cloned ${res.repoUrl} — loaded ${res.files.length} files`);
      } catch (err: any) {
        const message = err?.message || 'Failed to clone repository in Daytona';
        setCloneError(message);
        toast.error(message);
      }
    };

    return (
      <PanelGroup direction="vertical">
        <Panel defaultSize={showTerminal ? DEFAULT_EDITOR_SIZE : 100} minSize={20}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={10} collapsible>
              <div className="flex flex-col border-r border-bolt-elements-borderColor h-full">
                <PanelHeader className="justify-between">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="i-ph:tree-structure-duotone shrink-0" />
                    <span>Files</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <IconButton
                      icon="i-ph:git-commit"
                      title="Export project to GitHub"
                      size="sm"
                      onClick={() => {
                        setCreatingFile(false);
                        setCloningRepo(false);
                        setExportError(null);
                        setExportingGitHub((prev) => !prev);
                      }}
                    />
                    <IconButton
                      icon={cloningRepo ? 'i-ph:x' : 'i-ph:git-branch'}
                      title="Clone GitHub repository into Daytona"
                      size="sm"
                      onClick={() => {
                        setCreatingFile(false);
                        setExportingGitHub(false);
                        setCloneError(null);
                        setCloningRepo((prev) => !prev);
                      }}
                    />
                    <IconButton
                      icon="i-ph:arrows-clockwise"
                      iconClassName={isSyncingFromDaytona ? 'animate-spin' : undefined}
                      title="Refresh files from Daytona workspace"
                      size="sm"
                      disabled={isSyncingFromDaytona}
                      onClick={() => void handlePullFromDaytona()}
                    />
                    <IconButton
                      icon={creatingFile ? 'i-ph:x' : 'i-ph:file-plus'}
                      title="New file in workspace"
                      size="sm"
                      onClick={() => {
                        setCloningRepo(false);
                        setCreatingFile((prev) => !prev);
                        setNewFilePath('');
                      }}
                    />
                  </div>
                </PanelHeader>
                {exportingGitHub && (
                  <form
                    onSubmit={handleExportGitHubRepo}
                    className="p-2.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col gap-2"
                  >
                    <div className="text-xs font-semibold text-bolt-elements-textPrimary flex items-center justify-between">
                      <span>Export to GitHub</span>
                      <button
                        type="button"
                        onClick={() => setExportingGitHub(false)}
                        className="text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary text-xs"
                      >
                        ✕
                      </button>
                    </div>
                    <input
                      type="password"
                      disabled={isSyncingFromDaytona}
                      value={gitHubTokenInput}
                      onChange={(e) => {
                        setGitHubTokenInput(e.target.value);
                        if (exportError) setExportError(null);
                      }}
                      placeholder="GitHub Personal Access Token (ghp_...)"
                      className="w-full px-2 py-1 text-xs font-mono rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        disabled={isSyncingFromDaytona}
                        value={gitHubRepoNameInput}
                        onChange={(e) => {
                          setGitHubRepoNameInput(e.target.value);
                          if (exportError) setExportError(null);
                        }}
                        placeholder="repo-name (optional)"
                        className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive"
                      />
                      <label className="flex items-center gap-1 text-[11px] text-bolt-elements-textSecondary cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          checked={gitHubPrivateInput}
                          onChange={(e) => setGitHubPrivateInput(e.target.checked)}
                          className="rounded border-bolt-elements-borderColor"
                        />
                        <span>Private</span>
                      </label>
                      <button
                        type="submit"
                        disabled={isSyncingFromDaytona || !gitHubTokenInput.trim()}
                        className="px-2 py-1 rounded text-[11px] font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {isSyncingFromDaytona ? 'Pushing...' : 'Push to GitHub'}
                      </button>
                    </div>
                    {exportError && (
                      <div className="text-[11px] text-red-400 leading-snug break-words">{exportError}</div>
                    )}
                  </form>
                )}
                {cloningRepo && (
                  <form
                    onSubmit={handleCloneGitHubRepo}
                    className="p-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex flex-col gap-1.5"
                  >
                    <input
                      type="text"
                      autoFocus
                      disabled={isSyncingFromDaytona}
                      value={repoUrlInput}
                      onChange={(e) => {
                        setRepoUrlInput(e.target.value);
                        if (cloneError) setCloneError(null);
                      }}
                      placeholder="https://github.com/owner/repo"
                      className="w-full px-2 py-1 text-xs font-mono rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        disabled={isSyncingFromDaytona}
                        value={repoBranchInput}
                        onChange={(e) => {
                          setRepoBranchInput(e.target.value);
                          if (cloneError) setCloneError(null);
                        }}
                        placeholder="branch (optional)"
                        className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive"
                      />
                      <button
                        type="submit"
                        disabled={isSyncingFromDaytona || !repoUrlInput.trim()}
                        className="px-2 py-1 rounded text-[11px] font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {isSyncingFromDaytona ? 'Cloning...' : 'Clone'}
                      </button>
                    </div>
                    {cloneError && (
                      <div className="text-[11px] text-red-400 leading-snug break-words">{cloneError}</div>
                    )}
                  </form>
                )}
                {creatingFile && (
                  <form
                    onSubmit={handleCreateWorkspaceFile}
                    className="p-2 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 flex items-center gap-1"
                  >
                    <input
                      type="text"
                      autoFocus
                      value={newFilePath}
                      onChange={(e) => setNewFilePath(e.target.value)}
                      placeholder="src/example.ts"
                      className="flex-1 min-w-0 px-2 py-1 text-xs font-mono rounded bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textPrimary focus:outline-none focus:border-bolt-elements-borderColorActive"
                    />
                    <button
                      type="submit"
                      className="px-2 py-1 rounded text-[11px] font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer shrink-0"
                    >
                      Add
                    </button>
                  </form>
                )}
                <FileTree
                  className="h-full"
                  files={files}
                  hideRoot
                  unsavedFiles={unsavedFiles}
                  rootFolder={WORK_DIR}
                  selectedFile={selectedFile}
                  onFileSelect={onFileSelect}
                />
              </div>
            </Panel>
            <PanelResizeHandle />
            <Panel className="flex flex-col" defaultSize={80} minSize={20}>
              <PanelHeader className="overflow-x-auto">
                {activeFileSegments?.length && (
                  <div className="flex items-center flex-1 text-sm gap-2">
                    <FileBreadcrumb pathSegments={activeFileSegments} files={files} onFileSelect={onFileSelect} />
                    <div className="flex items-center gap-1 ml-auto -mr-1.5 shrink-0">
                      {activeFileUnsaved && (
                        <>
                          <PanelHeaderButton onClick={onFileSave}>
                            <div className="i-ph:floppy-disk-duotone" />
                            Save
                          </PanelHeaderButton>
                          <PanelHeaderButton onClick={onFileReset}>
                            <div className="i-ph:clock-counter-clockwise-duotone" />
                            Reset
                          </PanelHeaderButton>
                        </>
                      )}
                      {editorDocument && !isStreaming && (
                        <>
                          {renamingFile ? (
                            <form onSubmit={handleRenameWorkspaceFile} className="flex items-center gap-1">
                              <input
                                type="text"
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                className="w-40 px-2 py-0.5 text-xs font-mono rounded bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColorActive text-bolt-elements-textPrimary focus:outline-none"
                              />
                              <button
                                type="submit"
                                className="px-1.5 py-0.5 rounded text-xs font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent cursor-pointer"
                              >
                                OK
                              </button>
                              <PanelHeaderButton onClick={() => setRenamingFile(false)}>Cancel</PanelHeaderButton>
                            </form>
                          ) : (
                            <IconButton
                              icon="i-ph:pencil-simple"
                              title="Rename file"
                              size="sm"
                              onClick={() => {
                                setConfirmDelete(false);
                                setRenameValue(editorDocument.filePath.replace(`${WORK_DIR}/`, ''));
                                setRenamingFile(true);
                              }}
                            />
                          )}
                          {confirmDelete ? (
                            <div className="flex items-center gap-1">
                              <PanelHeaderButton
                                className="text-bolt-elements-icon-error"
                                onClick={handleDeleteWorkspaceFile}
                              >
                                Delete?
                              </PanelHeaderButton>
                              <PanelHeaderButton onClick={() => setConfirmDelete(false)}>No</PanelHeaderButton>
                            </div>
                          ) : (
                            <IconButton
                              icon="i-ph:trash"
                              title="Delete file"
                              size="sm"
                              onClick={() => {
                                setRenamingFile(false);
                                setConfirmDelete(true);
                              }}
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </PanelHeader>
              <div className="h-full flex-1 overflow-hidden">
                <CodeMirrorEditor
                  theme={theme}
                  editable={!isStreaming && editorDocument !== undefined}
                  settings={editorSettings}
                  doc={editorDocument}
                  autoFocusOnDocumentChange={!isMobile()}
                  onScroll={onEditorScroll}
                  onChange={onEditorChange}
                  onSave={onFileSave}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle />
        <Panel
          ref={terminalPanelRef}
          defaultSize={showTerminal ? DEFAULT_TERMINAL_SIZE : 0}
          minSize={10}
          collapsible
          onExpand={() => {
            if (!terminalToggledByShortcut.current) {
              workbenchStore.toggleTerminal(true);
            }
          }}
          onCollapse={() => {
            if (!terminalToggledByShortcut.current) {
              workbenchStore.toggleTerminal(false);
            }
          }}
        >
          <div className="h-full">
            <div className="bg-bolt-elements-terminals-background h-full flex flex-col">
              <div className="flex items-center bg-bolt-elements-background-depth-2 border-y border-bolt-elements-borderColor gap-1.5 min-h-[34px] p-2 overflow-x-auto">
                {Array.from({ length: terminalCount }, (_, index) => {
                  const isActive = activeTerminalTab === 'webcontainer' && activeTerminal === index;

                  return (
                    <button
                      key={index}
                      type="button"
                      className={classNames(
                        'flex items-center text-xs font-medium cursor-pointer gap-1.5 px-3 py-1.5 h-full whitespace-nowrap rounded-full transition-theme',
                        {
                          'bg-bolt-elements-terminals-buttonBackground text-bolt-elements-textPrimary': isActive,
                          'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-terminals-buttonBackground':
                            !isActive,
                        },
                      )}
                      onClick={() => {
                        setActiveTerminal(index);
                        setActiveTerminalTab('webcontainer');
                      }}
                    >
                      <div className="i-ph:terminal-window-duotone text-base" />
                      <span>Terminal {terminalCount > 1 ? index + 1 : ''}</span>
                    </button>
                  );
                })}
                {terminalCount < MAX_TERMINALS && <IconButton icon="i-ph:plus" size="md" onClick={addTerminal} />}

                <button
                  type="button"
                  onClick={() => setActiveTerminalTab('daytona')}
                  className={classNames(
                    'flex items-center text-xs font-medium cursor-pointer gap-1.5 px-3 py-1.5 h-full whitespace-nowrap rounded-full transition-theme',
                    {
                      'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent border border-bolt-elements-borderColorActive/60':
                        activeTerminalTab === 'daytona',
                      'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary hover:bg-bolt-elements-terminals-buttonBackground':
                        activeTerminalTab !== 'daytona',
                    },
                  )}
                >
                  <div className="i-ph:cloud text-base" />
                  <span>Daytona</span>
                  <span
                    className={classNames(
                      'w-1.5 h-1.5 rounded-full',
                      daytonaState.status === 'ready'
                        ? 'bg-emerald-500'
                        : daytonaState.status === 'creating'
                          ? 'bg-amber-400 animate-pulse'
                          : 'bg-bolt-elements-textTertiary',
                    )}
                  />
                </button>

                <div className="ml-auto flex items-center gap-1.5 shrink-0">
                  <RuntimeSelector
                    disabled={isStreaming}
                    onSelectPreference={handleRuntimePreferenceChange}
                  />
                  <IconButton
                    icon="i-ph:caret-down"
                    title="Close"
                    size="md"
                    onClick={() => workbenchStore.toggleTerminal(false)}
                  />
                </div>
              </div>
              {Array.from({ length: terminalCount }, (_, index) => {
                const isActive = activeTerminalTab === 'webcontainer' && activeTerminal === index;

                return (
                  <Terminal
                    key={index}
                    className={classNames('h-full overflow-hidden', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      terminalRefs.current[index] = ref;
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                );
              })}
              <DaytonaTerminal
                className={classNames('flex-1 min-h-0', {
                  hidden: activeTerminalTab !== 'daytona',
                })}
                theme={theme}
                onOpenPreview={() => workbenchStore.currentView.set('preview')}
              />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    );
  },
);
