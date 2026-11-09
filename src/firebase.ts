import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  where,
  getFirestore,
} from "firebase/firestore";

export type AccountRole = "user" | "admin";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Object.values(config).every(
  (value) => typeof value === "string" && value.trim().length > 0,
);

const firebaseApp = isFirebaseConfigured ? initializeApp(config) : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export function watchAuth(
  onUser: (user: User | null) => void,
  onError: (error: Error) => void,
): () => void {
  if (!auth) {
    onUser(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, onUser, onError);
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth) throw new Error("Firebase is not configured. Add the required VITE_FIREBASE values.");
  const result = await signInWithPopup(auth, googleProvider);
  await ensureUserRole(result.user.uid);
  return result.user;
}

export async function signOutUser(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function getUsernameForUser(uid: string): Promise<string | null> {
  if (!db) return null;
  const usernameQuery = query(
    collection(db, "usernameClaims"),
    where("uid", "==", uid),
    limit(1),
  );
  const result = await getDocs(usernameQuery);
  return result.empty ? null : result.docs[0].id;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  if (!db) throw new Error("Firebase is not configured yet.");
  const result = await getDoc(doc(db, "usernameClaims", username));
  return !result.exists();
}

export async function claimUsername(username: string, uid: string): Promise<void> {
  if (!db) throw new Error("Firebase is not configured yet.");
  await setDoc(doc(db, "usernameClaims", username), { uid });
}

export async function findUsername(username: string): Promise<string | null> {
  if (!db) throw new Error("Firebase is not configured yet.");
  const result = await getDoc(doc(db, "usernameClaims", username));
  if (!result.exists()) return null;
  const uid = result.data().uid;
  return typeof uid === "string" ? uid : null;
}

export async function getBalanceCents(uid: string): Promise<number> {
  if (!db) return 0;
  const result = await getDoc(doc(db, "balances", uid));
  if (!result.exists()) return 0;
  const balanceCents = result.data().balanceCents;
  return typeof balanceCents === "number" && Number.isSafeInteger(balanceCents) && balanceCents >= 0
    ? balanceCents
    : 0;
}

export async function ensureUserRole(uid: string): Promise<void> {
  if (!db) return;
  const roleRef = doc(db, "accountRoles", uid);
  if ((await getDoc(roleRef)).exists()) return;
  try {
    await setDoc(roleRef, { role: "user" });
  } catch (error) {
    if (!(await getDoc(roleRef)).exists()) throw error;
  }
}

export async function getAccountRole(uid: string): Promise<AccountRole> {
  if (!db) return "user";
  const result = await getDoc(doc(db, "accountRoles", uid));
  return result.data()?.role === "admin" ? "admin" : "user";
}
