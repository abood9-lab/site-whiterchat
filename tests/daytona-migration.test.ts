import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFlushWorkspaceVolumeChanges,
  mockStopProjectSandbox,
  mockReadWorkspaceFileBytes,
} = vi.hoisted(() => ({
  mockFlushWorkspaceVolumeChanges: vi.fn(async () => undefined),
  mockStopProjectSandbox: vi.fn(async () => ({ stopped: true })),
  mockReadWorkspaceFileBytes: vi.fn(),
}));

vi.mock('~/lib/.server/daytona/client', () => ({
  flushWorkspaceVolumeChanges: mockFlushWorkspaceVolumeChanges,
  stopProjectSandbox: mockStopProjectSandbox,
}));

vi.mock('~/lib/.server/daytona/files', () => ({
  readWorkspaceFileBytes: mockReadWorkspaceFileBytes,
  writeWorkspaceBinaryFile: vi.fn(),
  writeWorkspaceTextFile: vi.fn(),
  statWorkspaceFile: vi.fn(),
}));

import {
  __resetLifecycleStateForTests,
  attemptProjectSandboxShutdown,
  beginWorkspaceOperation,
  endWorkspaceOperation,
  endWorkspaceSession,
  getActiveSessionsForProject,
  heartbeatWorkspaceSession,
  registerWorkspaceSession,
  shutdownAllUserSandboxesOnLogout,
  sweepExpiredPresenceSessions,
} from '~/lib/.server/daytona/lifecycle';
import {
  buildIsolatedProjectSubpath,
  buildUserProfileSubpath,
} from '~/lib/.server/daytona/volumes';
import {
  decodeLegacyCloudinarySegment,
  normalizeLegacyRelativePath,
  parseCloudinaryPublicIdTarget,
} from '~/lib/.server/migration/cloudinaryToDaytona';
import {
  assertProjectAccess,
  assertValidIdentifier,
  createMediaSignedToken,
  detectMimeType,
  enforceRateLimit,
  HttpAuthError,
  isEmailAdmin,
  resolveWorkspaceDirectory,
  resolveWorkspacePath,
  verifyMediaSignedToken,
} from '~/lib/.server/security/auth';
import { action as cloudinarySyncAction } from '~/routes/api.cloudinary.sync';
import { loader as workspaceMediaLoader } from '~/routes/api.workspace.media';

