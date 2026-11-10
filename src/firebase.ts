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
  activeProfitCycleId: string | null;
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
  type: "deposit" | "sent" | "received" | "withdrawal" | "profit" | "referral";
  amountCents: number;
  bonusCents?: number;
  status: string;
  detail: string;
  createdAt: Timestamp | null;
}

export interface ProfitCycle {
  id: string;
  status: "active" | "completed";
  principalCents: number;
  currentAmountCents: number;
  totalProfitCents: number;
  totalFeeCents: number;
  dayNumber: number;
  hourInDay: number;
  startedAtMs: number;
  dailyGrowthRate: number;
  dailyFeeRate: number;
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
    activeProfitCycleId: typeof data.activeProfitCycleId === "string" ? data.activeProfitCycleId : null,
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
      activeProfitCycleId: typeof data.activeProfitCycleId === "string" ? data.activeProfitCycleId : null,
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
      title: typeof item.data().title === "string" ? item.data().title : "TRIPLEAPEX update",
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
  const pending = query(collection(db, "receipts"), where("status", "==", "pending"));
  return onSnapshot(pending, (snapshot) => onCount(snapshot.size), onError);
}

export function subscribePendingWithdrawals(
  onCount: (count: number) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const pending = query(collection(db, "withdrawals"), where("status", "==", "pending"));
  return onSnapshot(pending, (snapshot) => onCount(snapshot.size), onError);
}

export function subscribeProfitCycle(
  uid: string,
  onCycle: (cycle: ProfitCycle | null) => void,
  onError: (error: Error) => void,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const cycles = query(collection(db, "profitCycles"), where("uid", "==", uid));
  return onSnapshot(cycles, (snapshot) => {
    const items = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        status: data.status === "active" ? "active" as const : "completed" as const,
        principalCents: Number.isSafeInteger(data.principalCents) ? data.principalCents : 0,
        currentAmountCents: Number.isSafeInteger(data.currentAmountCents) ? data.currentAmountCents : 0,
        totalProfitCents: Number.isSafeInteger(data.totalProfitCents) ? data.totalProfitCents : 0,
        totalFeeCents: Number.isSafeInteger(data.totalFeeCents) ? data.totalFeeCents : 0,
        dayNumber: Number.isSafeInteger(data.dayNumber) ? data.dayNumber : 1,
        hourInDay: Number.isSafeInteger(data.hourInDay) ? data.hourInDay : 0,
        startedAtMs: Number.isSafeInteger(data.startedAtMs) ? data.startedAtMs : 0,
        dailyGrowthRate: typeof data.dailyGrowthRate === "number" && Number.isFinite(data.dailyGrowthRate) ? data.dailyGrowthRate : 0.053,
        dailyFeeRate: typeof data.dailyFeeRate === "number" && Number.isFinite(data.dailyFeeRate) ? data.dailyFeeRate : 0.01,
      };
    }).sort((left, right) => right.startedAtMs - left.startedAtMs);
    onCycle(items.find((item) => item.status === "active") || items[0] || null);
  }, onError);
}

