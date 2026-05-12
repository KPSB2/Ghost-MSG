/**
 * GHOST_MSG — Firebase Cloud Functions
 * Handles: secure wallet transfers, timed message cleanup,
 * spam/rate limiting, audit logging, report processing,
 * and notification dispatch.
 *
 * Deploy: firebase deploy --only functions
 * Node runtime: 18 (set in package.json)
 */

"use strict";

const functions  = require("firebase-functions");
const admin      = require("firebase-admin");

admin.initializeApp();
const db = admin.database();

// ─── CONSTANTS ────────────────────────────────────────────────
const MAX_MSG_LEN      = 2000;
const MAX_BIO_LEN      = 100;
const MAX_TRANSFER     = 500_000;
const MIN_TRANSFER     = 0.01;
const MAX_WALLET_BAL   = 100_000_000;
const RATE_WINDOW_MS   = 5_000;   // sliding window
const RATE_MAX_MSG     = 5;        // messages per window
const RATE_MAX_AUTH    = 5;        // auth attempts per window
const CLEANUP_INTERVAL = 60;       // seconds between cleanup runs
const REPORT_COOLDOWN  = 60_000;   // 1 min between same-target reports

// ─── HELPERS ──────────────────────────────────────────────────
function ts() { return Date.now(); }

function sanitizeText(str, maxLen = MAX_MSG_LEN) {
  if (typeof str !== "string") return "";
  // strip null bytes and common injection characters
  return str.replace(/\0/g, "").replace(/[<>]/g, "").slice(0, maxLen).trim();
}

function genTxId() {
  return "TX" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 5).toUpperCase();
}

async function auditLog(event, data) {
  try {
    await db.ref("audit").push({
      event,
      ...data,
      ts: ts(),
    });
  } catch (e) {
    console.error("[AUDIT] Failed to write log:", e.message);
  }
}

// ─── RATE LIMITER (per-uid, Redis-free, DB-backed) ────────────
async function checkRateLimit(uid, bucket, maxHits, windowMs) {
  const ref  = db.ref(`_ratelimits/${uid}/${bucket}`);
  const snap = await ref.get();
  const now  = ts();

  let { hits = [], blocked_until = 0 } = snap.exists() ? snap.val() : {};

  if (now < blocked_until) {
    return { ok: false, retryAfter: Math.ceil((blocked_until - now) / 1000) };
  }

  // evict old hits outside the window
  hits = hits.filter(h => now - h < windowMs);

  if (hits.length >= maxHits) {
    const blockFor = windowMs * 2;
    await ref.set({ hits, blocked_until: now + blockFor });
    await auditLog("RATE_LIMIT_HIT", { uid, bucket });
    return { ok: false, retryAfter: Math.ceil(blockFor / 1000) };
  }

  hits.push(now);
  await ref.set({ hits, blocked_until: 0 });
  return { ok: true };
}

