import "dotenv/config";

import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { v2 as cloudinary } from "cloudinary";

const root = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(root, "dist");
const port = Number(process.env.PORT) || 10000;
const maxJsonBytes = 128 * 1024;
const maxReceiptBytes = 10 * 1024 * 1024;
const profitCycleHourMs = 60 * 60 * 1000;
const profitCycleHours = 5 * 24;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let firebaseReady = false;
let auth = null;
let db = null;
if (serviceAccountJson) {
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (error) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid JSON.", { cause: error });
  }
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || serviceAccount.project_id,
    });
  }
  auth = getAuth();
  db = getFirestore();
  firebaseReady = true;
} else {
  console.error("FIREBASE_SERVICE_ACCOUNT_JSON is missing; account and payment API routes will return 503.");
}
const walletConfig = {
  BTC_BITCOIN: process.env.BTC_BITCOIN,
  USDT_ETHEREUM: process.env.USDT_ETHEREUM,
  USDT_BSC: process.env.USDT_BSC,
  USDT_TRON: process.env.USDT_TRON,
  USDT_SOLANA: process.env.USDT_SOLANA,
  USDT_TON: process.env.USDT_TON,
  USDC_ETHEREUM: process.env.USDC_ETHEREUM,
  USDC_SOLANA: process.env.USDC_SOLANA,
  USDC_ARBITRUM: process.env.USDC_ARBITRUM,
  USDC_SUI: process.env.USDC_SUI,
  ETH_ETHEREUM: process.env.ETH_ETHEREUM,
  ETH_ARBITRUM: process.env.ETH_ARBITRUM,
  BNB_BSC: process.env.BNB_BSC,
  SOL_SOLANA: process.env.SOL_SOLANA,
  GRAM_TON: process.env.GRAM_TON,
  TRX_TRON: process.env.TRX_TRON,
  SUI_SUI: process.env.SUI_SUI,
};

const depositAssets = [
  { code: "BTC", name: "Bitcoin", symbol: "₿", networks: [{ code: "BITCOIN", name: "Bitcoin" }] },
  { code: "USDT", name: "Tether", symbol: "₮", networks: [
    { code: "ETHEREUM", name: "Ethereum (ERC20)" },
    { code: "BSC", name: "BNB Smart Chain (BEP20)" },
    { code: "TRON", name: "Tron (TRC20)" },
    { code: "SOLANA", name: "Solana" },
    { code: "TON", name: "The Open Network (TON)" },
  ] },
  { code: "USDC", name: "USD Coin", symbol: "$", networks: [
    { code: "ETHEREUM", name: "Ethereum (ERC20)" },
    { code: "SOLANA", name: "Solana" },
    { code: "ARBITRUM", name: "Arbitrum One" },
    { code: "SUI", name: "Sui" },
  ] },
  { code: "ETH", name: "Ethereum", symbol: "◆", networks: [
    { code: "ETHEREUM", name: "Ethereum (ERC20)" },
    { code: "ARBITRUM", name: "Arbitrum One" },
  ] },
  { code: "BNB", name: "BNB", symbol: "◆", networks: [{ code: "BSC", name: "BNB Smart Chain (BEP20)" }] },
  { code: "SOL", name: "Solana", symbol: "≋", networks: [{ code: "SOLANA", name: "Solana" }] },
  { code: "GRAM", name: "Gram", symbol: "G", networks: [{ code: "TON", name: "The Open Network (TON)" }] },
  { code: "TRX", name: "TRON", symbol: "T", networks: [{ code: "TRON", name: "Tron (TRC20)" }] },
  { code: "SUI", name: "Sui", symbol: "S", networks: [{ code: "SUI", name: "Sui" }] },
];

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET?.trim();
const cloudinaryConfigured = Boolean(cloudName && cloudApiKey && cloudApiSecret);
if (cloudinaryConfigured) {
  cloudinary.config({ cloud_name: cloudName, api_key: cloudApiKey, api_secret: cloudApiSecret, secure: true });
}

const allowedOrigins = new Set(
  (process.env.APP_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const requestCounts = new Map();

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function validateOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return {};
  const hostOrigin = `${request.headers["x-forwarded-proto"] || "http"}://${request.headers.host}`;
  if (origin === hostOrigin || allowedOrigins.has(origin)) {
    return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }
  fail(403, "This website is not allowed to use the API.");
}

function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = requestCounts.get(key);
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (current.count >= limit) fail(429, "Too many requests. Please try again later.");
  current.count += 1;
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxJsonBytes) fail(413, "Request is too large.");
    chunks.push(chunk);
  }
  if (bytes === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Request body must be valid JSON.");
  }
}

function validateUsername(value) {
  return typeof value === "string" && /^[a-z0-9_]{3,20}$/.test(value);
}

function validateAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100_000_000;
}

function userRef(uid) {
  requireFirebase();
  return db.collection("users").doc(uid);
}

function requireFirebase() {
  if (!firebaseReady || !auth || !db) fail(503, "Account services are not configured yet.");
}

function notificationRef(uid) {
  return userRef(uid).collection("notifications").doc();
}

async function hasApprovedDeposit(uid) {
  const [receipts, legacyReceipts] = await Promise.all([
    db.collection("receipts").where("uid", "==", uid).get(),
    userRef(uid).collection("receipts").where("status", "==", "approved").get(),
  ]);
  return receipts.docs.some((receipt) => receipt.data().status === "approved")
    || !legacyReceipts.empty;
}

function publicProfile(uid, data) {
  return {
    uid,
    username: data.username || "",
    email: data.email || "",
    role: data.role === "admin" ? "admin" : "user",
    balanceCents: Number.isSafeInteger(data.balanceCents) && data.balanceCents >= 0 ? data.balanceCents : 0,
    isBanned: data.isBanned === true,
    activeProfitCycleId: typeof data.activeProfitCycleId === "string" ? data.activeProfitCycleId : null,
  };
}