export function subscribeAccountActivity(
  uid: string,
  onItems: (items: AccountActivity[]) => void,
  onError: (error: Error) => void,
  includeAll = false,
): () => void {
  if (!db) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  let receipts: AccountActivity[] = [];
  let legacyReceipts: AccountActivity[] = [];
  let migratedLegacyReceiptIds = new Set<string>();
  let transfers: AccountActivity[] = [];
  let withdrawals: AccountActivity[] = [];
  let profitActivity: AccountActivity[] = [];
  const publish = () => {
    const items = [...receipts, ...legacyReceipts, ...transfers, ...withdrawals, ...profitActivity]
      .sort((left, right) => (right.createdAt?.toMillis() || 0) - (left.createdAt?.toMillis() || 0));
    onItems(includeAll ? items : items.slice(0, 12));
  };
  const receiptQuery = query(collection(db, "receipts"), where("uid", "==", uid));
  const stopReceipts = onSnapshot(receiptQuery, (snapshot) => {
    migratedLegacyReceiptIds = new Set(snapshot.docs
      .map((item) => item.data().legacySourceId)
      .filter((id): id is string => typeof id === "string"));
    legacyReceipts = legacyReceipts.filter((item) => !migratedLegacyReceiptIds.has(item.id));
    receipts = snapshot.docs.map((item) => {
      const data = item.data();
      const bonusCents = data.status === "approved" && Number.isSafeInteger(data.firstDepositBonusCents)
        ? data.firstDepositBonusCents
        : 0;
      return {
        id: item.id,
        type: "deposit",
        amountCents: (Number.isSafeInteger(data.amountCents)
          ? data.amountCents
          : typeof data.amount === "number" && Number.isFinite(data.amount)
            ? Math.round(data.amount * 100)
            : 0) + bonusCents,
        ...(bonusCents > 0 ? { bonusCents } : {}),
        status: typeof data.status === "string" ? data.status : "pending",
        detail: `${typeof data.asset === "string" ? data.asset : "Deposit"} · ${typeof data.networkName === "string" ? data.networkName : "Crypto"}${bonusCents > 0 ? ` · +$${(bonusCents / 100).toFixed(2)} first-deposit gift` : ""}`,
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  const legacyReceiptsCollection = collection(db, "users", uid, "receipts");
  const legacyReceiptQuery = includeAll
    ? query(legacyReceiptsCollection, orderBy("createdAt", "desc"))
    : query(legacyReceiptsCollection, orderBy("createdAt", "desc"), limit(12));
  const transfersCollection = collection(db, "users", uid, "transfers");
  const transferQuery = includeAll
    ? query(transfersCollection, orderBy("createdAt", "desc"))
    : query(transfersCollection, orderBy("createdAt", "desc"), limit(12));
  const withdrawalQuery = query(collection(db, "withdrawals"), where("uid", "==", uid));
  const profitActivityCollection = collection(db, "users", uid, "profitActivity");
  const profitActivityQuery = includeAll
    ? query(profitActivityCollection, orderBy("createdAt", "desc"))
    : query(profitActivityCollection, orderBy("createdAt", "desc"), limit(50));
  const stopLegacyReceipts = onSnapshot(legacyReceiptQuery, (snapshot) => {
    legacyReceipts = snapshot.docs.filter((item) => !migratedLegacyReceiptIds.has(item.id)).map((item) => {
      const data = item.data();
      const bonusCents = data.status === "approved" && Number.isSafeInteger(data.firstDepositBonusCents)
        ? data.firstDepositBonusCents
        : 0;
      return {
        id: item.id,
        type: "deposit",
        amountCents: (Number.isSafeInteger(data.amountCents)
          ? data.amountCents
          : typeof data.amount === "number" && Number.isFinite(data.amount)
            ? Math.round(data.amount * 100)
            : 0) + bonusCents,
        ...(bonusCents > 0 ? { bonusCents } : {}),
        status: typeof data.status === "string" ? data.status : "pending",
        detail: `${typeof data.asset === "string" ? data.asset : "Deposit"} · ${typeof data.networkName === "string" ? data.networkName : "Crypto"}${bonusCents > 0 ? ` · +$${(bonusCents / 100).toFixed(2)} first-deposit gift` : ""}`,
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
        detail: typeof data.counterpartyUsername === "string" ? `@${data.counterpartyUsername}` : "TRIPLEAPEX user",
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  const stopWithdrawals = onSnapshot(withdrawalQuery, (snapshot) => {
    withdrawals = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        type: "withdrawal",
        amountCents: Number.isSafeInteger(data.amountCents) ? data.amountCents : 0,
        status: typeof data.status === "string" ? data.status : "pending",
        detail: `${typeof data.asset === "string" ? data.asset : "Crypto"} · ${typeof data.networkName === "string" ? data.networkName : "Withdrawal"}`,
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  const stopProfitActivity = onSnapshot(profitActivityQuery, (snapshot) => {
    profitActivity = snapshot.docs.map((item) => {
      const data = item.data();
      return {
        id: item.id,
        type: data.type === "referral" ? "referral" : "profit",
        amountCents: Number.isSafeInteger(data.amountCents) ? data.amountCents : 0,
        status: data.type === "fee" ? "fee" : data.type === "referral" ? "reward" : "credited",
        detail: data.type === "referral"
          ? (typeof data.detail === "string" ? data.detail : "Referral reward")
          : `Day ${Number.isSafeInteger(data.dayNumber) ? data.dayNumber : 1}${data.type === "fee" ? " · cycle fee" : ` · hour ${Number.isSafeInteger(data.hourInDay) ? data.hourInDay : 1}`}`,
        createdAt: data.createdAt ?? null,
      };
    });
    publish();
  }, onError);
  return () => {
    stopReceipts();
    stopLegacyReceipts();
    stopTransfers();
    stopWithdrawals();
    stopProfitActivity();
  };
}
