import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebContainer } from '@webcontainer/api';
import { normalizeGitRepoUrl } from '~/lib/.server/daytona/files';
import { rewriteDaytonaGitCloneCommand } from '~/lib/.server/daytona/client';
import { ActionRunner } from '~/lib/runtime/action-runner';
import { FilesStore } from '~/lib/stores/files';
import * as runtimeStore from '~/lib/stores/runtime';
import { WORK_DIR } from '~/utils/constants';

describe('Daytona Editor Sync & GitHub Clone Flow', () => {
  beforeEach(() => {
    runtimeStore.activeEnvironmentStore.set('webcontainer');
    runtimeStore.daytonaStateStore.setKey('configured', false);
    vi.restoreAllMocks();
  });

  describe('normalizeGitRepoUrl', () => {
    it('accepts full HTTPS GitHub URLs, .git suffix, and owner/repo shorthand', () => {
      expect(normalizeGitRepoUrl('https://github.com/vercel/next.js')).toEqual({
        repoUrl: 'https://github.com/vercel/next.js',
        repoName: 'next.js',
        parsedBranch: undefined,
      });

      expect(normalizeGitRepoUrl('https://github.com/vitejs/vite.git/')).toEqual({
        repoUrl: 'https://github.com/vitejs/vite.git',
        repoName: 'vite',
        parsedBranch: undefined,
      });

      expect(normalizeGitRepoUrl('facebook/react')).toEqual({
        repoUrl: 'https://github.com/facebook/react',
        repoName: 'react',
        parsedBranch: undefined,
      });
    });

    it('extracts branch from GitHub browser /tree/<branch> and /blob/<branch> URLs and normalizes SSH/domain shorthands', () => {
      expect(normalizeGitRepoUrl('https://github.com/remix-run/remix/tree/main/packages')).toEqual({
        repoUrl: 'https://github.com/remix-run/remix',
        repoName: 'remix',
        parsedBranch: 'main',
      });

      expect(normalizeGitRepoUrl('https://github.com/remix-run/remix/blob/dev/README.md')).toEqual({
        repoUrl: 'https://github.com/remix-run/remix',
        repoName: 'remix',
        parsedBranch: 'dev',
      });

      expect(normalizeGitRepoUrl('git@github.com:vitejs/vite.git')).toEqual({
        repoUrl: 'https://github.com/vitejs/vite.git',
        repoName: 'vite',
        parsedBranch: undefined,
      });

      expect(normalizeGitRepoUrl('github.com/facebook/react')).toEqual({
        repoUrl: 'https://github.com/facebook/react',
        repoName: 'react',
        parsedBranch: undefined,
      });
    });

    it('rejects private/loopback URLs, non-http schemes, and shell metacharacters', () => {
      const invalidUrls = [
        '',
        '   ',
        'file:///etc/passwd',
        'ssh://git@github.com/org/repo.git',
        'http://localhost:3000/repo.git',
        'http://127.0.0.1/repo.git',
        'http://192.168.1.50/repo.git',
        'http://10.0.0.5/repo.git',
        'http://169.254.169.254/latest/meta-data',
        'https://github.com/org/repo;rm -rf /',
        'https://github.com/org/repo|cat /etc/passwd',
      ];

      for (const bad of invalidUrls) {
        expect(() => normalizeGitRepoUrl(bad)).toThrow();
      }
    });
  });

  describe('FilesStore Daytona Hydration & Immediate Action Upsert', () => {
    it('hydrates files and parent folders immediately even if WebContainer never resolves', () => {
      const neverResolvingWc = new Promise<WebContainer>(() => {});
      const store = new FilesStore(neverResolvingWc);

      const hydratedPaths = store.hydrateFromDaytona(
        [
          { path: '/workspace/package.json', content: '{"name":"cloned-app"}', isBinary: false },
          { path: 'src/components/Button.tsx', content: 'export const Button = () => <button />;', isBinary: false },
          { path: '/home/project/README.md', content: '# Cloned Repo', isBinary: false },
        ],
        [
          { path: 'src', isDir: true },
          { path: 'src/components', isDir: true },
          { path: 'empty-dir', isDir: true },
        ],
        { projectId: 'proj_test', pruneRemoved: true },
      );

      expect(hydratedPaths).toHaveLength(3);
      expect(store.filesCount).toBe(3);

      const map = store.files.get();
      expect(map[`${WORK_DIR}/src`]).toEqual({ type: 'folder' });
      expect(map[`${WORK_DIR}/src/components`]).toEqual({ type: 'folder' });
      expect(map[`${WORK_DIR}/empty-dir`]).toEqual({ type: 'folder' });
      expect(map[`${WORK_DIR}/package.json`]).toEqual({
        type: 'file',
        content: '{"name":"cloned-app"}',
        isBinary: false,
      });
      expect(map[`${WORK_DIR}/src/components/Button.tsx`]).toEqual({
        type: 'file',
        content: 'export const Button = () => <button />;',
        isBinary: false,
      });
      expect(map[`${WORK_DIR}/README.md`]).toEqual({
        type: 'file',
        content: '# Cloned Repo',
        isBinary: false,
      });
    });

    it('prunes stale files on re-hydration and supports instant upsertFileFromAction', () => {
      const rejectedWc = Promise.reject(new Error('WebContainer disabled'));
      rejectedWc.catch(() => {});
      const store = new FilesStore(rejectedWc);

      const added = store.upsertFileFromAction('/workspace/src/pages/Home.tsx', 'export default function Home() {}');
      expect(added).toBe(`${WORK_DIR}/src/pages/Home.tsx`);
      expect(store.filesCount).toBe(1);
      expect(store.files.get()[`${WORK_DIR}/src/pages`]).toEqual({ type: 'folder' });

      store.hydrateFromDaytona(
        [{ path: 'index.html', content: '<html></html>', isBinary: false }],
        [],
        { projectId: 'proj_test', pruneRemoved: true },
      );

      expect(store.filesCount).toBe(1);
      expect(store.files.get()[`${WORK_DIR}/src/pages/Home.tsx`]).toBeUndefined();
      expect(store.files.get()[`${WORK_DIR}/index.html`]).toEqual({
        type: 'file',
        content: '<html></html>',
        isBinary: false,
      });
    });
  });

  describe('ActionRunner Daytona Integration', () => {
    it('immediately surfaces AI-written files to onFileWritten and executes Daytona shell callbacks without blocking on WebContainer', async () => {
      runtimeStore.activeEnvironmentStore.set('daytona');
      runtimeStore.daytonaStateStore.setKey('configured', true);

      const uploadSpy = vi.spyOn(runtimeStore, 'uploadDaytonaFile').mockResolvedValue();
      const execSpy = vi.spyOn(runtimeStore, 'execDaytonaCommand').mockResolvedValue({ exitCode: 0 });

      const onFileWritten = vi.fn();
      const onDaytonaShellComplete = vi.fn();
      const neverWc = new Promise<WebContainer>(() => {});
      const runner = new ActionRunner(neverWc, { onFileWritten, onDaytonaShellComplete });

      runner.addAction({
        artifactId: 'art_1',
        messageId: 'msg_1',
        actionId: 'act_file',
        action: { type: 'file', filePath: '/workspace/src/App.tsx', content: 'console.log(1);' },
      });

      await runner.runAction({
        artifactId: 'art_1',
        messageId: 'msg_1',
        actionId: 'act_file',
        action: { type: 'file', filePath: '/workspace/src/App.tsx', content: 'console.log(1);' },
      });

      await vi.waitFor(() => {
        expect(onFileWritten).toHaveBeenCalledWith('src/App.tsx', 'console.log(1);');
        expect(uploadSpy).toHaveBeenCalledWith('src/App.tsx', 'console.log(1);');
      });

      runner.addAction({
        artifactId: 'art_1',
        messageId: 'msg_1',
        actionId: 'act_shell',
        action: { type: 'shell', content: 'git clone https://github.com/org/demo .' },
      });

      await runner.runAction({
        artifactId: 'art_1',
        messageId: 'msg_1',
        actionId: 'act_shell',
        action: { type: 'shell', content: 'git clone https://github.com/org/demo .' },
      });

      await vi.waitFor(() => {
        expect(execSpy).toHaveBeenCalledWith(
          'git clone https://github.com/org/demo .',
          expect.objectContaining({ source: 'action', abortSignal: expect.any(AbortSignal) }),
        );
        expect(onDaytonaShellComplete).toHaveBeenCalledWith('git clone https://github.com/org/demo .', 0);
      });
    });

    it('auto-switches git clone shell actions from WebContainer to Daytona when Daytona is configured', async () => {
      runtimeStore.activeEnvironmentStore.set('webcontainer');
      runtimeStore.daytonaStateStore.setKey('configured', true);

      const execSpy = vi.spyOn(runtimeStore, 'execDaytonaCommand').mockResolvedValue({ exitCode: 0 });
      const onDaytonaShellComplete = vi.fn();
      const neverWc = new Promise<WebContainer>(() => {});
      const runner = new ActionRunner(neverWc, { onDaytonaShellComplete });

      runner.addAction({
        artifactId: 'art_git',
        messageId: 'msg_git',
        actionId: 'act_git',
        action: { type: 'shell', content: 'git clone https://github.com/org/demo /tmp/repo' },
      });

      await runner.runAction({
        artifactId: 'art_git',
        messageId: 'msg_git',
        actionId: 'act_git',
        action: { type: 'shell', content: 'git clone https://github.com/org/demo /tmp/repo' },
      });

      await vi.waitFor(() => {
        expect(runtimeStore.activeEnvironmentStore.get()).toBe('daytona');
        expect(execSpy).toHaveBeenCalledWith(
          'git clone https://github.com/org/demo /tmp/repo',
          expect.objectContaining({ source: 'action', abortSignal: expect.any(AbortSignal) }),
        );
        expect(onDaytonaShellComplete).toHaveBeenCalledWith('git clone https://github.com/org/demo /tmp/repo', 0);
      });
    });
  });

  describe('rewriteDaytonaGitCloneCommand (FUSE Volume ENOSYS bypass)', () => {
    it('rewrites git clone inside /workspace to stage in /tmp and copy without .git into target dir', () => {
      const cmd = 'git clone https://github.com/stackblitz-labs/bolt.diy.git';
      const rewritten = rewriteDaytonaGitCloneCommand(cmd, '/workspace');

      expect(rewritten).not.toBe(cmd);
      expect(rewritten).toContain('/tmp/wc-clone-');
      expect(rewritten).toContain("'https://github.com/stackblitz-labs/bolt.diy.git'");
      expect(rewritten).toContain("'bolt.diy'");
      expect(rewritten).toContain('rm -rf "$_wc_tmp/.git"');
      expect(rewritten).toContain('tar --no-same-owner --no-same-permissions -xf -');
    });

    it('rewrites only the git clone segment in chained commands while preserving flags and trailing steps', () => {
      const cmd = 'git clone --depth 1 -b main https://github.com/org/demo my-app && cd my-app && npm install';
      const rewritten = rewriteDaytonaGitCloneCommand(cmd, '/workspace');

      expect(rewritten).toContain("'--depth' '1' '-b' 'main' 'https://github.com/org/demo'");
      expect(rewritten).toContain("'my-app'");
      expect(rewritten).toContain('&& cd my-app && npm install');
    });

    it('leaves commands targeting /tmp or executed outside /workspace untouched', () => {
      const staged = 'git clone https://github.com/org/demo /tmp/demo && cp -r /tmp/demo/. /workspace/';
      expect(rewriteDaytonaGitCloneCommand(staged, '/workspace')).toBe(staged);

      const outside = 'git clone https://github.com/org/demo';
      expect(rewriteDaytonaGitCloneCommand(outside, '/tmp')).toBe(outside);
    });
  });
});
