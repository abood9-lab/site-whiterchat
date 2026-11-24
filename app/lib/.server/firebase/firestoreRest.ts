import firebaseConfig from '../../../../firebase-applet-config.json';

type FirestoreValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { stringValue: string }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } };

function getFirestoreBaseUrl(): string {
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
}

function toFirestoreValue(value: unknown): FirestoreValue {
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === 'boolean') {
    return { booleanValue: value };
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(toFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }

  return { stringValue: String(value) };
}

function fromFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) {
    return undefined;
  }
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('stringValue' in value) return value.stringValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) {
      obj[k] = fromFirestoreValue(v);
    }
    return obj;
  }
  return undefined;
}

function decodeDoc<T>(docJson: { name?: string; fields?: Record<string, FirestoreValue> }): T | null {
  if (!docJson?.fields) {
    return null;
  }
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(docJson.fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj as T;
}

export async function firestoreRestGetDoc<T>(docPath: string, idToken: string): Promise<T | null> {
  if (!idToken) {
    return null;
  }
  const cleanPath = docPath.replace(/^\/+/, '');
  const url = `${getFirestoreBaseUrl()}/${cleanPath}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as { name?: string; fields?: Record<string, FirestoreValue> };
  return decodeDoc<T>(data);
}

export async function firestoreRestPatchDoc(
  docPath: string,
  data: Record<string, unknown>,
  idToken: string,
): Promise<boolean> {
  if (!idToken) {
    return false;
  }

  const cleanPath = docPath.replace(/^\/+/, '');
  const fields: Record<string, FirestoreValue> = {};
  const maskParams: string[] = [];

  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields[key] = toFirestoreValue(val);
      maskParams.push(`updateMask.fieldPaths=${encodeURIComponent(key)}`);
    }
  }

  if (maskParams.length === 0) {
    return false;
  }

  const url = `${getFirestoreBaseUrl()}/${cleanPath}?${maskParams.join('&')}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ fields }),
  });

  return res.ok;
}

export async function firestoreRestUpsertProject(
  params: {
    userId: string;
    projectId: string;
    name?: string;
    volumeName: string;
    volumeId?: string;
    volumeSubpath: string;
    sandboxId?: string;
    sandboxStatus?: 'none' | 'creating' | 'started' | 'stopped' | 'stopping' | 'error';
    totalFiles?: number;
    totalBytes?: number;
    migrationStatus?: 'not_started' | 'in_progress' | 'completed' | 'partial' | 'failed';
    lastActiveAt?: string;
    lastStoppedAt?: string;
  },
  idToken: string,
): Promise<boolean> {
  if (!idToken) {
    return false;
  }

  const docPath = `users/${params.userId}/projects/${params.projectId}`;
  const existing = await firestoreRestGetDoc<Record<string, unknown>>(docPath, idToken);
  const now = new Date().toISOString().slice(0, 64);

  if (!existing) {
    return firestoreRestPatchDoc(
      docPath,
      {
        projectId: params.projectId,
        ownerId: params.userId,
        name: (params.name || params.projectId).slice(0, 200),
        volumeName: params.volumeName.slice(0, 128),
        ...(params.volumeId ? { volumeId: params.volumeId.slice(0, 128) } : {}),
        volumeSubpath: params.volumeSubpath.slice(0, 256),
        ...(params.sandboxId ? { sandboxId: params.sandboxId.slice(0, 128) } : {}),
        sandboxStatus: params.sandboxStatus || 'none',
        storageBackend: 'daytona_volume',
        totalFiles: params.totalFiles ?? 0,
        totalBytes: params.totalBytes ?? 0,
        migrationStatus: params.migrationStatus || 'not_started',
        lastActiveAt: params.lastActiveAt || now,
        ...(params.lastStoppedAt ? { lastStoppedAt: params.lastStoppedAt } : {}),
        createdAt: now,
        updatedAt: now,
      },
      idToken,
    );
  }

  return firestoreRestPatchDoc(
    docPath,
    {
      ...(params.name ? { name: params.name.slice(0, 200) } : {}),
      ...(params.volumeId ? { volumeId: params.volumeId.slice(0, 128) } : {}),
      ...(params.sandboxId ? { sandboxId: params.sandboxId.slice(0, 128) } : {}),
      ...(params.sandboxStatus ? { sandboxStatus: params.sandboxStatus } : {}),
      ...(typeof params.totalFiles === 'number' ? { totalFiles: params.totalFiles } : {}),
      ...(typeof params.totalBytes === 'number' ? { totalBytes: params.totalBytes } : {}),
      ...(params.migrationStatus ? { migrationStatus: params.migrationStatus } : {}),
      ...(params.lastActiveAt ? { lastActiveAt: params.lastActiveAt } : {}),
      ...(params.lastStoppedAt ? { lastStoppedAt: params.lastStoppedAt } : {}),
      updatedAt: now,
    },
    idToken,
  );
}

export async function firestoreRestUpsertFileMeta(
  params: {
    userId: string;
    projectId: string;
    fileId: string;
    relativePath: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    legacyCloudinaryPublicId?: string;
  },
  idToken: string,
): Promise<boolean> {
  if (!idToken) {
    return false;
  }

  const docPath = `users/${params.userId}/projects/${params.projectId}/files/${params.fileId}`;
  const now = new Date().toISOString().slice(0, 64);

  return firestoreRestPatchDoc(
    docPath,
    {
      fileId: params.fileId.slice(0, 256),
      projectId: params.projectId.slice(0, 128),
      ownerId: params.userId.slice(0, 128),
      relativePath: params.relativePath.slice(0, 512),
      mimeType: params.mimeType.slice(0, 128),
      sizeBytes: Math.max(0, params.sizeBytes),
      sha256: params.sha256.slice(0, 128),
      storageLocation: 'daytona_volume',
      ...(params.legacyCloudinaryPublicId
        ? { legacyCloudinaryPublicId: params.legacyCloudinaryPublicId.slice(0, 512) }
        : {}),
      updatedAt: now,
    },
    idToken,
  );
}

export async function firestoreRestListCollection<T>(
  collectionPath: string,
  idToken: string,
  pageSize = 200,
): Promise<T[]> {
  if (!idToken) {
    return [];
  }

  const cleanPath = collectionPath.replace(/^\/+/, '');
  const url = `${getFirestoreBaseUrl()}/${cleanPath}?pageSize=${pageSize}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!res.ok) {
    return [];
  }

  const payload = (await res.json()) as {
    documents?: Array<{ name?: string; fields?: Record<string, FirestoreValue> }>;
  };

  const results: T[] = [];
  for (const docItem of payload.documents || []) {
    const decoded = decodeDoc<T>(docItem);
    if (decoded) {
      results.push(decoded);
    }
  }
  return results;
}
