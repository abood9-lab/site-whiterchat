import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(process.cwd());
const rulesText = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
const blueprintJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-blueprint.json'), 'utf8')) as {
  entities: Record<string, { properties: Record<string, unknown>; required?: string[] }>;
  firestore: Record<string, { schema: string }>;
};

describe('Firestore Security Rules & Blueprint Invariants', () => {
  it('enforces a global default-deny catch-all rule', () => {
    expect(rulesText).toMatch(/match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/);
  });

  it('requires verified email for admin RBAC and forbids client writes to /admins/{uid}', () => {
    expect(rulesText).toContain("request.auth.token.email == 'shahedalmefleh850@gmail.com'");
    expect(rulesText).toContain('request.auth.token.email_verified == true');
    expect(rulesText).toMatch(/match\s+\/admins\/\{uid\}\s*\{[\s\S]*allow\s+create,\s*update,\s*delete:\s*if\s+false;/);
  });

  it('locks volumeSubpath isolation and immutable project ownership fields', () => {
    expect(rulesText).toContain("data.volumeSubpath == ('users/' + userId + '/projects/' + projectId)");
    expect(rulesText).toContain('incoming().projectId == existing().projectId');
    expect(rulesText).toContain('incoming().ownerId == existing().ownerId');
    expect(rulesText).toContain('incoming().volumeSubpath == existing().volumeSubpath');
    expect(rulesText).toContain('incoming().createdAt == existing().createdAt');
  });

  it('prevents directory traversal and restricts storageLocation on project file metadata', () => {
    expect(rulesText).toContain("!data.relativePath.matches('.*\\\\.\\\\..*')");
    expect(rulesText).toContain("data.storageLocation == 'daytona_volume'");
  });

  it('enforces parent project existence and state integrity on workspace sessions', () => {
    expect(rulesText).toContain('exists(/databases/$(database)/documents/users/$(userId)/projects/$(projectId))');
    expect(rulesText).toContain("existing().status != 'ended'");
  });

  it('prevents client writes or reads by non-admins on /migrations/{jobId}', () => {
    expect(rulesText).toMatch(/match\s+\/migrations\/\{jobId\}\s*\{[\s\S]*allow\s+get,\s*list:\s*if\s+isAdmin\(\)/);
    expect(rulesText).toMatch(/match\s+\/items\/\{itemId\}\s*\{[\s\S]*allow\s+get,\s*list:\s*if\s+isAdmin\(\)/);
  });

  it('covers all entities declared in firebase-blueprint.json inside firestore.rules', () => {
    expect(blueprintJson.entities.Project).toBeDefined();
    expect(blueprintJson.entities.WorkspaceSession).toBeDefined();
    expect(blueprintJson.entities.ProjectFileMeta).toBeDefined();
    expect(blueprintJson.entities.CloudinaryMigrationJob).toBeDefined();
    expect(blueprintJson.entities.CloudinaryMigrationItem).toBeDefined();

    const requiredMatchers = [
      'match /admins/{uid}',
      'match /users/{userId}',
      'match /projects/{projectId}',
      'match /sessions/{sessionId}',
      'match /files/{fileId}',
      'match /versions/{versionId}',
      'match /chats/{chatId}',
      'match /migrations/{jobId}',
      'match /items/{itemId}',
    ];

    for (const matcher of requiredMatchers) {
      expect(rulesText).toContain(matcher);
    }
  });
});
