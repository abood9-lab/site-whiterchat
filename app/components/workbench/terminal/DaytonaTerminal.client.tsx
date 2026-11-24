import { useStore } from '@nanostores/react';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal as XTerm } from '@xterm/xterm';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  checkDaytonaStatus,
  daytonaStateStore,
  ensureDaytonaSandbox,
  execDaytonaCommand,
  interruptDaytonaProcess,
  openDaytonaPreviewPort,
  restartDaytonaSandbox,
  setActiveEnvironment,
  subscribeDaytonaTerminalLog,
} from '~/lib/stores/runtime';
import type { Theme } from '~/lib/stores/theme';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { getTerminalTheme } from './theme';

interface DaytonaTerminalProps {
  className?: string;
  theme: Theme;
  onOpenPreview?: () => void;
}

export const DaytonaTerminal = memo(({ className, theme, onOpenPreview }: DaytonaTerminalProps) => {
  const daytonaState = useStore(daytonaStateStore);
  const [portInput, setPortInput] = useState('3000');
  const [syncing, setSyncing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const lineBufferRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number>(-1);
  const busyRef = useRef(false);

  const writePrompt = useCallback((term: XTerm) => {
    const cwd = daytonaStateStore.get().cwd || '/home/daytona/project';
    const shortCwd = cwd.replace('/home/daytona/project', '~/project');
    term.write(`\r\n\x1b[36mdaytona\x1b[0m:\x1b[34m${shortCwd}\x1b[0m$ `);
  }, []);

  useEffect(() => {
    void checkDaytonaStatus();
  }, []);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return undefined;
    }

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: true,
      theme: getTerminalTheme({}),
      fontSize: 12,
      fontFamily: 'Menlo, courier-new, courier, monospace',
    });

    xtermRef.current = terminal;
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(element);

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        // ignore hidden panel resize tick
      }
    });
    resizeObserver.observe(element);

    terminal.writeln('\x1b[36mDaytona Cloud Sandbox Terminal\x1b[0m');
    terminal.writeln('\x1b[90mType a Linux shell command (python3, pip, npm, git, ls) or click Connect.\x1b[0m');
    writePrompt(terminal);

    const unsubscribeLogs = subscribeDaytonaTerminalLog((event) => {
      terminal.write(event.text);
    });

    const dataDisposable = terminal.onData((data) => {
      // Ctrl+C interrupts running remote command or clears current line
      if (data === '\x03') {
        if (daytonaStateStore.get().activeProcessId) {
          terminal.write('^C\r\n');
          void interruptDaytonaProcess();
        } else {
          lineBufferRef.current = '';
          terminal.write('^C');
          writePrompt(terminal);
        }
        return;
      }

      if (busyRef.current) {
        return;
      }

      // Enter
      if (data === '\r') {
        const command = lineBufferRef.current.trim();
        lineBufferRef.current = '';
        historyIdxRef.current = -1;
        terminal.write('\r\n');

        if (!command) {
          writePrompt(terminal);
          return;
        }

        if (command === 'clear') {
          terminal.clear();
          writePrompt(terminal);
          return;
        }

        historyRef.current = [command, ...historyRef.current.filter((item) => item !== command)].slice(0, 50);
        busyRef.current = true;

        void execDaytonaCommand(command, { source: 'terminal' })
          .catch((error: any) => {
            terminal.writeln(`\x1b[31m${error?.message || 'Command failed'}\x1b[0m`);
          })
          .finally(() => {
            busyRef.current = false;
            writePrompt(terminal);
          });

        return;
      }

      // Backspace
      if (data === '\x7f') {
        if (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          terminal.write('\b \b');
        }
        return;
      }

      // Up Arrow
      if (data === '\x1b[A') {
        if (historyRef.current.length === 0) {
          return;
        }
        const nextIdx = Math.min(historyIdxRef.current + 1, historyRef.current.length - 1);
        historyIdxRef.current = nextIdx;
        const entry = historyRef.current[nextIdx] ?? '';
        while (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          terminal.write('\b \b');
        }
        lineBufferRef.current = entry;
        terminal.write(entry);
        return;
      }

      // Down Arrow
      if (data === '\x1b[B') {
        if (historyIdxRef.current <= 0) {
          historyIdxRef.current = -1;
          while (lineBufferRef.current.length > 0) {
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
            terminal.write('\b \b');
          }
          return;
        }
        const nextIdx = historyIdxRef.current - 1;
        historyIdxRef.current = nextIdx;
        const entry = historyRef.current[nextIdx] ?? '';
        while (lineBufferRef.current.length > 0) {
          lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          terminal.write('\b \b');
        }
        lineBufferRef.current = entry;
        terminal.write(entry);
        return;
      }

      // Ignore other ANSI escape sequences
      if (data.startsWith('\x1b')) {
        return;
      }

      const sanitized = data.replace(/[\r\n]+/g, ' ');
      lineBufferRef.current += sanitized;
      terminal.write(sanitized);
    });

    return () => {
      dataDisposable.dispose();
      unsubscribeLogs();
      resizeObserver.disconnect();
      terminal.dispose();
      xtermRef.current = null;
    };
  }, [writePrompt]);

  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getTerminalTheme({});
    }
  }, [theme]);

  const handleConnectOrRestart = async () => {
    try {
      if (daytonaState.sandboxId) {
        await restartDaytonaSandbox();
        toast.success('Daytona sandbox restarted');
      } else {
        await ensureDaytonaSandbox();
        toast.success('Connected to Daytona sandbox');
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to connect Daytona sandbox');
    }
  };

  const handleSyncFiles = async () => {
    setSyncing(true);
    try {
      const count = await workbenchStore.syncToDaytona();
      toast.success(count > 0 ? `Synced ${count} files to Daytona` : 'No files to sync yet');
    } catch (error: any) {
      toast.error(error?.message || 'Failed to sync files to Daytona');
    } finally {
      setSyncing(false);
    }
  };

  const handlePullFiles = async () => {
    setSyncing(true);
    try {
      const res = await workbenchStore.syncFromDaytona({
        openWorkbench: true,
        selectDefaultFile: true,
        pruneRemoved: true,
      });
      toast.success(`Loaded ${res.filesCount} files from Daytona into Editor`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load files from Daytona');
    } finally {
      setSyncing(false);
    }
  };

  const handlePreviewPort = async () => {
    const parsed = Number.parseInt(portInput, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      toast.error('Enter a valid port number (1-65535)');
      return;
    }

    const preview = await openDaytonaPreviewPort(parsed);
    if (preview) {
      toast.success(`Daytona preview ready on port ${preview.port}`);
      onOpenPreview?.();
    } else {
      toast.error(`Could not open Daytona preview on port ${parsed}`);
    }
  };

  const statusColor =
    daytonaState.status === 'ready'
      ? 'bg-emerald-500'
      : daytonaState.status === 'creating'
        ? 'bg-amber-400 animate-pulse'
        : daytonaState.status === 'error'
          ? 'bg-red-500'
          : 'bg-bolt-elements-textTertiary';

  const statusLabel =
    daytonaState.status === 'ready'
      ? 'Ready'
      : daytonaState.status === 'creating'
        ? 'Provisioning...'
        : daytonaState.status === 'error'
          ? 'Error'
          : 'Disconnected';

  return (
    <div className={classNames('flex flex-col h-full overflow-hidden', className)}>
      {/* Daytona Toolbar */}
      <div className="px-3 py-1.5 border-b border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className={classNames('w-2 h-2 rounded-full shrink-0', statusColor)} />
          <span className="font-medium text-bolt-elements-textPrimary">{statusLabel}</span>
          {daytonaState.sandboxId && (
            <span className="font-mono tabular-nums text-[11px] text-bolt-elements-textTertiary">
              ({daytonaState.sandboxId.slice(0, 10)})
            </span>
          )}
          <span className="text-bolt-elements-textTertiary hidden sm:inline">·</span>
          <span className="font-mono tabular-nums text-[11px] text-bolt-elements-textSecondary truncate max-w-[180px] hidden sm:inline">
            {daytonaState.cwd}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              aria-label="Daytona Preview Port"
              className="w-16 px-1.5 py-0.5 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary font-mono tabular-nums text-[11px] focus:outline-none focus:border-bolt-elements-borderColorActive"
            />
            <button
              type="button"
              onClick={handlePreviewPort}
              title="Expose & preview sandbox port"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer"
            >
              <span className="i-ph:arrow-square-out text-xs" />
              <span>Preview</span>
            </button>
          </div>

          <button
            type="button"
            disabled={syncing || daytonaState.status === 'creating'}
            onClick={handleSyncFiles}
            title="Push Editor files to Daytona sandbox"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer disabled:opacity-50"
          >
            <span className={classNames('i-ph:arrows-clockwise text-xs', syncing ? 'animate-spin' : undefined)} />
            <span>Sync</span>
          </button>

          <button
            type="button"
            disabled={syncing || daytonaState.status === 'creating'}
            onClick={handlePullFiles}
            title="Pull files from Daytona sandbox into Editor"
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive transition-theme cursor-pointer disabled:opacity-50"
          >
            <span className="i-ph:download-simple text-xs" />
            <span>Pull</span>
          </button>

          {daytonaState.activeProcessId && (
            <button
              type="button"
              onClick={() => void interruptDaytonaProcess()}
              title="Stop running Daytona command"
              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-theme cursor-pointer"
            >
              <span className="i-ph:stop text-xs" />
              <span>Stop</span>
            </button>
          )}

          <button
            type="button"
            disabled={daytonaState.status === 'creating'}
            onClick={handleConnectOrRestart}
            title={daytonaState.sandboxId ? 'Restart Daytona sandbox' : 'Connect Daytona sandbox'}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-bolt-elements-borderColorActive/50 bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:bg-bolt-elements-button-primary-background transition-theme cursor-pointer disabled:opacity-50"
          >
            <span className={daytonaState.sandboxId ? 'i-ph:arrows-clockwise text-xs' : 'i-ph:play-fill text-xs'} />
            <span>{daytonaState.sandboxId ? 'Restart' : 'Connect'}</span>
          </button>
        </div>
      </div>

      {/* Missing API Key Banner */}
      {daytonaState.statusLoaded && !daytonaState.configured && (
        <div className="px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 flex items-center justify-between gap-3 flex-wrap text-xs text-amber-300">
          <div className="flex items-center gap-2 min-w-0">
            <span className="i-ph:warning text-sm shrink-0" />
            <span>
              <strong className="font-semibold">DAYTONA_API_KEY</strong> is not configured on the server. Add it to your
              environment secrets to provision cloud sandboxes.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void checkDaytonaStatus()}
              className="px-2 py-1 rounded border border-amber-500/40 hover:bg-amber-500/20 cursor-pointer"
            >
              Retry Check
            </button>
            <button
              type="button"
              onClick={() => setActiveEnvironment('webcontainer', true)}
              className="px-2 py-1 rounded border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary hover:bg-bolt-elements-item-backgroundActive cursor-pointer"
            >
              Switch to WebContainer
            </button>
          </div>
        </div>
      )}

      {/* XTerm Container */}
      <div className="flex-1 overflow-hidden" ref={containerRef} />
    </div>
  );
});