// ─── SECURE WALLET TRANSFER ───────────────────────────────────
// Called from the client instead of writing directly to DB.
// Performs atomic balance check + debit/credit + audit log.
exports.secureTransfer = functions.https.onCall(async (data, ctx) => {
  if (!ctx.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const senderUid   = ctx.auth.uid;
  const { toUsername, amount, note } = data;

  // Input validation
  if (!toUsername || typeof toUsername !== "string") {
    throw new functions.https.HttpsError("invalid-argument", "Invalid recipient.");
  }
  const sanitizedNote = sanitizeText(note || "", 200);
  const amt           = Math.round(parseFloat(amount) * 100) / 100;

  if (isNaN(amt) || amt < MIN_TRANSFER) {
    throw new functions.https.HttpsError("invalid-argument", `Minimum transfer is ${MIN_TRANSFER} GHO.`);
  }
  if (amt > MAX_TRANSFER) {
    throw new functions.https.HttpsError("invalid-argument", `Maximum transfer is ${MAX_TRANSFER} GHO.`);
  }

  // Rate limit: max 10 transfers per minute
  const rl = await checkRateLimit(senderUid, "transfer", 10, 60_000);
  if (!rl.ok) {
    throw new functions.https.HttpsError("resource-exhausted", `Rate limited. Retry in ${rl.retryAfter}s.`);
  }

  // Resolve recipient UID
  const recipientUidSnap = await db.ref(`usernames/${toUsername.toLowerCase()}`).get();
  if (!recipientUidSnap.exists()) {
    throw new functions.https.HttpsError("not-found", "Recipient not found.");
  }
  const recipientUid = recipientUidSnap.val();

  if (recipientUid === senderUid) {
    throw new functions.https.HttpsError("invalid-argument", "Cannot transfer to yourself.");
  }

  // Atomic transaction
  const senderRef    = db.ref(`wallets/${senderUid}/balance`);
  const recipientRef = db.ref(`wallets/${recipientUid}/balance`);

  let txId;
  try {
    const sResult = await senderRef.transaction(currentBal => {
      if (currentBal === null) return null; // abort
      if (currentBal < amt) return; // abort (undefined = abort in Firebase)
      return Math.round((currentBal - amt) * 100) / 100;
    });

    if (!sResult.committed) {
      throw new functions.https.HttpsError("failed-precondition", "Insufficient balance or wallet not found.");
    }

    await recipientRef.transaction(currentBal => {
      const bal = typeof currentBal === "number" ? currentBal : 0;
      const newBal = Math.round((bal + amt) * 100) / 100;
      if (newBal > MAX_WALLET_BAL) return; // reject runaway balances
      return newBal;
    });

    txId = genTxId();
    const now = ts();

    // Write tx records
    await db.ref(`txs/${senderUid}`).push({ id: txId, type: "out", with: toUsername, amount: amt, note: sanitizedNote, ts: now });
    await db.ref(`txs/${recipientUid}`).push({ id: txId, type: "in",  with: ctx.auth.token.firebase?.identities?.["email"]?.[0]?.replace("@ghost-msg.local","") || senderUid, amount: amt, note: sanitizedNote, ts: now });

    await auditLog("TRANSFER", { from: senderUid, to: recipientUid, amount: amt, txId });

  } catch (e) {
    if (e instanceof functions.https.HttpsError) throw e;
    console.error("[TRANSFER] Error:", e);
    throw new functions.https.HttpsError("internal", "Transfer failed. Please try again.");
  }

  return { success: true, txId };
});

// ─── TIMED MESSAGE CLEANUP ────────────────────────────────────
// Runs every minute. Deletes messages whose expireAt <= now.
exports.cleanupTimedMessages = functions.pubsub
  .schedule(`every ${CLEANUP_INTERVAL} seconds`)
  .onRun(async () => {
    const now      = ts();
    const paths    = ["dms", "groups", "pubrooms"];
    let   deleted  = 0;

    for (const base of paths) {
      const snap = await db.ref(base).get();
      if (!snap.exists()) continue;

      const rooms = snap.val();
      for (const [roomId, roomData] of Object.entries(rooms)) {
        const messages = roomData?.messages;
        if (!messages) continue;

        for (const [msgId, msg] of Object.entries(messages)) {
          if (msg?.expireAt && msg.expireAt <= now) {
            await db.ref(`${base}/${roomId}/messages/${msgId}`).remove();
            deleted++;
          }
        }
      }
    }

    console.log(`[CLEANUP] Removed ${deleted} expired messages.`);
    return null;
  });

// ─── SPAM DETECTION ───────────────────────────────────────────
// Fires on every new message in DMs and groups.
// Blocks users sending identical text rapidly.
exports.spamDetect = functions.database
  .ref("{base}/{roomId}/messages/{msgId}")
  .onCreate(async (snap, ctx) => {
    const { base, roomId, msgId } = ctx.params;
    if (!["dms", "groups", "pubrooms"].includes(base)) return null;

    const msg = snap.val();
    if (!msg || !msg.from || msg.type === "sys" || msg.type === "pay") return null;

    const uid = msg.from;

    // Rate limit via DB (5 msgs per 5 seconds per uid)
    const rl = await checkRateLimit(uid, "msg", RATE_MAX_MSG, RATE_WINDOW_MS);
    if (!rl.ok) {
      // delete the spam message and log
      await snap.ref.remove();
      await auditLog("SPAM_MESSAGE_DELETED", { uid, roomId, base, msgId });
      console.warn(`[SPAM] Removed message from ${uid} — rate limit exceeded.`);
      return null;
    }

    // Duplicate content spam check (same text 3 times in 10s)
    const recentSnap = await db.ref(`${base}/${roomId}/messages`)
      .orderByChild("ts")
      .startAt(ts() - 10_000)
      .get();

    if (recentSnap.exists()) {
      const recent = Object.values(recentSnap.val()).filter(m => m.from === uid && m.text);
      const dupes  = recent.filter(m => m.text === msg.text);
      if (dupes.length >= 3) {
        await snap.ref.remove();
        await auditLog("SPAM_DUPLICATE_DELETED", { uid, roomId, base });
        console.warn(`[SPAM] Duplicate spam from ${uid} removed.`);
      }
    }

    return null;
  });

// ─── MESSAGE SANITIZATION ─────────────────────────────────────
// Sanitizes text in all new messages (strips XSS-like payloads).
exports.sanitizeMessage = functions.database
  .ref("{base}/{roomId}/messages/{msgId}")
  .onCreate(async (snap, ctx) => {
    const { base } = ctx.params;
    if (!["dms", "groups", "pubrooms"].includes(base)) return null;

    const msg = snap.val();
    if (!msg || msg.type === "sys" || msg.type === "pay") return null;
    if (typeof msg.text !== "string") return null;

    const clean = sanitizeText(msg.text, MAX_MSG_LEN);
    if (clean !== msg.text) {
      await snap.ref.update({ text: clean });
    }
    return null;
  });

// ─── REPORT SYSTEM ────────────────────────────────────────────
exports.reportUser = functions.https.onCall(async (data, ctx) => {
  if (!ctx.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const reporterUid = ctx.auth.uid;
  const { targetUsername, reason, context } = data;

  if (!targetUsername || !reason) {
    throw new functions.https.HttpsError("invalid-argument", "Target and reason required.");
  }

  // Rate limit: 3 reports per minute
  const rl = await checkRateLimit(reporterUid, "report", 3, 60_000);
  if (!rl.ok) {
    throw new functions.https.HttpsError("resource-exhausted", `Too many reports. Retry in ${rl.retryAfter}s.`);
  }

  // Prevent duplicate reports against same target in 1 minute
  const recentSnap = await db.ref("reports")
    .orderByChild("ts")
    .startAt(ts() - REPORT_COOLDOWN)
    .get();

  if (recentSnap.exists()) {
    const recent = Object.values(recentSnap.val());
    const dup    = recent.find(r => r.reporter === reporterUid && r.target === targetUsername);
    if (dup) throw new functions.https.HttpsError("already-exists", "Already reported this user recently.");
  }

  const repId = await db.ref("reports").push({
    reporter: reporterUid,
    target:   targetUsername,
    reason:   sanitizeText(reason, 500),
    context:  sanitizeText(context || "", 200),
    ts:       ts(),
    status:   "pending",
  });

  await auditLog("USER_REPORTED", { reporter: reporterUid, target: targetUsername, repId: repId.key });
  return { success: true };
});

// ─── ACCOUNT DELETION ─────────────────────────────────────────
exports.deleteAccount = functions.https.onCall(async (data, ctx) => {
  if (!ctx.auth) throw new functions.https.HttpsError("unauthenticated", "Login required.");

  const uid      = ctx.auth.uid;
  const username = data?.username;

  if (!username) throw new functions.https.HttpsError("invalid-argument", "Username required.");

  // Remove all user data
  await Promise.all([
    db.ref(`users/${uid}`).remove(),
    db.ref(`wallets/${uid}`).remove(),
    db.ref(`txs/${uid}`).remove(),
    db.ref(`presence/${uid}`).remove(),
    db.ref(`usernames/${username}`).remove(),
    db.ref(`_ratelimits/${uid}`).remove(),
  ]);

  // Remove from group memberships
  const groupsSnap = await db.ref("groups").get();
  if (groupsSnap.exists()) {
    const groups = groupsSnap.val();
    for (const [gId, g] of Object.entries(groups)) {
      if (g?.members?.[username]) {
        await db.ref(`groups/${gId}/members/${username}`).remove();
      }
    }
  }

  // Delete Firebase Auth account
  await admin.auth().deleteUser(uid);
  await auditLog("ACCOUNT_DELETED", { uid, username });

  return { success: true };
});

// ─── PRESENCE CLEANUP (disconnect handler) ─────────────────────
// Sets presence to offline when a user disconnects.
// Client should call this to register the onDisconnect handler.
exports.setPresenceOfflineOnDisconnect = functions.https.onCall(async (data, ctx) => {
  if (!ctx.auth) return;
  const uid = ctx.auth.uid;
  await db.ref(`presence/${uid}`).onDisconnect().update({ online: false, last: admin.database.ServerValue.TIMESTAMP });
  return { success: true };
});

// ─── CLEANUP RATE LIMIT RECORDS ───────────────────────────────
// Runs hourly to remove stale rate limit records.
exports.cleanupRateLimits = functions.pubsub
  .schedule("every 60 minutes")
  .onRun(async () => {
    const snap = await db.ref("_ratelimits").get();
    if (!snap.exists()) return null;

    const data    = snap.val();
    const now     = ts();
    let   removed = 0;

    for (const [uid, buckets] of Object.entries(data)) {
      for (const [bucket, val] of Object.entries(buckets || {})) {
        const hits         = (val?.hits || []).filter(h => now - h < 3_600_000);
        const blockedUntil = val?.blocked_until || 0;
        if (hits.length === 0 && now > blockedUntil) {
          await db.ref(`_ratelimits/${uid}/${bucket}`).remove();
          removed++;
        }
      }
    }

    console.log(`[CLEANUP] Removed ${removed} stale rate-limit records.`);
    return null;
  });

// ─── AUDIT LOG TRIM ───────────────────────────────────────────
// Keeps only the latest 10,000 audit entries to control storage.
exports.trimAuditLog = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async () => {
    const snap = await db.ref("audit").orderByChild("ts").get();
    if (!snap.exists()) return null;

    const entries = Object.keys(snap.val());
    const excess  = entries.length - 10_000;

    if (excess > 0) {
      const toDelete = entries.slice(0, excess);
      const updates  = {};
      toDelete.forEach(k => (updates[k] = null));
      await db.ref("audit").update(updates);
      console.log(`[AUDIT] Trimmed ${excess} old entries.`);
    }

    return null;
  });
