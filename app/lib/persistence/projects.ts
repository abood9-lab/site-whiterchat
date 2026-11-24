import {
  auth,
  db as firestoreDb,
  handleFirestoreError,
  OperationType,
  waitForAuthReady,
} from '~/lib/firebase';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

export interface ProjectMetadata {
  projectId: string;
  ownerId: string;
  name: string;
  volumeName: string;
  volumeId?: string;
  volumeSubpath: string;
  sandboxId?: string;
  sandboxStatus?: 'none' | 'creating' | 'started' | 'stopped' | 'stopping' | 'error';
  storageBackend: 'daytona_volume' | 'migrating';
  totalFiles?: number;
  totalBytes?: number;
  migrationStatus?: 'not_started' | 'in_progress' | 'completed' | 'partial' | 'failed';
  lastActiveAt?: string;
  lastStoppedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) || 'default_workspace';
}

export async function ensureProjectMetadata(
  projectId: string,
  updates: Partial<Omit<ProjectMetadata, 'projectId' | 'ownerId' | 'volumeSubpath' | 'createdAt'>>,
): Promise<void> {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) {
    return;
  }

  const safeProjectId = sanitizeId(projectId);
  const path = `users/${user.uid}/projects/${safeProjectId}`;
  const ref = doc(firestoreDb, 'users', user.uid, 'projects', safeProjectId);
  const now = new Date().toISOString().slice(0, 64);

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const created: ProjectMetadata = {
        projectId: safeProjectId,
        ownerId: user.uid,
        name: (updates.name || safeProjectId).slice(0, 200),
        volumeName: (updates.volumeName || 'whiterchat-project-storage').slice(0, 128),
        ...(updates.volumeId ? { volumeId: updates.volumeId.slice(0, 128) } : {}),
        volumeSubpath: `users/${user.uid}/projects/${safeProjectId}`,
        ...(updates.sandboxId ? { sandboxId: updates.sandboxId.slice(0, 128) } : {}),
        sandboxStatus: updates.sandboxStatus || 'none',
        storageBackend: 'daytona_volume',
        totalFiles: updates.totalFiles ?? 0,
        totalBytes: updates.totalBytes ?? 0,
        migrationStatus: updates.migrationStatus || 'not_started',
        lastActiveAt: updates.lastActiveAt || now,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(ref, created);
      return;
    }

    await setDoc(
      ref,
      {
        ...(updates.name ? { name: updates.name.slice(0, 200) } : {}),
        ...(updates.volumeId ? { volumeId: updates.volumeId.slice(0, 128) } : {}),
        ...(updates.sandboxId ? { sandboxId: updates.sandboxId.slice(0, 128) } : {}),
        ...(updates.sandboxStatus ? { sandboxStatus: updates.sandboxStatus } : {}),
        ...(typeof updates.totalFiles === 'number' ? { totalFiles: updates.totalFiles } : {}),
        ...(typeof updates.totalBytes === 'number' ? { totalBytes: updates.totalBytes } : {}),
        ...(updates.migrationStatus ? { migrationStatus: updates.migrationStatus } : {}),
        ...(updates.lastActiveAt ? { lastActiveAt: updates.lastActiveAt } : {}),
        ...(updates.lastStoppedAt ? { lastStoppedAt: updates.lastStoppedAt } : {}),
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function registerSessionInFirestore(
  projectId: string,
  sessionId: string,
  sandboxId?: string,
): Promise<void> {
  const user = auth.currentUser || (await waitForAuthReady());
  if (!user) {
    return;
  }

  const safeProjectId = sanitizeId(projectId);
  const safeSessionId = sanitizeId(sessionId);
  const path = `users/${user.uid}/projects/${safeProjectId}/sessions/${safeSessionId}`;
  const now = new Date().toISOString().slice(0, 64);

  try {
    await ensureProjectMetadata(safeProjectId, { lastActiveAt: now });
    await setDoc(
      doc(firestoreDb, 'users', user.uid, 'projects', safeProjectId, 'sessions', safeSessionId),
      {
        sessionId: safeSessionId,
        projectId: safeProjectId,
        ownerId: user.uid,
        ...(sandboxId ? { sandboxId: sandboxId.slice(0, 128) } : {}),
        status: 'active',
        lastHeartbeatAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function listUserProjects(): Promise<ProjectMetadata[]> {
  const user = await waitForAuthReady();
  if (!user) {
    return [];
  }

  const path = `users/${user.uid}/projects`;
  try {
    const snap = await getDocs(collection(firestoreDb, 'users', user.uid, 'projects'));
    const list: ProjectMetadata[] = [];
    snap.forEach((d) => {
      list.push(d.data() as ProjectMetadata);
    });
    list.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