async function ensureProfile(firebaseUser) {
  const profileRef = userRef(firebaseUser.uid);
  const existing = await profileRef.get();
  if (existing.exists) return existing.data();

  const [legacyRole, legacyBalance, legacyUsername] = await Promise.all([
    db.collection("accountRoles").doc(firebaseUser.uid).get(),
    db.collection("balances").doc(firebaseUser.uid).get(),
    db.collection("usernameClaims").where("uid", "==", firebaseUser.uid).limit(1).get(),
  ]);
  const username = legacyUsername.empty ? "" : legacyUsername.docs[0].id;
  const usernameLower = username.toLowerCase();
  const nameIndexRef = usernameLower ? db.collection("usernames").doc(usernameLower) : null;
  const profile = {
    username,
    usernameLower,
    email: firebaseUser.email || "",
    role: legacyRole.data()?.role === "admin" ? "admin" : "user",
    balanceCents: Number.isSafeInteger(legacyBalance.data()?.balanceCents) && legacyBalance.data().balanceCents >= 0
      ? legacyBalance.data().balanceCents
      : 0,
    isBanned: false,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(profileRef);
    if (current.exists) return;
    if (nameIndexRef) {
      const nameIndex = await transaction.get(nameIndexRef);
      if (nameIndex.exists && nameIndex.data()?.uid !== firebaseUser.uid) {
        profile.username = "";
        profile.usernameLower = "";
      } else {
        transaction.set(nameIndexRef, { uid: firebaseUser.uid, username, createdAt: FieldValue.serverTimestamp() });
      }
    }
    transaction.create(profileRef, profile);
  });
  return (await profileRef.get()).data();
}

async function authenticate(request, { adminOnly = false, allowBanned = false } = {}) {
  requireFirebase();
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer (.+)$/);
  if (!match) fail(401, "Please sign in to continue.");

  let identity;
  try {
    identity = await auth.verifyIdToken(match[1], true);
  } catch {
    fail(401, "Your session has expired. Please sign in again.");
  }

  let profile = (await userRef(identity.uid).get()).data();
  if (!profile) {
    const firebaseUser = await auth.getUser(identity.uid);
    profile = await ensureProfile(firebaseUser);
  }
  if (profile.isBanned === true && !allowBanned) fail(403, "This account is banned.");
  if (adminOnly && profile.role !== "admin") fail(403, "Administrator access is required.");
  return { identity, profile: publicProfile(identity.uid, profile) };
}

function getWallet(asset, network) {
  const key = `${asset}_${network}`;
  if (!(key in walletConfig)) return null;
  const address = walletConfig[key]?.trim();
  return address ? { key, address } : null;
}

function getNetwork(asset, network) {
  const coin = depositAssets.find((item) => item.code === asset);
  return coin?.networks.find((item) => item.code === network) || null;
}

function cloudinaryReady() {
  if (!cloudinaryConfigured) fail(503, "Receipt uploads are temporarily unavailable.");
  if (!uploadPreset) fail(503, "Receipt uploads are not configured yet.");
}

async function createUploadSignature(uid) {
  cloudinaryReady();
  const timestamp = Math.floor(Date.now() / 1000);
  const requestId = randomUUID();
  const params = {
    context: `owner_uid=${uid}|request_id=${requestId}`,
    overwrite: false,
    public_id: `triplex-receipts/${uid}/${requestId}`,
    timestamp,
    type: "authenticated",
  };
  if (uploadPreset) params.upload_preset = uploadPreset;
  const signature = cloudinary.utils.api_sign_request(params, cloudApiSecret);
  return {
    apiKey: cloudApiKey,
    cloudName,
    params,
    signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
    requestId,
  };
}

async function verifyCloudinaryAsset(uid, requestId, claimedPublicId) {
  cloudinaryReady();
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) fail(400, "Invalid upload reference.");
  const expectedPublicId = `triplex-receipts/${uid}/${requestId}`;
  if (claimedPublicId !== expectedPublicId) fail(400, "The receipt upload reference does not match.");
  let asset;
  try {
    asset = await cloudinary.api.resource(expectedPublicId, {
      resource_type: "image",
      type: "authenticated",
    });
  } catch {
    fail(400, "The uploaded receipt could not be verified.");
  }
  if (
    asset.public_id !== expectedPublicId
    || asset.type !== "authenticated"
    || !["jpg", "jpeg", "png", "webp", "pdf"].includes(String(asset.format).toLowerCase())
    || !Number.isSafeInteger(asset.bytes)
    || asset.bytes <= 0
    || asset.bytes > maxReceiptBytes
  ) {
    fail(400, "The uploaded file is not a supported receipt.");
  }
  return {
    publicId: asset.public_id,
    format: String(asset.format).toLowerCase(),
    bytes: asset.bytes,
    cloudinaryUrl: typeof asset.secure_url === "string" ? asset.secure_url : null,
  };
}

