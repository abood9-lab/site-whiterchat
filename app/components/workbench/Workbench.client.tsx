import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Slider, type SliderOption } from '~/components/ui/Slider';
import { getExistingEnvValuesMap, requestedSecretsStore } from '~/lib/stores/secrets';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import { WorkbenchPlanView } from './WorkbenchPlanView.client';
import { WorkbenchSecretsView } from './WorkbenchSecretsView.client';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
}

const viewTransition = { ease: cubicEasingFn };

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.2,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

export const Workbench = memo(({ chatStarted, isStreaming }: WorkspaceProps) => {
  renderLogger.trace('Workbench');

  const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const selectedFile = useStore(workbenchStore.selectedFile);
  const currentDocument = useStore(workbenchStore.currentDocument);
  const unsavedFiles = useStore(workbenchStore.unsavedFiles);
  const files = useStore(workbenchStore.files);
  const selectedView = useStore(workbenchStore.currentView);
  const currentPlan = useStore(workbenchStore.currentPlan);
  const requestedSecrets = useStore(requestedSecretsStore);

  const savedSecretsCount = Object.keys(getExistingEnvValuesMap(files)).length;
  const totalSecretsCount = Math.max(savedSecretsCount, requestedSecrets.length);

  const hasPlan = currentPlan !== null;

  const tabs = useMemo<SliderOption<WorkbenchViewType>[]>(() => {
    const list: SliderOption<WorkbenchViewType>[] = [
      {
        value: 'code',
        text: 'Code',
        icon: 'i-ph:code',
      },
      {
        value: 'preview',
        text: 'Preview',
        icon: 'i-ph:browser',
      },
    ];

    if (hasPlan) {
      list.push({
        value: 'plan',
        text: 'Plan',
        icon: 'i-ph:list-checks',
        title: currentPlan?.title || 'Implementation Plan',
      });
    }

    list.push({
      value: 'secrets',
      text: 'Secrets',
      icon: 'i-ph:key',
      badge: totalSecretsCount > 0 ? totalSecretsCount : undefined,
      title: 'Manage project .env API secrets',
    });

    return list;
  }, [hasPlan, currentPlan?.title, totalSecretsCount]);

  const viewOrder = useMemo<WorkbenchViewType[]>(() => {
    return hasPlan ? ['code', 'preview', 'plan', 'secrets'] : ['code', 'preview', 'secrets'];
  }, [hasPlan]);

  const effectiveSelectedView: WorkbenchViewType =
    selectedView === 'plan' && !hasPlan ? 'code' : selectedView;

  const activeIndex = Math.max(0, viewOrder.indexOf(effectiveSelectedView));

  const setSelectedView = (view: WorkbenchViewType) => {
    workbenchStore.currentView.set(view);
  };

  useEffect(() => {
    if (hasPreview) {
      setSelectedView('preview');
    }
  }, [hasPreview]);

  useEffect(() => {
    workbenchStore.setDocuments(files);
  }, [files]);

  const onEditorChange = useCallback<OnEditorChange>((update) => {
    workbenchStore.setCurrentDocumentContent(update.content);
  }, []);

  const onEditorScroll = useCallback<OnEditorScroll>((position) => {
    workbenchStore.setCurrentDocumentScrollPosition(position);
  }, []);

  const onFileSelect = useCallback((filePath: string | undefined) => {
    workbenchStore.setSelectedFile(filePath);
  }, []);

  const onFileSave = useCallback(() => {
    workbenchStore.saveCurrentDocument().catch(() => {
      toast.error('Failed to update file content');
    });
  }, []);

  const onFileReset = useCallback(() => {
    workbenchStore.resetCurrentDocument();
  }, []);

  const getOffsetX = (view: WorkbenchViewType) => {
    const idx = viewOrder.indexOf(view);
    if (idx === -1) {
      return '100%';
    }
    return `${(idx - activeIndex) * 100}%`;
  };

  return (
    (chatStarted || showWorkbench) && (
      <motion.div
        initial="closed"
        animate={showWorkbench ? 'open' : 'closed'}
        variants={workbenchVariants}
        className="z-workbench"
      >
        <div
          className={classNames(
            'fixed top-[calc(var(--header-height)+1.5rem)] bottom-6 w-[var(--workbench-inner-width)] mr-4 z-0 transition-[left,width] duration-200 bolt-ease-cubic-bezier',
            {
              'left-[var(--workbench-left)]': showWorkbench,
              'left-[100%]': !showWorkbench,
            },
          )}
        >
          <div className="absolute inset-0 px-6">
            <div className="h-full flex flex-col bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor shadow-sm rounded-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-bolt-elements-borderColor">
                <Slider selected={effectiveSelectedView} tabs={tabs} setSelected={setSelectedView} />
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {effectiveSelectedView === 'code' && (
                    <PanelHeaderButton
                      className="mr-1 text-sm whitespace-nowrap shrink-0"
                      onClick={() => {
                        workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get());
                      }}
                    >
                      <div className="i-ph:terminal" />
                      Toggle Terminal
                    </PanelHeaderButton>
                  )}
                </div>
                <IconButton
                  icon="i-ph:x-circle"
                  className="-mr-1"
                  size="xl"
                  onClick={() => {
                    workbenchStore.showWorkbench.set(false);
                  }}
                />
              </div>
              <div className="relative flex-1 overflow-hidden">
                <View
                  initial={{ x: getOffsetX('code') }}
                  animate={{ x: getOffsetX('code') }}
                  style={{ pointerEvents: effectiveSelectedView === 'code' ? 'auto' : 'none' }}
                >
                  <EditorPanel
                    editorDocument={currentDocument}
                    isStreaming={isStreaming}
                    selectedFile={selectedFile}
                    files={files}
                    unsavedFiles={unsavedFiles}
                    onFileSelect={onFileSelect}
                    onEditorScroll={onEditorScroll}
                    onEditorChange={onEditorChange}
                    onFileSave={onFileSave}
                    onFileReset={onFileReset}
                  />
                </View>
                <View
                  initial={{ x: getOffsetX('preview') }}
                  animate={{ x: getOffsetX('preview') }}
                  style={{ pointerEvents: effectiveSelectedView === 'preview' ? 'auto' : 'none' }}
                >
                  <Preview />
                </View>
                {hasPlan && (
                  <View
                    initial={{ x: getOffsetX('plan') }}
                    animate={{ x: getOffsetX('plan') }}
                    style={{ pointerEvents: effectiveSelectedView === 'plan' ? 'auto' : 'none' }}
                  >
                    <WorkbenchPlanView isStreaming={isStreaming} />
                  </View>
                )}
                <View
                  initial={{ x: getOffsetX('secrets') }}
                  animate={{ x: getOffsetX('secrets') }}
                  style={{ pointerEvents: effectiveSelectedView === 'secrets' ? 'auto' : 'none' }}
                >
                  <WorkbenchSecretsView />
                </View>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    )
  );
});

interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
