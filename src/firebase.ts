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
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Timestamp,
} from "firebase/firestore";

export type AccountRole = "user" | "admin";

export interface UserProfile {
  username: string;
  email: string;
  role: AccountRole;
  balanceCents: number;
  isBanned: boolean;
}

export interface AccountNotification {
  id: string;
  title: string;
  message: string;
  readAt: Timestamp | null;
  createdAt: Timestamp | null;
}

export interface AccountActivity {
  id: string;
  type: "deposit" | "sent" | "received";
  amountCents: number;
  status: string;
  detail: string;
  createdAt: Timestamp | null;
}

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

export async function apiRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<T> {
  if (!auth) throw new Error("Firebase is not configured.");
  const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload as T;
}

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
  const result = await getDoc(doc(db, "users", uid));
  const username = result.data()?.username;
  return typeof username === "string" && username ? username : null;
}

export async function isUsernameAvailable(username: string): Promise<boolean> {
  const result = await apiRequest<{ available: boolean }>(
    `/api/users/username/available?username=${encodeURIComponent(username)}`,
  );
  return result.available;
}

export async function claimUsername(username: string, _uid: string): Promise<void> {
  await apiRequest("/api/users/username", { method: "POST", body: { username } });
}

export async function findUsername(username: string): Promise<string | null> {
  const result = await apiRequest<{ uid: string | null }>(
    `/api/users/lookup?username=${encodeURIComponent(username)}`,
  );
  return result.uid;
}

export async function getBalanceCents(uid: string): Promise<number> {
  if (!db) return 0;
  const result = await getDoc(doc(db, "users", uid));
  const balanceCents = result.data()?.balanceCents;
  return typeof balanceCents === "number" && Number.isSafeInteger(balanceCents) && balanceCents >= 0
    ? balanceCents
    : 0;
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (!db) return null;
  const result = await getDoc(doc(db, "users", uid));
  const data = result.data();
  if (!data) return null;
  return {
    username: typeof data.username === "string" ? data.username : "",
    email: typeof data.email === "string" ? data.email : "",
    role: data.role === "admin" ? "admin" : "user",
    balanceCents: Number.isSafeInteger(data.balanceCents) && data.balanceCents >= 0 ? data.balanceCents : 0,
    isBanned: data.isBanned === true,
  };
}

export async function ensureUserRole(_uid: string): Promise<void> {
  await apiRequest("/api/users/ensure", { method: "POST" });
}

export async function getAccountRole(uid: string): Promise<AccountRole> {
  if (!db) return "user";
  const result = await getDoc(doc(db, "users", uid));
  return result.data()?.role === "admin" ? "admin" : "user";
}

export function subscribeUserProfile(
  uid: string,
  onProfile: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(doc(db, "users", uid), (snapshot) => {
    const data = snapshot.data();
    if (!data) {
      onProfile(null);
      return;
    }
    onProfile({
      username: typeof data.username === "string" ? data.username : "",
      email: typeof data.email === "string" ? data.email : "",
      role: data.role === "admin" ? "admin" : "user",
      balanceCents: Number.isSafeInteger(data.balanceCents) && data.balanceCents >= 0 ? data.balanceCents : 0,
      isBanned: data.isBanned === true,
    });
  }, onError);
}

export function subscribeNotifications(
  uid: string,
  onItems: (items: AccountNotification[]) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const notifications = query(
    collection(db, "users", uid, "notifications"),
    orderBy("createdAt", "desc"),
    limit(30),
  );
  return onSnapshot(notifications, (snapshot) => {
    onItems(snapshot.docs.map((item) => ({
      id: item.id,
      title: typeof item.data().title === "string" ? item.data().title : "Triplex update",
      message: typeof item.data().message === "string" ? item.data().message : "",
      readAt: item.data().readAt ?? null,
      createdAt: item.data().createdAt ?? null,
    })));
  }, onError);
}

export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  if (!db) throw new Error("Firebase is not configured.");
  await updateDoc(doc(db, "users", uid, "notifications", notificationId), { readAt: serverTimestamp() });
}

export async function deleteNotification(uid: string, notificationId: string): Promise<void> {
  if (!db) throw new Error("Firebase is not configured.");
  await deleteDoc(doc(db, "users", uid, "notifications", notificationId));
}

export function subscribePendingReceipts(
  onCount: (count: number) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const pending = query(collectionGroup(db, "receipts"), where("status", "==", "pending"));
  return onSnapshot(pending, (snapshot) => onCount(snapshot.size), onError);
}

export function subscribeAccountActivity(
  uid: string,
  onItems: (items: AccountActivity[]) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  let receipts: AccountActivity[] = [];
  let transfers: AccountActivity[] = [];
  const publish = () => {
    onItems([...receipts, ...transfers]
      .sort((left, right) => (right.createdAt?.toMillis() || 0) - (left.createdAt?.toMillis() || 0))
      .slice(0, 12));
  };
  const receiptQuery = query(
    collection(db, "users", uid, "receipts"),
    orderBy("createdAt", "desc"),
    limit(12),
  );
  const transferQuery = query(
    collection(db, "users", uid, "transfers"),
    orderBy("createdAt", "desc"),
    limit(12),
  );
  const stopReceipts = onSnapshot(receiptQuery, (snapshot) => {
    receipts = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        type: "deposit",
        amountCents: Number.isSafeInteger(data.amountCents) ? data.amountCents : 0,
        status: typeof data.status === "string" ? data.status : "pending",
        detail: `${typeof data.asset === "string" ? data.asset : "Deposit"} · ${typeof data.networkName === "string" ? data.networkName : "Crypto"}`,
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  const stopTransfers = onSnapshot(transferQuery, (snapshot) => {
    transfers = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        type: data.type === "received" ? "received" : "sent",
        amountCents: Number.isSafeInteger(data.amountCents) ? data.amountCents : 0,
        status: "completed",
        detail: typeof data.counterpartyUsername === "string" ? `@${data.counterpartyUsername}` : "Triplex user",
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  return () => {
    stopReceipts();
    stopTransfers();
  };
}