async function migrateLegacyReceipts() {
  const migrationRef = db.collection("_system").doc("receiptCollectionV1");
  const acquired = await db.runTransaction(async (transaction) => {
    const migration = await transaction.get(migrationRef);
    if (migration.data()?.state === "complete") return false;
    const startedAt = migration.data()?.startedAtMs;
    if (
      migration.data()?.state === "running"
      && Number.isSafeInteger(startedAt)
      && Date.now() - startedAt < 30 * 60 * 1000
    ) {
      return false;
    }
    transaction.set(migrationRef, { state: "running", startedAtMs: Date.now() });
    return true;
  });
  if (!acquired) {
    const migration = await migrationRef.get();
    if (migration.data()?.state === "complete") return;
    fail(503, "Existing deposit requests are being moved to the receipts collection. Please retry shortly.");
  }

  try {
    const users = await db.collection("users").get();
    let batch = db.batch();
    let operationCount = 0;
    for (const user of users.docs) {
      const legacyReceipts = await user.ref.collection("receipts").get();
      for (const legacyReceipt of legacyReceipts.docs) {
        const data = legacyReceipt.data();
        const receiptRef = db.collection("receipts").doc(`legacy_${user.id}_${legacyReceipt.id}`);
        batch.set(receiptRef, {
          ...data,
          uid: user.id,
          legacySourceId: legacyReceipt.id,
          cloudinaryUrl: data.cloudinaryUrl || data.receipt?.cloudinaryUrl || null,
        });
        operationCount += 1;
        if (operationCount === 450) {
          await batch.commit();
          batch = db.batch();
          operationCount = 0;
        }
      }
    }
    if (operationCount) await batch.commit();
    await migrationRef.set({ state: "complete", completedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    console.error("Could not move legacy deposit requests into the receipts collection.", error);
    await migrationRef.set({ state: "failed" }, { merge: true });
    throw error;
  }
}

function profitDay(openingCents) {
  const profitCents = Math.round(openingCents * 0.053);
  const postGrowthCents = openingCents + profitCents;
  const feeCents = Math.round(postGrowthCents * 0.01);
  return { profitCents, feeCents, netCents: postGrowthCents - feeCents };
}

async function processProfitCycle(cycleRef) {
  const now = Date.now();
  await db.runTransaction(async (transaction) => {
    const cycleSnapshot = await transaction.get(cycleRef);
    const cycle = cycleSnapshot.data();
    if (!cycleSnapshot.exists || cycle.status !== "active") return;
    if (
      typeof cycle.uid !== "string"
      || !Number.isSafeInteger(cycle.lastAccruedAtMs)
      || !Number.isSafeInteger(cycle.dayNumber)
      || !Number.isSafeInteger(cycle.hourInDay)
      || !Number.isSafeInteger(cycle.dailyOpeningCents)
    ) {
      throw new Error(`Profit cycle ${cycleRef.id} has invalid state.`);
    }
    const elapsedHours = Math.min(
      profitCycleHours,
      Math.floor((now - cycle.lastAccruedAtMs) / profitCycleHourMs),
    );
    if (elapsedHours <= 0) return;
    const profileRef = userRef(cycle.uid);
    const profileSnapshot = await transaction.get(profileRef);
    if (!profileSnapshot.exists) throw new Error(`Profit cycle ${cycleRef.id} has no member profile.`);
    const profile = profileSnapshot.data();
    let balanceCents = Number.isSafeInteger(profile.balanceCents) && profile.balanceCents >= 0
      ? profile.balanceCents
      : 0;
    let lastAccruedAtMs = cycle.lastAccruedAtMs;
    let dayNumber = cycle.dayNumber;
    let hourInDay = cycle.hourInDay;
    let dailyOpeningCents = cycle.dailyOpeningCents;
    let dailyEarnedCents = cycle.dailyEarnedCents || 0;
    let currentAmountCents = cycle.currentAmountCents;
    let totalProfitCents = cycle.totalProfitCents || 0;
    let totalFeeCents = cycle.totalFeeCents || 0;
    let status = "active";
    let completed = false;

    for (let step = 0; step < elapsedHours && status === "active"; step += 1) {
      hourInDay += 1;
      const { profitCents } = profitDay(dailyOpeningCents);
      const earningsTarget = Math.round((profitCents * hourInDay) / 24);
      const hourlyEarnings = earningsTarget - dailyEarnedCents;
      if (hourlyEarnings > 0) {
        balanceCents += hourlyEarnings;
        totalProfitCents += hourlyEarnings;
        dailyEarnedCents += hourlyEarnings;
        transaction.create(userRef(cycle.uid).collection("profitActivity").doc(`${cycleRef.id}_${dayNumber}_${hourInDay}_profit`), {
          uid: cycle.uid,
          cycleId: cycleRef.id,
          type: "profit",
          amountCents: hourlyEarnings,
          dayNumber,
          hourInDay,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      if (hourInDay === 24) {
        const { feeCents, netCents } = profitDay(dailyOpeningCents);
        if (feeCents > 0) {
          balanceCents -= feeCents;
          totalFeeCents += feeCents;
          transaction.create(userRef(cycle.uid).collection("profitActivity").doc(`${cycleRef.id}_${dayNumber}_fee`), {
            uid: cycle.uid,
            cycleId: cycleRef.id,
            type: "fee",
            amountCents: -feeCents,
            dayNumber,
            hourInDay,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        currentAmountCents = netCents;
        if (dayNumber === 5) {
          const principalCents = cycle.principalCents;
          if (!Number.isSafeInteger(principalCents) || principalCents <= 0) {
            throw new Error(`Profit cycle ${cycleRef.id} has an invalid principal.`);
          }
          balanceCents += principalCents;
          if (!Number.isSafeInteger(balanceCents)) throw new Error(`Profit cycle ${cycleRef.id} exceeded the supported balance.`);
          status = "completed";
          completed = true;
          transaction.create(notificationRef(cycle.uid), {
            title: "Five-day cycle completed",
            message: "Your five-day profit cycle is complete. Your reserved starting amount has returned to your available USD balance, and withdrawals are now available.",
            kind: "profit",
            metadata: { cycleId: cycleRef.id, status },
            readAt: null,
            createdAt: FieldValue.serverTimestamp(),
          });
          transaction.update(profileRef, {
            balanceCents,
            activeProfitCycleId: null,
            updatedAt: FieldValue.serverTimestamp(),
          });
        } else {
          dayNumber += 1;
          hourInDay = 0;
          dailyOpeningCents = netCents;
          dailyEarnedCents = 0;
        }
      }
      lastAccruedAtMs += profitCycleHourMs;
    }

    if (!completed) {
      if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
        throw new Error(`Profit cycle ${cycleRef.id} produced an invalid member balance.`);
      }
      transaction.update(profileRef, { balanceCents, updatedAt: FieldValue.serverTimestamp() });
    }
    transaction.update(cycleRef, {
      status,
      currentAmountCents,
      totalProfitCents,
      totalFeeCents,
      dayNumber,
      hourInDay,
      dailyOpeningCents,
      dailyEarnedCents,
      lastAccruedAtMs,
      completedAt: completed ? FieldValue.serverTimestamp() : null,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

let profitCycleWorkerRunning = false;
async function processDueProfitCycles() {
  if (!firebaseReady || profitCycleWorkerRunning) return;
  profitCycleWorkerRunning = true;
  try {
    let cursor = null;
    for (;;) {
      let cycleQuery = db.collection("profitCycles").where("status", "==", "active").limit(100);
      if (cursor) cycleQuery = cycleQuery.startAfter(cursor);
      const activeCycles = await cycleQuery.get();
      await Promise.all(activeCycles.docs.map((cycle) => processProfitCycle(cycle.ref)));
      if (activeCycles.size < 100) break;
      cursor = activeCycles.docs[activeCycles.docs.length - 1];
    }
  } catch (error) {
    console.error("Could not process due profit cycle entries.", error);
  } finally {
    profitCycleWorkerRunning = false;
  }
}

async function routeApi(request, response, url, corsHeaders) {
  const method = request.method || "GET";
  const pathname = url.pathname;
  const send = (status, data) => sendJson(response, status, data, corsHeaders);

  if (method === "GET" && pathname === "/api/health") {
    return send(200, { ok: true, accountServicesReady: firebaseReady });
  }
  if (method === "GET" && pathname === "/api/deposits/options") {
    return send(200, {
      assets: depositAssets.map((asset) => ({
        ...asset,
        networks: asset.networks.map((network) => ({
          ...network,
          available: Boolean(getWallet(asset.code, network.code)),
        })),
      })),
    });
  }
  if (method === "GET" && pathname === "/api/withdrawals/options") {
    return send(200, {
      assets: depositAssets.map((asset) => ({
        ...asset,
        networks: asset.networks.map((network) => ({ ...network, available: true })),
      })),
    });
  }
  if (pathname === "/api/users/ensure" && method === "POST") {
    const { identity } = await authenticate(request, { allowBanned: true });
    const firebaseUser = await auth.getUser(identity.uid);
    const profile = await ensureProfile(firebaseUser);
    return send(200, { user: publicProfile(identity.uid, profile) });
  }
  if (pathname === "/api/users/username/available" && method === "GET") {
    requireFirebase();
    const username = (url.searchParams.get("username") || "").toLowerCase();
    if (!validateUsername(username)) return send(200, { available: false });
    const index = await db.collection("usernames").doc(username).get();
    const legacy = index.exists ? null : await db.collection("usernameClaims").doc(username).get();
    return send(200, { available: !index.exists && !legacy?.exists });
  }
  if (pathname === "/api/users/username" && method === "POST") {
    const { identity } = await authenticate(request);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!validateUsername(username)) fail(400, "Use 3–20 lowercase letters, numbers, or underscores.");
    const profileRef = userRef(identity.uid);
    const indexRef = db.collection("usernames").doc(username);
    const legacyRef = db.collection("usernameClaims").doc(username);
    const legacy = await legacyRef.get();
    await db.runTransaction(async (transaction) => {
      const [profile, index] = await Promise.all([
        transaction.get(profileRef),
        transaction.get(indexRef),
      ]);
      if (!profile.exists) fail(404, "Account profile not found.");
      if (profile.data().username) fail(409, "A username is already set for this account.");
      if (index.exists && index.data()?.uid !== identity.uid) fail(409, "That username is already taken.");
      if (legacy.exists && legacy.data()?.uid !== identity.uid) fail(409, "That username is already taken.");
      transaction.set(indexRef, { uid: identity.uid, username, createdAt: FieldValue.serverTimestamp() });
      transaction.update(profileRef, {
        username,
        usernameLower: username,
        email: identity.email || "",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    return send(200, { username });
  }
  if (pathname === "/api/users/lookup" && method === "GET") {
    await authenticate(request);
    const username = (url.searchParams.get("username") || "").toLowerCase();
    if (!validateUsername(username)) return send(200, { uid: null });
    const index = await db.collection("usernames").doc(username).get();
    if (index.exists) return send(200, { uid: index.data()?.uid || null });
    const legacy = await db.collection("usernameClaims").doc(username).get();
    return send(200, { uid: legacy.data()?.uid || null });
  }
  if (pathname === "/api/deposits/address" && method === "GET") {
    const { identity, profile } = await authenticate(request);
    const asset = (url.searchParams.get("asset") || "").toUpperCase();
    const network = (url.searchParams.get("network") || "").toUpperCase();
    const details = getNetwork(asset, network);
    const wallet = getWallet(asset, network);
    if (!details || !wallet) fail(404, "This deposit network is not available yet.");
    const bonusEligible = profile.firstDepositBonusClaimed === true
      ? false
      : !(await hasApprovedDeposit(identity.uid));
    return send(200, {
      asset,
      network,
      networkName: details.name,
      address: wallet.address,
      username: profile.username,
      firstDepositBonus: { eligible: bonusEligible, percentage: 20 },
    });
  }
  if (pathname === "/api/uploads/sign" && method === "POST") {
    const { identity } = await authenticate(request);
    checkRateLimit(`upload:${identity.uid}`, 12, 60 * 60 * 1000);
    const body = await readJson(request);
    const asset = typeof body.asset === "string" ? body.asset.toUpperCase() : "";
    const network = typeof body.network === "string" ? body.network.toUpperCase() : "";
    if (!getNetwork(asset, network) || !getWallet(asset, network)) fail(400, "Select a configured deposit network before uploading a receipt.");
    return send(200, await createUploadSignature(identity.uid));
  }
  if (pathname === "/api/deposits/requests" && method === "POST") {
    const { identity, profile } = await authenticate(request);
    checkRateLimit(`deposit:${identity.uid}`, 10, 60 * 60 * 1000);
    const body = await readJson(request);
    const asset = typeof body.asset === "string" ? body.asset.toUpperCase() : "";
    const network = typeof body.network === "string" ? body.network.toUpperCase() : "";
    if (!getNetwork(asset, network) || !getWallet(asset, network)) fail(400, "This deposit network is not available yet.");
    if (!validateAmount(body.amountCents)) fail(400, "Enter a valid deposit amount.");
    if (body.amountCents < 1_000) fail(400, "The minimum deposit is $10.00.");
    if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) fail(400, "Invalid deposit request ID.");

    let receipt = null;
    if (body.uploadRequestId || body.publicId) {
      receipt = await verifyCloudinaryAsset(identity.uid, body.uploadRequestId, body.publicId);
    }
    const wallet = getWallet(asset, network);
    const receiptCollection = db.collection("receipts");
    const newReceiptRef = receiptCollection.doc();
    const requestKeyRef = userRef(identity.uid).collection("depositRequestKeys").doc(body.requestId);
    const notification = notificationRef(identity.uid);
    const networkDetails = getNetwork(asset, network);
    const admins = await db.collection("users").where("role", "==", "admin").limit(100).get();
    const adminNotifications = admins.docs
      .filter((admin) => admin.data().isBanned !== true)
      .map((admin) => ({
        ref: notificationRef(admin.id),
        username: profile.username || profile.email,
      }));
    let created = false;
    let receiptId = "";
    await db.runTransaction(async (transaction) => {
      created = false;
      receiptId = "";
      const [currentProfile, requestKey] = await Promise.all([
        transaction.get(userRef(identity.uid)),
        transaction.get(requestKeyRef),
      ]);
      if (!currentProfile.exists || currentProfile.data()?.isBanned === true) fail(403, "This account cannot submit a deposit.");
      if (requestKey.exists) {
        receiptId = requestKey.data()?.receiptId;
        const existingReceipt = receiptId ? await transaction.get(receiptCollection.doc(receiptId)) : null;
        if (!existingReceipt?.exists) fail(409, "This deposit request could not be verified. Please contact support.");
        const existing = existingReceipt.data();
        if (
          existing.uid !== identity.uid
          || existing.amountCents !== body.amountCents
          || existing.asset !== asset
          || existing.network !== network
          || (existing.receipt?.publicId || null) !== (receipt?.publicId || null)
        ) {
          fail(409, "This request ID has already been used for a different deposit.");
        }
        return;
      }
      receiptId = newReceiptRef.id;
      transaction.create(newReceiptRef, {
        requestId: body.requestId,
        uid: identity.uid,
        userId: profile.username,
        username: profile.username,
        email: profile.email,
        amount: body.amountCents / 100,
        amountCents: body.amountCents,
        asset,
        network,
        networkName: networkDetails.name,
        walletAddress: wallet.address,
        cloudinaryUrl: receipt?.cloudinaryUrl || null,
        receipt: receipt || null,
        status: "pending",
        reviewMessage: "",
        createdAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
      });
      transaction.create(requestKeyRef, {
        receiptId: newReceiptRef.id,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(notification, {
        title: "Deposit request under review",
        message: "Your deposit request is under review. Your USD balance will be updated once it is approved.",
        kind: "deposit",
        metadata: { receiptId: newReceiptRef.id },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const adminNotification of adminNotifications) {
        transaction.create(adminNotification.ref, {
          title: "New deposit request",
          message: `${adminNotification.username} submitted a deposit request.`,
          kind: "receipt",
          metadata: { uid: identity.uid, receiptId: newReceiptRef.id },
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      created = true;
    });
    const submitted = await receiptCollection.doc(receiptId).get();
    return send(created ? 201 : 200, { receiptId, status: submitted.data()?.status || "pending" });
  }
  if (pathname === "/api/profits/start" && method === "POST") {
    const { identity, profile } = await authenticate(request);
    checkRateLimit(`profit-cycle:${identity.uid}`, 5, 24 * 60 * 60 * 1000);
    const body = await readJson(request);
    if (!validateAmount(body.amountCents)) fail(400, "Choose a valid amount to grow.");
    if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) fail(400, "Invalid profit cycle request ID.");
    const cycleCollection = db.collection("profitCycles");
    const newCycleRef = cycleCollection.doc();
    const requestKeyRef = userRef(identity.uid).collection("profitCycleStartKeys").doc(body.requestId);
    const userNotification = notificationRef(identity.uid);
    let cycleId = "";
    let created = false;
    await db.runTransaction(async (transaction) => {
      created = false;
      const [profileSnapshot, requestKey] = await Promise.all([
        transaction.get(userRef(identity.uid)),
        transaction.get(requestKeyRef),
      ]);
      const user = profileSnapshot.data();
      if (!profileSnapshot.exists || user?.isBanned === true) fail(403, "This account cannot start a profit cycle.");
      if (requestKey.exists) {
        cycleId = requestKey.data()?.cycleId;
        const existingCycleRef = cycleId ? cycleCollection.doc(cycleId) : null;
        const existingCycle = existingCycleRef ? await transaction.get(existingCycleRef) : null;
        if (!existingCycle?.exists || existingCycle.data()?.principalCents !== body.amountCents) {
          fail(409, "This cycle request ID has already been used.");
        }
        return;
      }
      if (typeof user.activeProfitCycleId === "string" && user.activeProfitCycleId) {
        fail(409, "Complete your current five-day profit cycle before starting another.");
      }
      const balanceCents = Number.isSafeInteger(user.balanceCents) && user.balanceCents >= 0
        ? user.balanceCents
        : 0;
      if (balanceCents < body.amountCents) fail(409, "Your available balance is too low for this amount.");
      cycleId = newCycleRef.id;
      const now = Date.now();
      transaction.update(userRef(identity.uid), {
        balanceCents: balanceCents - body.amountCents,
        activeProfitCycleId: cycleId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(newCycleRef, {
        uid: identity.uid,
        userId: profile.username,
        principalCents: body.amountCents,
        currentAmountCents: body.amountCents,
        dailyOpeningCents: body.amountCents,
        dailyEarnedCents: 0,
        totalProfitCents: 0,
        totalFeeCents: 0,
        dayNumber: 1,
        hourInDay: 0,
        startedAtMs: now,
        lastAccruedAtMs: now,
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        completedAt: null,
      });
      transaction.create(requestKeyRef, {
        cycleId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(userNotification, {
        title: "Five-day profit cycle started",
        message: "Your five-day cycle has started. Hourly earnings are calculated from a 5.3% daily rate; a 1% fee is deducted from the post-growth amount at the end of each day.",
        kind: "profit",
        metadata: { cycleId, status: "active" },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      created = true;
    });
    const cycle = await cycleCollection.doc(cycleId).get();
    return send(created ? 201 : 200, { cycleId, status: cycle.data()?.status || "active" });
  }
  if (pathname === "/api/withdrawals" && method === "POST") {
    const { identity, profile } = await authenticate(request);
    checkRateLimit(`withdrawal:${identity.uid}`, 5, 60 * 60 * 1000);
    const body = await readJson(request);
    const asset = typeof body.asset === "string" ? body.asset.toUpperCase() : "";
    const network = typeof body.network === "string" ? body.network.toUpperCase() : "";
    const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.trim() : "";
    if (!getNetwork(asset, network)) fail(400, "Select a supported cryptocurrency and network.");
    if (!validateAmount(body.amountCents) || body.amountCents < 2_000) fail(400, "The minimum withdrawal is $20.00.");
    if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) fail(400, "Invalid withdrawal request ID.");
    if (walletAddress.length < 20 || walletAddress.length > 200 || /\s/.test(walletAddress)) {
      fail(400, "Enter a valid wallet address without spaces.");
    }

    const withdrawalCollection = db.collection("withdrawals");
    const newWithdrawalRef = withdrawalCollection.doc();
    const requestKeyRef = userRef(identity.uid).collection("withdrawalRequestKeys").doc(body.requestId);
    const adminUsers = await db.collection("users").where("role", "==", "admin").limit(100).get();
    const adminNotifications = adminUsers.docs
      .filter((admin) => admin.data().isBanned !== true)
      .map((admin) => notificationRef(admin.id));
    const userNotification = notificationRef(identity.uid);
    let withdrawalId = "";
    let created = false;
    await db.runTransaction(async (transaction) => {
      created = false;
      const [profileSnapshot, requestKey] = await Promise.all([
        transaction.get(userRef(identity.uid)),
        transaction.get(requestKeyRef),
      ]);
      const user = profileSnapshot.data();
      if (!profileSnapshot.exists || user?.isBanned === true) fail(403, "This account cannot request a withdrawal.");
      if (typeof user.activeProfitCycleId === "string" && user.activeProfitCycleId) {
        fail(409, "Withdrawals are available after your active five-day profit cycle is complete.");
      }
      if (requestKey.exists) {
        withdrawalId = requestKey.data()?.withdrawalId;
        const existingRef = withdrawalId ? withdrawalCollection.doc(withdrawalId) : null;
        const existingSnapshot = existingRef ? await transaction.get(existingRef) : null;
        if (!existingSnapshot?.exists) fail(409, "This withdrawal request could not be verified. Please contact support.");
        const existing = existingSnapshot.data();
        if (
          existing.uid !== identity.uid
          || existing.amountCents !== body.amountCents
          || existing.asset !== asset
          || existing.network !== network
          || existing.walletAddress !== walletAddress
        ) fail(409, "This request ID has already been used for a different withdrawal.");
        return;
      }

      const balanceCents = Number.isSafeInteger(user.balanceCents) && user.balanceCents >= 0
        ? user.balanceCents
        : 0;
      if (balanceCents < body.amountCents) fail(409, "Your available balance is too low.");
      withdrawalId = newWithdrawalRef.id;
      transaction.update(userRef(identity.uid), {
        balanceCents: balanceCents - body.amountCents,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(newWithdrawalRef, {
        requestId: body.requestId,
        uid: identity.uid,
        userId: profile.username,
        username: profile.username,
        email: profile.email,
        amount: body.amountCents / 100,
        amountCents: body.amountCents,
        asset,
        network,
        networkName: getNetwork(asset, network).name,
        walletAddress,
        status: "pending",
        transactionHash: null,
        paidCryptoAmount: null,
        reviewMessage: "",
        createdAt: FieldValue.serverTimestamp(),
        reviewedAt: null,
        reviewedBy: null,
      });
      transaction.create(requestKeyRef, {
        withdrawalId,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(userNotification, {
        title: "Withdrawal request submitted",
        message: `Your $${(body.amountCents / 100).toFixed(2)} USD withdrawal request in ${asset} on ${getNetwork(asset, network).name} is under review. The reserved amount will be returned if the request is rejected.`,
        kind: "withdrawal",
        metadata: { withdrawalId, status: "pending" },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const adminNotification of adminNotifications) {
        transaction.create(adminNotification, {
          title: "New withdrawal request",
          message: `${profile.username || profile.email} requested $${(body.amountCents / 100).toFixed(2)} USD in ${asset} on ${getNetwork(asset, network).name}.`,
          kind: "withdrawal",
          metadata: { uid: identity.uid, withdrawalId },
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      created = true;
    });
    const withdrawal = await withdrawalCollection.doc(withdrawalId).get();
    return send(created ? 201 : 200, { withdrawalId, status: withdrawal.data()?.status || "pending" });
  }
  if (pathname === "/api/admin/withdrawals" && method === "GET") {
    await authenticate(request, { adminOnly: true });
    const result = await db.collection("withdrawals").where("status", "==", "pending").limit(100).get();
    const withdrawals = result.docs.map((snapshot) => ({
      id: snapshot.id,
      ...snapshot.data(),
    })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    return send(200, { withdrawals });
  }
  const withdrawalReviewMatch = pathname.match(/^\/api\/admin\/withdrawals\/([^/]+)\/(complete|reject)$/);
  if (withdrawalReviewMatch && method === "POST") {
    const { identity } = await authenticate(request, { adminOnly: true });
    const body = await readJson(request);
    const withdrawalRef = db.collection("withdrawals").doc(withdrawalReviewMatch[1]);
    let uid = "";
    let status = "rejected";
    await db.runTransaction(async (transaction) => {
      const withdrawalSnapshot = await transaction.get(withdrawalRef);
      const withdrawal = withdrawalSnapshot.data();
      if (!withdrawalSnapshot.exists || typeof withdrawal.uid !== "string") fail(404, "Withdrawal request not found.");
      if (withdrawal.status !== "pending") fail(409, "This withdrawal request has already been reviewed.");
      uid = withdrawal.uid;
      const profileRef = userRef(uid);
      const profileSnapshot = await transaction.get(profileRef);
      const profile = profileSnapshot.data();
      if (!profileSnapshot.exists) fail(404, "Member account not found.");

      if (withdrawalReviewMatch[2] === "complete") {
        const paidCryptoAmount = typeof body.paidCryptoAmount === "string"
          ? body.paidCryptoAmount.trim()
          : "";
        const transactionHash = typeof body.transactionHash === "string"
          ? body.transactionHash.trim()
          : "";
        if (
          paidCryptoAmount.length > 80
          || !/^\d+(?:\.\d{1,18})?$/.test(paidCryptoAmount)
          || !Number.isFinite(Number(paidCryptoAmount))
          || Number(paidCryptoAmount) <= 0
        ) {
          fail(400, "Enter the actual crypto amount sent.");
        }
        if (transactionHash.length < 8 || transactionHash.length > 200) {
          fail(400, "Enter the transaction ID or hash for the completed payment.");
        }
        status = "completed";
        transaction.update(withdrawalRef, {
          status,
          paidCryptoAmount,
          transactionHash,
          reviewMessage: "The administrator confirmed the external crypto payment was sent.",
          reviewedBy: identity.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(notificationRef(uid), {
          title: "Withdrawal sent",
          message: `Your $${(withdrawal.amountCents / 100).toFixed(2)} USD withdrawal request was reviewed and paid in ${withdrawal.asset} on ${withdrawal.networkName}. The recorded payout was ${paidCryptoAmount} ${withdrawal.asset}. Transaction ID: ${transactionHash}.`,
          kind: "withdrawal",
          metadata: { withdrawalId: withdrawalSnapshot.id, status, transactionHash },
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        const balanceCents = Number.isSafeInteger(profile.balanceCents) && profile.balanceCents >= 0
          ? profile.balanceCents
          : 0;
        const refundedBalance = balanceCents + withdrawal.amountCents;
        if (!Number.isSafeInteger(withdrawal.amountCents) || withdrawal.amountCents <= 0 || !Number.isSafeInteger(refundedBalance)) {
          fail(409, "The reserved withdrawal amount cannot be safely returned. Please investigate this request.");
        }
        const reviewMessage = "The withdrawal was not sent due to a network issue. The reserved amount has been returned to your USD balance. Please review your address and network before submitting another request.";
        transaction.update(profileRef, { balanceCents: refundedBalance, updatedAt: FieldValue.serverTimestamp() });
        transaction.update(withdrawalRef, {
          status,
          reviewMessage,
          reviewedBy: identity.uid,
          reviewedAt: FieldValue.serverTimestamp(),
        });
        transaction.create(notificationRef(uid), {
          title: "Withdrawal request rejected",
          message: `${reviewMessage} Request: ${withdrawal.asset} on ${withdrawal.networkName}, ${withdrawal.walletAddress}.`,
          kind: "withdrawal",
          metadata: { withdrawalId: withdrawalSnapshot.id, status },
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return send(200, { status, uid });
  }
  if (pathname === "/api/admin/receipts" && method === "GET") {
    await authenticate(request, { adminOnly: true });
    await migrateLegacyReceipts();
    const result = await db.collection("receipts").where("status", "==", "pending").limit(100).get();
    const receipts = result.docs.map((snapshot) => ({
      id: snapshot.id,
      ...snapshot.data(),
      uid: snapshot.data().uid,
    })).sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    return send(200, { receipts });
  }
  const receiptImageMatch = pathname.match(/^\/api\/admin\/receipts\/([^/]+)\/image$/);
  if (receiptImageMatch && method === "GET") {
    await authenticate(request, { adminOnly: true });
    cloudinaryReady();
    const uid = url.searchParams.get("uid") || "";
    const snapshot = await db.collection("receipts").doc(receiptImageMatch[1]).get();
    const receipt = snapshot.data();
    if (receipt?.uid !== uid) fail(404, "Deposit request not found.");
    if (!receipt?.receipt?.publicId) fail(404, "No receipt image was attached.");
    const imageUrl = cloudinary.utils.private_download_url(
      receipt.receipt.publicId,
      receipt.receipt.format,
      { resource_type: "image", type: "authenticated", expires_at: Math.floor(Date.now() / 1000) + 300, attachment: false },
    );
    return send(200, { url: imageUrl });
  }
  const reviewMatch = pathname.match(/^\/api\/admin\/receipts\/([^/]+)\/(approve|reject)$/);
  if (reviewMatch && method === "POST") {
    const { identity } = await authenticate(request, { adminOnly: true });
    const body = await readJson(request);
    const uid = typeof body.uid === "string" ? body.uid : "";
    const receiptRef = db.collection("receipts").doc(reviewMatch[1]);
    const profileRef = userRef(uid);
    const notification = notificationRef(uid);
    let creditedBalanceCents = 0;
    let firstDepositBonusCents = 0;
    let firstDepositBonusReceiptId = null;
    const status = reviewMatch[2] === "approve" ? "approved" : "rejected";
    let notificationMessage = (typeof body.message === "string" ? body.message.trim().slice(0, 300) : "")
      || "Your deposit request was not approved. Please contact customer support.";

    await db.runTransaction(async (transaction) => {
      const [receiptSnapshot, profileSnapshot] = await Promise.all([
        transaction.get(receiptRef),
        transaction.get(profileRef),
      ]);
      const receipt = receiptSnapshot.data();
      const profile = profileSnapshot.data();
      if (!receiptSnapshot.exists || !profileSnapshot.exists) fail(404, "Deposit request not found.");
      if (receipt.uid !== uid) fail(404, "Deposit request not found.");
      const legacyReceiptRef = typeof receipt.legacySourceId === "string"
        ? userRef(uid).collection("receipts").doc(receipt.legacySourceId)
        : null;
      const legacyReceiptSnapshot = legacyReceiptRef
        ? await transaction.get(legacyReceiptRef)
        : null;
      if (receipt.status !== "pending") fail(409, "This deposit request has already been reviewed.");
      if (status === "approved") {
        if (profile.isBanned === true) fail(409, "A banned account cannot receive a deposit.");
        if (!validateAmount(receipt.amountCents)) fail(409, "The deposit amount is invalid.");
        const approvedReceipts = profile.firstDepositBonusClaimed === true
          ? null
          : await transaction.get(db.collection("receipts").where("uid", "==", uid));
        const approvedLegacyReceipts = profile.firstDepositBonusClaimed === true
          ? null
          : await transaction.get(userRef(uid).collection("receipts").where("status", "==", "approved"));
        const previousApprovedReceipt = approvedReceipts?.docs.find((item) =>
          item.id !== receiptSnapshot.id && item.data().status === "approved");
        const hasPriorDeposit = Boolean(previousApprovedReceipt || approvedLegacyReceipts?.size);
        firstDepositBonusCents = profile.firstDepositBonusClaimed === true || hasPriorDeposit
          ? 0
          : Math.round(receipt.amountCents * 0.2);
        firstDepositBonusReceiptId = profile.firstDepositBonusClaimed === true
          ? profile.firstDepositBonusReceiptId || null
          : hasPriorDeposit
            ? previousApprovedReceipt?.id || null
            : receiptSnapshot.id;
        const currentBalance = Number.isSafeInteger(profile.balanceCents) && profile.balanceCents >= 0
          ? profile.balanceCents
          : 0;
        creditedBalanceCents = currentBalance + receipt.amountCents + firstDepositBonusCents;
        if (!Number.isSafeInteger(creditedBalanceCents)) fail(409, "The balance would exceed the supported limit.");
        const bonusMessage = firstDepositBonusCents > 0
          ? ` Your first-deposit gift bonus of $${(firstDepositBonusCents / 100).toFixed(2)} USD (20%) was added too.`
          : "";
        notificationMessage = `$${(receipt.amountCents / 100).toFixed(2)} USD deposit approved.${bonusMessage} A total of $${((receipt.amountCents + firstDepositBonusCents) / 100).toFixed(2)} USD was credited to your Triplex balance. Visit Profit progress to choose an amount and start your five-day profit cycle.`;
        transaction.update(profileRef, {
          balanceCents: creditedBalanceCents,
          firstDepositBonusClaimed: true,
          firstDepositBonusReceiptId,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      transaction.update(receiptRef, {
        status,
        reviewMessage: notificationMessage,
        reviewedBy: identity.uid,
        reviewedAt: FieldValue.serverTimestamp(),
        ...(status === "approved" ? {
          firstDepositBonusCents,
          firstDepositBonusApplied: firstDepositBonusCents > 0,
        } : {}),
      });
      if (legacyReceiptRef && legacyReceiptSnapshot?.exists) {
        transaction.update(legacyReceiptRef, {
          status,
          reviewMessage: notificationMessage,
          reviewedBy: identity.uid,
          reviewedAt: FieldValue.serverTimestamp(),
          ...(status === "approved" ? {
            firstDepositBonusCents,
            firstDepositBonusApplied: firstDepositBonusCents > 0,
          } : {}),
        });
      }
      transaction.create(notification, {
        title: status === "approved" ? "Deposit successful" : "Deposit request update",
        message: notificationMessage,
        kind: "deposit",
        metadata: { receiptId: receiptSnapshot.id, status },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return send(200, {
      status,
      balanceCents: creditedBalanceCents,
      firstDepositBonusCents,
    });
  }
  if (pathname === "/api/admin/members" && method === "GET") {
    await authenticate(request, { adminOnly: true });
    const result = await db.collection("users").orderBy("createdAt", "desc").limit(500).get();
    return send(200, {
      members: result.docs.map((snapshot) => ({
        uid: snapshot.id,
        username: snapshot.data().username || "",
        email: snapshot.data().email || "",
        role: snapshot.data().role === "admin" ? "admin" : "user",
        isBanned: snapshot.data().isBanned === true,
      })),
    });
  }
  const banMatch = pathname.match(/^\/api\/admin\/members\/([^/]+)\/ban$/);
  if (banMatch && method === "POST") {
    const { identity } = await authenticate(request, { adminOnly: true });
    const uid = banMatch[1];
    if (uid === identity.uid) fail(400, "You cannot ban your own account.");
    const body = await readJson(request);
    if (typeof body.isBanned !== "boolean") fail(400, "A ban status is required.");
    const memberRef = userRef(uid);
    const notification = notificationRef(uid);
    let username = "";
    await db.runTransaction(async (transaction) => {
      const member = await transaction.get(memberRef);
      if (!member.exists) fail(404, "Member not found.");
      if (member.data().role === "admin") fail(403, "Administrator accounts cannot be banned here.");
      username = member.data().username || "";
      transaction.update(memberRef, {
        isBanned: body.isBanned,
        bannedAt: body.isBanned ? FieldValue.serverTimestamp() : null,
        bannedBy: body.isBanned ? identity.uid : null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (body.isBanned) {
        transaction.create(notification, {
          title: "Account access restricted",
          message: "Your account has been permanently banned for a possible fraudulent payment or violation of Triplex rules. Contact support if you believe this is a mistake.",
          kind: "account",
          metadata: { isBanned: true },
          readAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    });
    return send(200, { uid, username, isBanned: body.isBanned });
  }
  if (pathname === "/api/transfers" && method === "POST") {
    const { identity, profile: senderProfile } = await authenticate(request);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    if (!validateUsername(username)) fail(400, "Enter a valid recipient username.");
    if (!validateAmount(body.amountCents)) fail(400, "Enter a valid transfer amount.");
    if (typeof body.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)) fail(400, "Invalid transfer request ID.");
    const recipientIndex = db.collection("usernames").doc(username);
    const legacyIndex = db.collection("usernameClaims").doc(username);
    const [index, legacy] = await Promise.all([recipientIndex.get(), legacyIndex.get()]);
    const recipientUid = index.data()?.uid || legacy.data()?.uid;
    if (!recipientUid || recipientUid === identity.uid) fail(404, "Choose a different registered recipient.");
    const senderRef = userRef(identity.uid);
    const recipientRef = userRef(recipientUid);
    const sentTransferRef = senderRef.collection("transfers").doc(body.requestId);
    const receivedTransferRef = recipientRef.collection("transfers").doc(body.requestId);
    const senderNotification = notificationRef(identity.uid);
    const recipientNotification = notificationRef(recipientUid);
    await db.runTransaction(async (transaction) => {
      const [senderSnapshot, recipientSnapshot, existingTransfer] = await Promise.all([
        transaction.get(senderRef),
        transaction.get(recipientRef),
        transaction.get(sentTransferRef),
      ]);
      if (existingTransfer.exists) {
        const existing = existingTransfer.data();
        if (existing.amountCents !== body.amountCents || existing.counterpartyUid !== recipientUid) {
          fail(409, "This request ID has already been used for a different transfer.");
        }
        return;
      }
      const sender = senderSnapshot.data();
      const recipient = recipientSnapshot.data();
      if (!senderSnapshot.exists || !recipientSnapshot.exists) fail(404, "An account could not be found.");
      if (sender.isBanned || recipient.isBanned) fail(403, "A banned account cannot send or receive transfers.");
      if (typeof sender.activeProfitCycleId === "string" && sender.activeProfitCycleId) {
        fail(409, "Transfers are paused while your five-day profit cycle is active.");
      }
      const senderBalance = Number.isSafeInteger(sender.balanceCents) && sender.balanceCents >= 0 ? sender.balanceCents : 0;
      if (senderBalance < body.amountCents) fail(409, "Your available balance is too low.");
      const recipientBalance = (Number.isSafeInteger(recipient.balanceCents) && recipient.balanceCents >= 0 ? recipient.balanceCents : 0) + body.amountCents;
      if (!Number.isSafeInteger(recipientBalance)) fail(409, "The recipient balance would exceed the supported limit.");
      transaction.update(senderRef, { balanceCents: senderBalance - body.amountCents, updatedAt: FieldValue.serverTimestamp() });
      transaction.update(recipientRef, { balanceCents: recipientBalance, updatedAt: FieldValue.serverTimestamp() });
      transaction.create(sentTransferRef, {
        type: "sent",
        amountCents: body.amountCents,
        counterpartyUid: recipientUid,
        counterpartyUsername: recipient.username || username,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(receivedTransferRef, {
        type: "received",
        amountCents: body.amountCents,
        counterpartyUid: identity.uid,
        counterpartyUsername: sender.username || senderProfile.username,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(senderNotification, {
        title: "Transfer sent",
        message: `Your transfer to ${recipient.username || username} was completed.`,
        kind: "transfer",
        metadata: { amountCents: body.amountCents, recipientUid },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.create(recipientNotification, {
        title: "Transfer received",
        message: `You received a transfer from ${sender.username || senderProfile.username}.`,
        kind: "transfer",
        metadata: { amountCents: body.amountCents, senderUid: identity.uid },
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });
    return send(200, { status: "completed" });
  }

  return send(404, { error: "API route not found." });
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

async function serveStatic(request, response, url) {
  if (!existsSync(distRoot)) fail(503, "The production site has not been built.");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    fail(400, "Invalid URL path.");
  }
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(distRoot, `.${pathname}`);
  if (!filePath.startsWith(`${distRoot}${path.sep}`) && filePath !== distRoot) fail(400, "Invalid URL path.");
  if (!existsSync(filePath)) fail(404, "Page not found.");
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  if (request.method === "HEAD") return response.end();
  createReadStream(filePath).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const corsHeaders = validateOrigin(request);
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      });
      return response.end();
    }
    if (url.pathname.startsWith("/api/")) return await routeApi(request, response, url, corsHeaders);
    if (request.method !== "GET" && request.method !== "HEAD") fail(405, "Method not allowed.");
    return await serveStatic(request, response, url);
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error("Request failed:", error);
    sendJson(response, status, { error: status >= 500 ? "The request could not be completed." : error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Triplex server listening on port ${port}`);
  void processDueProfitCycles();
  const profitCycleTimer = setInterval(() => void processDueProfitCycles(), 60_000);
  profitCycleTimer.unref();
});

server.on("error", (error) => {
  console.error("Triplex server failed to start:", error);
  process.exitCode = 1;
});
