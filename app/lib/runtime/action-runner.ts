import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import { normalizeWorkspaceRelPath, posixDirname } from '~/utils/posixPath';
import {
  activeEnvironmentStore,
  activeTerminalTabStore,
  daytonaStateStore,
  emitDaytonaTerminalLog,
  execDaytonaCommand,
  setActiveEnvironment,
  uploadDaytonaFile,
} from '~/lib/stores/runtime';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';

const logger = createScopedLogger('ActionRunner');

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export interface ActionRunnerCallbacks {
  onFileWritten?: (relativePath: string, content: string) => void;
  onDaytonaShellComplete?: (command: string, exitCode: number) => Promise<void> | void;
}

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #callbacks?: ActionRunnerCallbacks;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>, callbacks?: ActionRunnerCallbacks) {
    this.#webcontainer = webcontainerPromise;
    this.#callbacks = callbacks;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: error instanceof Error ? error.message : 'Action failed' });
      throw error;
    }
  }

  async #runShellAction(action: ActionState) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const isGitCommand = /\bgit\s+(?:clone|pull|fetch|checkout|submodule)\b/i.test(action.content);
    if (isGitCommand && activeEnvironmentStore.get() !== 'daytona') {
      if (daytonaStateStore.get().configured) {
        setActiveEnvironment('daytona', false);
      } else {
        throw new Error('Git commands are not available in WebContainer. Configure Daytona Sandbox to run git clone.');
      }
    }

    if (activeEnvironmentStore.get() === 'daytona') {
      activeTerminalTabStore.set('daytona');
      const result = await execDaytonaCommand(action.content, {
        source: 'action',
        abortSignal: action.abortSignal,
      });

      await this.#callbacks?.onDaytonaShellComplete?.(action.content, result.exitCode);

      if (result.exitCode !== 0) {
        throw new Error(`Daytona command exited with code ${result.exitCode}`);
      }

      return;
    }

    const webcontainer = await this.#webcontainer;

    const process = await webcontainer.spawn('jsh', ['-c', action.content], {
      env: { npm_config_yes: true },
    });

    action.abortSignal.addEventListener('abort', () => {
      process.kill();
    });

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log(data);
        },
      }),
    );

    const exitCode = await process.exit;
    logger.debug(`Process terminated with code ${exitCode}`);
  }

  async #tryGetWebContainer(timeoutMs = 1500): Promise<WebContainer | null> {
    try {
      return await Promise.race([
        this.#webcontainer,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
    } catch {
      return null;
    }
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const relPath = normalizeWorkspaceRelPath(action.filePath);
    if (!relPath) {
      logger.warn(`Skipping invalid file action path: ${action.filePath}`);
      return;
    }

    // Immediately show AI-written file in the Editor/FileTree regardless of WebContainer boot timing
    this.#callbacks?.onFileWritten?.(relPath, action.content);

    const writeWebContainer = async () => {
      const webcontainer = await this.#tryGetWebContainer(activeEnvironmentStore.get() === 'daytona' ? 1200 : 15000);
      if (!webcontainer) {
        return;
      }

      const folder = posixDirname(relPath).replace(/\/+$/g, '');
      if (folder && folder !== '.') {
        await webcontainer.fs.mkdir(folder, { recursive: true }).catch((error) => {
          logger.error('Failed to create folder\n\n', error);
        });
      }

      await webcontainer.fs.writeFile(relPath, action.content).catch((error) => {
        logger.error('Failed to write file\n\n', error);
      });
    };

    if (activeEnvironmentStore.get() === 'daytona') {
      void writeWebContainer();
    } else {
      await writeWebContainer();
    }

    // Durable write directly into the user's mounted Daytona Volume whenever configured
    if (daytonaStateStore.get().configured || activeEnvironmentStore.get() === 'daytona') {
      try {
        await uploadDaytonaFile(relPath, action.content);
        emitDaytonaTerminalLog('system', `\x1b[90m[Daytona Volume]\x1b[0m Wrote ${relPath}\r\n`);
      } catch (error: any) {
        emitDaytonaTerminalLog(
          'stderr',
          `\x1b[31m[Daytona Volume Error]\x1b[0m Failed to write ${relPath}: ${error?.message || 'Error'}\r\n`,
        );
        if (activeEnvironmentStore.get() === 'daytona') {
          throw error;
        }
      }
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();
    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
