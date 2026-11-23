import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  type User,
  getAuth,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface UserProfileDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  primaryXyphAddress: string;
  primaryEvmAddress: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  lastSignInAt?: Timestamp;
}

export interface LinkedWalletDoc {
  walletId: string;
  ownerUid: string;
  label: string;
  xyphAddress: string;
  evmAddress: string;
  walletType: 'local' | 'metamask' | 'solana';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

function sanitizeId(raw: string, maxLen: number): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, maxLen);
  return cleaned || 'default_id';
}

function clampString(raw: string | null | undefined, maxLen: number, fallback = ''): string {
  const trimmed = (raw || '').trim();
  return (trimmed || fallback).slice(0, maxLen);
}

export async function signInWithGoogleAccount(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutGoogleAccount(): Promise<void> {
  await signOut(auth);
}

/**
 * Creates a new UserProfile document on first Google Sign-Up or updates
 * sign-in metadata and primary public addresses on returning Google Sign-In.
 * Adheres strictly to firebase-blueprint.json bounds and firestore.rules invariants.
 */
export async function syncUserProfileOnAuth(
  user: User,
  primaryXyphAddress: string,
  primaryEvmAddress: string
): Promise<{ isNewUser: boolean; profile: UserProfileDoc }> {
  const uid = sanitizeId(user.uid, 128);
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  const email = clampString(user.email, 254, 'user@xypher.local');
  const displayName = clampString(user.displayName || user.email?.split('@')[0], 100, 'Xypher User');
  const photoURL = clampString(user.photoURL, 512, '');
  const safeXyph = clampString(primaryXyphAddress, 64, '');
  const safeEvm = clampString(primaryEvmAddress, 64, '');

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    const newPayload = {
      uid,
      email,
      displayName,
      photoURL,
      primaryXyphAddress: safeXyph,
      primaryEvmAddress: safeEvm,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastSignInAt: serverTimestamp(),
    };
    try {
      await setDoc(ref, newPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
    return {
      isNewUser: true,
      profile: {
        uid,
        email,
        displayName,
        photoURL,
        primaryXyphAddress: safeXyph,
        primaryEvmAddress: safeEvm,
      },
    };
  }

  const updatePayload = {
    email,
    displayName,
    photoURL,
    primaryXyphAddress: safeXyph,
    primaryEvmAddress: safeEvm,
    updatedAt: serverTimestamp(),
    lastSignInAt: serverTimestamp(),
  };

  try {
    await updateDoc(ref, updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  return {
    isNewUser: false,
    profile: {
      uid,
      email,
      displayName,
      photoURL,
      primaryXyphAddress: safeXyph,
      primaryEvmAddress: safeEvm,
    },
  };
}

/**
 * Bookmarks a public wallet address under /users/{uid}/wallets/{walletId}.
 * Private keys / WIFs are NEVER transmitted to or stored in Firestore.
 */
export async function saveLinkedWalletBookmark(
  user: User,
  params: {
    walletId: string;
    label: string;
    xyphAddress: string;
    evmAddress: string;
    walletType: 'local' | 'metamask' | 'solana';
  }
): Promise<void> {
  const uid = sanitizeId(user.uid, 128);
  const walletId = sanitizeId(params.walletId, 64);
  const path = `users/${uid}/wallets/${walletId}`;
  const ref = doc(db, 'users', uid, 'wallets', walletId);

  const label = clampString(params.label, 60, 'Wallet');
  const xyphAddress = clampString(params.xyphAddress, 64, '');
  const evmAddress = clampString(params.evmAddress, 64, '');
  if (!xyphAddress) return;

  let existingSnap;
  try {
    existingSnap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (!existingSnap.exists()) {
    try {
      await setDoc(ref, {
        walletId,
        ownerUid: uid,
        label,
        xyphAddress,
        evmAddress,
        walletType: params.walletType,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      await updateDoc(ref, {
        label,
        xyphAddress,
        evmAddress,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }
}

export function subscribeLinkedWallets(
  userId: string,
  onData: (wallets: LinkedWalletDoc[]) => void,
  onError?: (err: Error) => void
): () => void {
  const uid = sanitizeId(userId, 128);
  const path = `users/${uid}/wallets`;
  const q = query(collection(db, 'users', uid, 'wallets'), where('ownerUid', '==', uid));

  return onSnapshot(
    q,
    (snapshot) => {
      const items: LinkedWalletDoc[] = [];
      snapshot.forEach((docSnap) => {
        const d = docSnap.data() as LinkedWalletDoc;
        items.push(d);
      });
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError && wrapped instanceof Error) {
          onError(wrapped);
        }
      }
    }
  );
}
