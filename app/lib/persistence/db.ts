import type { Message } from 'ai';
import {
  auth,
  db as firestoreDb,
  handleFirestoreError,
  OperationType,
  updateProfile,
  waitForAuthReady,
} from '~/lib/firebase';
import type { User } from 'firebase/auth';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { modelSelectionStore } from '~/lib/stores/model';
import type { ChatHistoryItem } from './useChatHistory';

export const USERNAME_REGEX = /^[a-zA-Z0-9._-]+$/;

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  username: string;
  bio: string;
  photoURL: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CloudFileAsset {
  id: string;
  userId: string;
  chatId?: string;
  path: string;
  cloudinaryUrl: string;
  publicId?: string;
  resourceType?: string;
  bytes?: number;
  updatedAt: string;
}

export async function openDatabase() {
  return firestoreDb;
}

export async function getAll(_db: any): Promise<ChatHistoryItem[]> {
  const user = await waitForAuthReady();

  if (!user) {
    return [];
  }

  const path = 'chats';

  try {
    const q = query(collection(firestoreDb, path), where('userId', '==', user.uid));
    const querySnap = await getDocs(q);
    const items: ChatHistoryItem[] = [];

    querySnap.forEach((docSnap) => {
      const data = docSnap.data();
      items.push({
        id: data.id,
        urlId: data.urlId,
        description: data.description,
        messages: data.messages || [],
        timestamp: data.timestamp,
      });
    });

    items.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function setMessages(
  _db: any,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
): Promise<void> {
  const user = await waitForAuthReady();

  if (!user) {
    return;
  }

  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `chats/${sanitizedId}`;
  const selectedModel = modelSelectionStore.get();
  const chatRef = doc(firestoreDb, 'chats', sanitizedId);

  try {
    await setDoc(
      chatRef,
      {
        id: sanitizedId,
        userId: user.uid,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
        })),
        urlId: (urlId || sanitizedId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128),
        description: (description || String(messages[0]?.content ?? '').slice(0, 60) || 'New Chat').slice(0, 256),
        provider: selectedModel.provider,
        model: selectedModel.model.slice(0, 128),
        timestamp: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getMessages(_db: any, id: string): Promise<ChatHistoryItem | undefined> {
  if (!id || id === 'new') {
    return undefined;
  }

  const user = await waitForAuthReady();

  if (!user) {
    return undefined;
  }

  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `chats/${sanitizedId}`;

  try {
    const chatRef = doc(firestoreDb, 'chats', sanitizedId);
    const snap = await getDoc(chatRef);

    if (snap.exists()) {
      const data = snap.data();

      return {
        id: data.id,
        urlId: data.urlId,
        description: data.description,
        messages: data.messages || [],
        timestamp: data.timestamp,
      };
    }

    const q = query(
      collection(firestoreDb, 'chats'),
      where('userId', '==', user.uid),
      where('urlId', '==', sanitizedId),
    );
    const querySnap = await getDocs(q);

    if (!querySnap.empty) {
      const data = querySnap.docs[0].data();

      return {
        id: data.id,
        urlId: data.urlId,
        description: data.description,
        messages: data.messages || [],
        timestamp: data.timestamp,
      };
    }

    return undefined;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function deleteById(_db: any, id: string): Promise<void> {
  const user = await waitForAuthReady();

  if (!user) {
    return;
  }

  const sanitizedId = id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `chats/${sanitizedId}`;

  try {
    await deleteDoc(doc(firestoreDb, 'chats', sanitizedId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

function hashStringShort(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function saveFileAssetToFirestore(asset: Omit<CloudFileAsset, 'userId'>): Promise<void> {
  const user = auth.currentUser || (await waitForAuthReady());

  if (!user) {
    return;
  }

  const sanitizedId = asset.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeDocId =
    sanitizedId.length <= 240 ? sanitizedId : `${sanitizedId.slice(0, 228)}_${hashStringShort(asset.id)}`;
  const path = `files/${safeDocId}`;

  try {
    await setDoc(
      doc(firestoreDb, 'files', safeDocId),
      {
        id: safeDocId,
        userId: user.uid,
        ...(asset.chatId ? { chatId: asset.chatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) } : {}),
        path: asset.path.slice(0, 512),
        cloudinaryUrl: asset.cloudinaryUrl.slice(0, 1024),
        ...(asset.publicId ? { publicId: asset.publicId.slice(0, 512) } : {}),
        ...(asset.resourceType ? { resourceType: asset.resourceType.slice(0, 32) } : {}),
        ...(typeof asset.bytes === 'number' ? { bytes: asset.bytes } : {}),
        updatedAt: asset.updatedAt.slice(0, 64),
      },
      { merge: true },
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getUserFileAssets(): Promise<CloudFileAsset[]> {
  const user = await waitForAuthReady();

  if (!user) {
    return [];
  }

  const path = 'files';

  try {
    const q = query(collection(firestoreDb, path), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const results: CloudFileAsset[] = [];

    snap.forEach((docSnap) => {
      results.push(docSnap.data() as CloudFileAsset);
    });

    results.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

    return results;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function getChatFileAssets(chatId: string): Promise<CloudFileAsset[]> {
  if (!chatId || chatId === 'new') {
    return [];
  }

  const sanitizedChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const allAssets = await getUserFileAssets();

  // Deduplicate by normalized relative path keeping the most recently updated entry
  const byPath = new Map<string, CloudFileAsset>();
  for (const asset of allAssets) {
    if (asset.chatId !== sanitizedChatId) {
      continue;
    }

    if (asset.path.startsWith('uploads/')) {
      continue;
    }

    const normalizedPath = asset.path.replace(/^\/home\/project\/?/, '').replace(/^\/+/, '');
    if (!normalizedPath) {
      continue;
    }

    const existing = byPath.get(normalizedPath);
    if (!existing || (asset.updatedAt || '') > (existing.updatedAt || '')) {
      byPath.set(normalizedPath, { ...asset, path: normalizedPath });
    }
  }

  return Array.from(byPath.values());
}

export function sanitizeUsername(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 64);
}

export function deriveDefaultUsername(
  displayName?: string | null,
  email?: string | null,
  uid?: string | null,
): string {
  const fromName = displayName ? sanitizeUsername(displayName) : '';
  if (fromName) {
    return fromName;
  }

  const emailPrefix = email ? sanitizeUsername(email.split('@')[0] || '') : '';
  if (emailPrefix) {
    return emailPrefix;
  }

  const uidSuffix = (uid || 'user').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'bolt';
  return `user_${uidSuffix}`.slice(0, 64);
}

export async function ensureUserProfileOnAuth(
  user: User,
  signupData?: { displayName?: string; username?: string },
): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const userRef = doc(firestoreDb, 'users', user.uid);

  try {
    const snap = await getDoc(userRef);
    const now = new Date().toISOString().slice(0, 64);

    if (snap.exists()) {
      const existing = snap.data() as Partial<UserProfile>;
      const resolvedDisplayName = (
        signupData?.displayName?.trim() ||
        existing.displayName ||
        user.displayName ||
        user.email?.split('@')[0] ||
        'User'
      ).slice(0, 128);
      const resolvedUsername = (
        (signupData?.username ? sanitizeUsername(signupData.username) : '') ||
        (existing.username && USERNAME_REGEX.test(existing.username) ? existing.username : '') ||
        deriveDefaultUsername(resolvedDisplayName, user.email || existing.email, user.uid)
      ).slice(0, 64);

      const needsPatch =
        Boolean(signupData?.displayName?.trim() && signupData.displayName.trim() !== existing.displayName) ||
        Boolean(signupData?.username?.trim() && resolvedUsername !== existing.username) ||
        !existing.username ||
        !existing.displayName;

      if (needsPatch) {
        await updateDoc(userRef, {
          displayName: resolvedDisplayName,
          username: resolvedUsername,
          updatedAt: now,
        });
      }

      return {
        uid: user.uid,
        email: (existing.email || user.email || '').slice(0, 256),
        displayName: resolvedDisplayName,
        username: resolvedUsername,
        bio: (existing.bio || '').slice(0, 500),
        photoURL: (existing.photoURL || user.photoURL || '').slice(0, 1024),
        createdAt: (existing.createdAt || now).slice(0, 64),
        updatedAt: now,
      };
    }

    const displayName = (
      signupData?.displayName?.trim() ||
      user.displayName ||
      user.email?.split('@')[0] ||
      'User'
    ).slice(0, 128);
    const username = (
      (signupData?.username ? sanitizeUsername(signupData.username) : '') ||
      deriveDefaultUsername(displayName, user.email, user.uid)
    ).slice(0, 64);

    const newProfile: UserProfile = {
      uid: user.uid,
      email: (user.email || '').slice(0, 256),
      displayName,
      username,
      bio: '',
      photoURL: (user.photoURL || '').slice(0, 1024),
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(userRef, newProfile);

    if (signupData?.displayName?.trim() && user.displayName !== displayName) {
      try {
        await updateProfile(user, { displayName });
      } catch {
        // Non-fatal if Firebase Auth profile update cannot run
      }
    }

    return newProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;

  try {
    const snap = await getDoc(doc(firestoreDb, 'users', uid));

    if (!snap.exists()) {
      return null;
    }

    const data = snap.data() as Partial<UserProfile>;

    return {
      uid: data.uid || uid,
      email: data.email || '',
      displayName: data.displayName || '',
      username: data.username || deriveDefaultUsername(data.displayName, data.email, uid),
      bio: data.bio || '',
      photoURL: data.photoURL || '',
      createdAt: data.createdAt || '',
      updatedAt: data.updatedAt,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function saveUserProfile(
  uid: string,
  updates: { displayName: string; username: string; bio: string; photoURL: string },
): Promise<UserProfile> {
  const user = auth.currentUser || (await waitForAuthReady());

  if (!user || user.uid !== uid) {
    throw new Error('You must be signed in to update your profile.');
  }

  const trimmedDisplayName = updates.displayName.trim().slice(0, 128);
  const cleanUsername = updates.username.trim().slice(0, 64);

  if (!trimmedDisplayName) {
    throw new Error('Full name is required.');
  }

  if (cleanUsername && !USERNAME_REGEX.test(cleanUsername)) {
    throw new Error('Username can only contain English letters, numbers, dots (.), underscores (_), and hyphens (-).');
  }

  const finalUsername = cleanUsername || deriveDefaultUsername(trimmedDisplayName, user.email, uid);
  const cleanBio = updates.bio.trim().slice(0, 500);
  const cleanPhotoURL = updates.photoURL.trim().slice(0, 1024);
  const now = new Date().toISOString().slice(0, 64);
  const path = `users/${uid}`;
  const userRef = doc(firestoreDb, 'users', uid);

  try {
    const snap = await getDoc(userRef);

    if (snap.exists()) {
      await updateDoc(userRef, {
        displayName: trimmedDisplayName,
        username: finalUsername,
        bio: cleanBio,
        photoURL: cleanPhotoURL,
        updatedAt: now,
      });

      const existing = snap.data() as Partial<UserProfile>;

      try {
        await updateProfile(user, {
          displayName: trimmedDisplayName,
          photoURL: cleanPhotoURL || null,
        });
      } catch {
        // Non-fatal if Firebase Auth rejects photoURL update
      }

      return {
        uid,
        email: (existing.email || user.email || '').slice(0, 256),
        displayName: trimmedDisplayName,
        username: finalUsername,
        bio: cleanBio,
        photoURL: cleanPhotoURL,
        createdAt: existing.createdAt || now,
        updatedAt: now,
      };
    }

    const createdProfile: UserProfile = {
      uid,
      email: (user.email || '').slice(0, 256),
      displayName: trimmedDisplayName,
      username: finalUsername,
      bio: cleanBio,
      photoURL: cleanPhotoURL,
      createdAt: now,
      updatedAt: now,
    };

    await setDoc(userRef, createdProfile);

    try {
      await updateProfile(user, {
        displayName: trimmedDisplayName,
        photoURL: cleanPhotoURL || null,
      });
    } catch {
      // Non-fatal
    }

    return createdProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getNextId(_db: any): Promise<string> {
  return 'chat_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);
}

export async function getUrlId(_db: any, id: string): Promise<string> {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}