describe('Daytona Volume Security, Isolation & Migration', () => {
  beforeEach(() => {
    __resetLifecycleStateForTests();
    mockFlushWorkspaceVolumeChanges.mockClear();
    mockStopProjectSandbox.mockClear();
    mockReadWorkspaceFileBytes.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Isolated Storage Paths & Traversal Guard', () => {
    it('builds isolated per-user/per-project subpaths', () => {
      expect(buildIsolatedProjectSubpath('user_123', 'chat_abc')).toBe('users/user_123/projects/chat_abc');
      expect(buildUserProfileSubpath('user_123')).toBe('users/user_123/_profile');
    });

    it('rejects Dirty Dozen injection/traversal in project and user identifiers', () => {
      const badIds = ['', '../admin', 'user/123', 'user\\123', 'user\0id', 'a'.repeat(129), '.hidden', 'a b'];
      for (const id of badIds) {
        expect(() => assertValidIdentifier(id, 'projectId')).toThrow(HttpAuthError);
        expect(() => buildIsolatedProjectSubpath('user_1', id)).toThrow(HttpAuthError);
      }
    });

    it('normalizes valid virtual paths safely inside /workspace', () => {
      expect(resolveWorkspacePath('/home/project/src/App.tsx')).toEqual({
        absolutePath: '/workspace/src/App.tsx',
        relativePath: 'src/App.tsx',
      });
      expect(resolveWorkspacePath('/workspace/.env')).toEqual({
        absolutePath: '/workspace/.env',
        relativePath: '.env',
      });
      expect(resolveWorkspacePath('assets\\hero.png')).toEqual({
        absolutePath: '/workspace/assets/hero.png',
        relativePath: 'assets/hero.png',
      });
      expect(resolveWorkspaceDirectory('/home/project/')).toEqual({
        absolutePath: '/workspace',
        relativePath: '',
      });
    });

    it('blocks path traversal, null bytes, and control chars', () => {
      const dangerousPaths = [
        '../.ssh/id_rsa',
        'src/../../etc/passwd',
        '/workspace/../../secrets',
        './hidden/../../escape',
        'file.txt\0.png',
        'line1\nrm -rf /',
        '',
        '/workspace/',
      ];
      for (const badPath of dangerousPaths) {
        expect(() => resolveWorkspacePath(badPath)).toThrow(HttpAuthError);
      }
    });
  });

  describe('RBAC, Admin Verification & Rate Limiting', () => {
    it('enforces emailVerified for admin privileges', () => {
      expect(isEmailAdmin('shahedalmefleh850@gmail.com', false)).toBe(false);
      expect(isEmailAdmin('shahedalmefleh850@gmail.com', true)).toBe(true);
      expect(isEmailAdmin('SHAHEDALMEFLEH850@GMAIL.COM', true)).toBe(true);
      expect(isEmailAdmin('attacker@gmail.com', true)).toBe(false);
    });

    it('prevents cross-tenant access while allowing owner or verified admin', () => {
      const normalUser = {
        uid: 'user_A',
        email: 'a@example.com',
        emailVerified: true,
        isAdmin: false,
        idToken: 'tok',
      };
      const adminUser = {
        uid: 'admin_1',
        email: 'shahedalmefleh850@gmail.com',
        emailVerified: true,
        isAdmin: true,
        idToken: 'tok',
      };

      expect(() => assertProjectAccess(normalUser, 'user_A')).not.toThrow();
      expect(() => assertProjectAccess(normalUser, 'user_B')).toThrow(HttpAuthError);
      expect(() => assertProjectAccess(adminUser, 'user_B')).not.toThrow();
    });

    it('enforces sliding-window rate limits', () => {
      const key = `test_rl_${Date.now()}`;
      enforceRateLimit(key, 2, 60_000);
      enforceRateLimit(key, 2, 60_000);
      expect(() => enforceRateLimit(key, 2, 60_000)).toThrow(HttpAuthError);
    });
  });

  describe('Signed Media Tokens & HTTP 206 Range Streaming', () => {
    const testEnv = { DAYTONA_MEDIA_SECRET: 'unit_test_secret_32_bytes_minimum_key' } as unknown as NodeJS.ProcessEnv;

    it('verifies valid signed tokens and rejects tampering or expiry', () => {
      const token = createMediaSignedToken(
        {
          uid: 'user_123',
          projectId: 'proj_1',
          relativePath: 'assets/logo.png',
          scope: 'project',
        },
        300,
        testEnv,
      );

      const decoded = verifyMediaSignedToken(token, testEnv);
      expect(decoded?.uid).toBe('user_123');
      expect(decoded?.relativePath).toBe('assets/logo.png');

      // Tamper signature
      const [payloadPart, sigPart] = token.split('.');
      const tampered = `${payloadPart}.${sigPart.slice(0, -2)}AA`;
      expect(verifyMediaSignedToken(tampered, testEnv)).toBeNull();

      // Expired token
      const expired = createMediaSignedToken(
        { uid: 'user_123', projectId: 'proj_1', relativePath: 'assets/logo.png' },
        -10,
        testEnv,
      );
      expect(verifyMediaSignedToken(expired, testEnv)).toBeNull();
    });

    it('streams HTTP 206 partial content and 416 out-of-bounds cleanly', async () => {
      const sample = Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
      mockReadWorkspaceFileBytes.mockResolvedValue({
        absolutePath: '/workspace/assets/video.mp4',
        relativePath: 'assets/video.mp4',
        bytes: sample,
        sha256: 'abc123sha',
        mimeType: 'video/mp4',
      });

      const token = createMediaSignedToken(
        { uid: 'user_123', projectId: 'proj_1', relativePath: 'assets/video.mp4', scope: 'project' },
        300,
        process.env,
      );

      const rangeReq = new Request(`http://localhost/api/workspace/media?token=${encodeURIComponent(token)}`, {
        headers: { Range: 'bytes=2-5' },
      });
      const rangeRes = await workspaceMediaLoader({ request: rangeReq, params: {}, context: {} });
      expect(rangeRes.status).toBe(206);
      expect(rangeRes.headers.get('Content-Range')).toBe('bytes 2-5/26');
      expect(rangeRes.headers.get('Accept-Ranges')).toBe('bytes');
      expect(await rangeRes.text()).toBe('CDEF');

      const oobReq = new Request(`http://localhost/api/workspace/media?token=${encodeURIComponent(token)}`, {
        headers: { Range: 'bytes=99-120' },
      });
      const oobRes = await workspaceMediaLoader({ request: oobReq, params: {}, context: {} });
      expect(oobRes.status).toBe(416);
      expect(oobRes.headers.get('Content-Range')).toBe('bytes */26');
    });

    it('detects MIME types accurately', () => {
      expect(detectMimeType('index.html')).toContain('text/html');
      expect(detectMimeType('photo.webp')).toBe('image/webp');
      expect(detectMimeType('clip.mp4')).toBe('video/mp4');
      expect(detectMimeType('unknown.bin')).toBe('application/octet-stream');
    });
  });

  describe('Cloudinary Public ID Parsing & _dot_ Segment Restoration', () => {
    it('restores _dot_ escaped hidden files like .env and .gitignore', () => {
      expect(decodeLegacyCloudinarySegment('_dot_env')).toBe('.env');
      expect(decodeLegacyCloudinarySegment('_dot_gitignore')).toBe('.gitignore');
      expect(normalizeLegacyRelativePath('/home/project/src/_dot_env')).toBe('src/.env');
    });

    it('parses project files and profile avatars into isolated Daytona subpaths', () => {
      expect(parseCloudinaryPublicIdTarget('bolt_projects/user_1/chat_99/_dot_env')).toEqual({
        ownerId: 'user_1',
        projectId: 'chat_99',
        kind: 'project',
        relativePath: '.env',
      });
      expect(parseCloudinaryPublicIdTarget('bolt_projects/user_1/chat_99/src/App.tsx')).toEqual({
        ownerId: 'user_1',
        projectId: 'chat_99',
        kind: 'project',
        relativePath: 'src/App.tsx',
      });
      expect(parseCloudinaryPublicIdTarget('bolt_projects/user_1/profile_avatars/me.png')).toEqual({
        ownerId: 'user_1',
        projectId: '_profile',
        kind: 'profile',
        relativePath: 'avatars/me.png',
      });
    });
  });

  describe('Automatic Sandbox Presence & Shutdown Lifecycle', () => {
    it('keeps sandbox running across multiple tabs until the final tab closes', async () => {
      registerWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_1',
      });
      registerWorkspaceSession({
        sessionId: 'tab_2',
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_1',
      });

      const firstClose = await endWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        graceDelayMs: 0,
      });
      expect(firstClose.activeSessionsRemaining).toBe(1);
      expect(firstClose.stoppedImmediately).toBe(false);
      expect(mockStopProjectSandbox).not.toHaveBeenCalled();

      const lastClose = await endWorkspaceSession({
        sessionId: 'tab_2',
        userId: 'user_1',
        projectId: 'proj_1',
        graceDelayMs: 0,
      });
      expect(lastClose.activeSessionsRemaining).toBe(0);
      expect(lastClose.stoppedImmediately).toBe(true);
      expect(mockFlushWorkspaceVolumeChanges).toHaveBeenCalledWith('sb_1', expect.anything());
      expect(mockStopProjectSandbox).toHaveBeenCalledWith('sb_1', expect.objectContaining({ projectId: 'proj_1' }));
    });

    it('defers automatic idle shutdown while an AI or file operation lock is active', async () => {
      registerWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_2',
      });
      beginWorkspaceOperation('user_1', 'proj_1', 'ai_stream_1');

      const blocked = await endWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        graceDelayMs: 0,
      });
      expect(blocked.stoppedImmediately).toBe(false);
      expect(mockStopProjectSandbox).not.toHaveBeenCalled();

      endWorkspaceOperation('user_1', 'proj_1', 'ai_stream_1');
      const cleared = await attemptProjectSandboxShutdown({
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_2',
        reason: 'op_finished',
      });
      expect(cleared.stopped).toBe(true);
    });

    it('cancels grace shutdown if user returns or opens another tab', async () => {
      vi.useFakeTimers();

      registerWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_3',
      });

      const scheduled = await endWorkspaceSession({
        sessionId: 'tab_1',
        userId: 'user_1',
        projectId: 'proj_1',
        graceDelayMs: 5000,
      });
      expect(scheduled.scheduledShutdown).toBe(true);

      // User refreshes / returns after 2 seconds
      vi.advanceTimersByTime(2000);
      registerWorkspaceSession({
        sessionId: 'tab_2',
        userId: 'user_1',
        projectId: 'proj_1',
        sandboxId: 'sb_3',
      });

      await vi.advanceTimersByTimeAsync(10_000);
      expect(mockStopProjectSandbox).not.toHaveBeenCalled();
      expect(getActiveSessionsForProject('user_1', 'proj_1')).toHaveLength(1);
    });

    it('immediately stops all active user sandboxes on explicit logout and sweeps expired sessions', async () => {
      registerWorkspaceSession({
        sessionId: 'tab_a',
        userId: 'user_logout',
        projectId: 'proj_a',
        sandboxId: 'sb_a',
      });
      registerWorkspaceSession({
        sessionId: 'tab_b',
        userId: 'user_logout',
        projectId: 'proj_b',
        sandboxId: 'sb_b',
      });

      const logoutRes = await shutdownAllUserSandboxesOnLogout('user_logout');
      expect(logoutRes.stoppedSandboxIds.sort()).toEqual(['sb_a', 'sb_b']);
      expect(mockStopProjectSandbox).toHaveBeenCalledTimes(2);

      mockStopProjectSandbox.mockClear();
      registerWorkspaceSession({
        sessionId: 'tab_stale',
        userId: 'user_stale',
        projectId: 'proj_stale',
        sandboxId: 'sb_stale',
      });
      heartbeatWorkspaceSession({
        sessionId: 'tab_stale',
        userId: 'user_stale',
        projectId: 'proj_stale',
      });

      const sweep = await sweepExpiredPresenceSessions(Date.now() + 200_000, 60_000);
      expect(sweep.expiredSessionsCount).toBe(1);
      expect(sweep.stoppedProjects).toEqual(['proj_stale']);
      expect(mockStopProjectSandbox).toHaveBeenCalledTimes(1);
    });
  });

  describe('Cloudinary Write Cutover Enforcement', () => {
    it('rejects unauthenticated requests with 401 on /api/cloudinary/sync', async () => {
      const req = new Request('http://localhost/api/cloudinary/sync', { method: 'POST', body: '{}' });
      const res = await cloudinarySyncAction({ request: req, params: {}, context: {} });
      expect(res.status).toBe(401);
    });
  });
});
