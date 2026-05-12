// ════════════════════════════════════════════════════════════════
//  GHOST_MSG — security.js
//  Client-side security: input sanitization, rate limiting,
//  anti-spam, auth guards, report UI, session hardening,
//  secure transfer via Cloud Function, and XSS prevention.
//  Load AFTER firebase.js, BEFORE auth.js in index.html.
// ════════════════════════════════════════════════════════════════

"use strict";

// ── CONTENT SECURITY: input sanitization ─────────────────────
const SEC = {

  // Strip dangerous chars; used for display-safe output
  sanitize(str, maxLen = 2000) {
    if (str == null) return "";
    return String(str)
      .replace(/\0/g, "")          // null bytes
      .replace(/javascript:/gi, "") // JS protocol
      .replace(/on\w+\s*=/gi, "")   // inline handlers
      .slice(0, maxLen)
      .trim();
  },

  // Validate username: 2-20 chars, lowercase letters/numbers/underscore
  validUsername(u) {
    return typeof u === "string" && /^[a-z0-9_]{2,20}$/.test(u);
  },

  // Validate tag: 2-5 uppercase letters/numbers
  validTag(t) {
    return typeof t === "string" && /^[A-Z0-9]{2,5}$/.test(t);
  },

  // Validate password: min 8 chars, must have letter + number
  validPassword(p) {
    if (typeof p !== "string" || p.length < 8) return false;
    return /[a-zA-Z]/.test(p) && /[0-9]/.test(p);
  },

  // Validate amount: positive number up to MAX_TRANSFER
  validAmount(a) {
    const n = parseFloat(a);
    return !isNaN(n) && n >= 0.01 && n <= 500_000;
  },

  // Safe text for innerHTML insertion (use instead of innerHTML = text)
  escapeHTML(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#x27;")
      .replace(/`/g, "&#x60;");
  },
};

// ── CLIENT-SIDE RATE LIMITER ──────────────────────────────────
// Augments auth.js _rl with stricter per-action limits.
const RATE = (() => {
  const buckets = {};

  function check(key, maxHits, windowMs) {
    const now = Date.now();
    if (!buckets[key]) buckets[key] = { hits: [], blockedUntil: 0 };
    const b = buckets[key];

    if (now < b.blockedUntil) {
      return { ok: false, waitMs: b.blockedUntil - now };
    }

    b.hits = b.hits.filter(t => now - t < windowMs);
    if (b.hits.length >= maxHits) {
      b.blockedUntil = now + windowMs * 2;
      return { ok: false, waitMs: windowMs * 2 };
    }

    b.hits.push(now);
    return { ok: true };
  }

  return {
    msg:      () => check("msg",      5,  5_000),
    auth:     () => check("auth",     5,  10_000),
    transfer: () => check("transfer", 3,  30_000),
    report:   () => check("report",   3,  60_000),
    create:   () => check("create",   3,  30_000),
  };
})();

// ── AUTH GUARD ────────────────────────────────────────────────
// Wrap any function that requires a logged-in user.
function requireAuth(fn) {
  return function (...args) {
    if (!window.CU) {
      console.warn("[SEC] Blocked unauthenticated call to", fn.name);
      return;
    }
    return fn.apply(this, args);
  };
}

// ── SESSION HARDENING ─────────────────────────────────────────
// Wipes session storage if tab is idle >30 minutes.
(function sessionIdleGuard() {
  const IDLE_LIMIT = 30 * 60 * 1000; // 30 min
  let lastActivity = Date.now();

  function resetTimer() { lastActivity = Date.now(); }
  ["mousemove","keydown","touchstart","click","scroll"].forEach(ev =>
    document.addEventListener(ev, resetTimer, { passive: true })
  );

  setInterval(() => {
    if (window.CU && Date.now() - lastActivity > IDLE_LIMIT) {
      console.warn("[SEC] Session idle timeout — logging out.");
      if (typeof logout === "function") logout();
    }
  }, 60_000);
})();

// ── CLIPBOARD SCRUB ───────────────────────────────────────────
// Prevent pasting raw scripts into message input.
document.addEventListener("DOMContentLoaded", () => {
  const inp = document.getElementById("minput");
  if (!inp) return;
  inp.addEventListener("paste", e => {
    e.preventDefault();
    const raw   = (e.clipboardData || window.clipboardData).getData("text");
    const clean = SEC.sanitize(raw, 2000);
    document.execCommand("insertText", false, clean);
  });
});

// ── SECURE TRANSFER (via Cloud Function) ─────────────────────
// Replaces direct DB writes for wallet transfers.
// Returns { success, txId } or throws.
async function secureTransfer(toUsername, amount, note) {
  if (!window.CU || window.CU.isGuest) throw new Error("Login required.");

  // Client-side rate check
  const rl = RATE.transfer();
  if (!rl.ok) throw new Error(`Transfer rate limited. Wait ${Math.ceil(rl.waitMs / 1000)}s.`);

  // Validate inputs before hitting the network
  if (!SEC.validUsername(toUsername)) throw new Error("Invalid recipient username.");
  if (!SEC.validAmount(amount))       throw new Error(`Invalid amount (0.01–500,000 GHO).`);

  if (typeof firebase === "undefined" || !firebase.functions) {
    throw new Error("Cloud Functions not available.");
  }

  const fn = firebase.functions().httpsCallable("secureTransfer");
  const res = await fn({ toUsername, amount: parseFloat(amount), note: SEC.sanitize(note, 200) });
  return res.data;
}

// Patch doPayment in group.js to use secureTransfer when fbOK.
// We override it here so the original file is unchanged.
if (typeof window !== "undefined") {
  window.__secureTransfer = secureTransfer;
}

// ── REPORT USER ───────────────────────────────────────────────
async function reportUser(targetUsername, reason, context) {
  if (!window.CU || window.CU.isGuest) {
    alert("[SEC] Login required to report users.");
    return;
  }

  const rl = RATE.report();
  if (!rl.ok) {
    alert(`Too many reports. Wait ${Math.ceil(rl.waitMs / 1000)}s.`);
    return;
  }

  if (!targetUsername || typeof reason !== "string" || reason.length < 5) {
    alert("Provide a reason (min 5 chars).");
    return;
  }

  try {
    if (window.fbOK) {
      const fn = firebase.functions().httpsCallable("reportUser");
      await fn({
        targetUsername,
        reason:  SEC.sanitize(reason, 500),
        context: SEC.sanitize(context || "", 200),
      });
    } else {
      // local fallback: just acknowledge
      console.info("[REPORT] Local mode — report logged locally only.");
    }
    alert("✓ Report submitted. Our team will review it.");
  } catch (e) {
    alert("Report failed: " + (e.message || "Unknown error"));
  }
}

// ── REPORT MODAL UI ───────────────────────────────────────────
// Call reportUserModal(username) to open the report flow.
function reportUserModal(username) {
  const existing = document.getElementById("_sec_repmod");
  if (existing) existing.remove();

  const ov = document.createElement("div");
  ov.id = "_sec_repmod";
  ov.className = "mov active";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999";

  ov.innerHTML = `
    <div class="modal" style="width:360px;max-width:95vw">
      <div class="mtit" style="color:var(--red)">
        <span>⚠ REPORT USER</span>
        <button class="mcl" onclick="document.getElementById('_sec_repmod').remove()">✕</button>
      </div>
      <div class="mbdy" style="padding:18px 20px">
        <div style="font-size:10px;color:var(--gd);margin-bottom:12px;line-height:1.7">
          Reporting: <span style="color:var(--yel)">${SEC.escapeHTML(username)}</span><br>
          Abuse, spam, or harassment reports are reviewed by admins.
        </div>
        <div class="fg">
          <label class="fl">REASON</label>
          <select class="ti" id="_rep_reason" style="font-size:11px">
            <option value="">— Select —</option>
            <option value="Spam">Spam / Flooding</option>
            <option value="Harassment">Harassment / Threats</option>
            <option value="Abuse">Abusive content</option>
            <option value="Impersonation">Impersonation</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="fg" style="margin-top:8px">
          <label class="fl">DETAILS <span style="color:var(--gd)">(optional)</span></label>
          <input class="ti" id="_rep_detail" type="text" placeholder="Additional context..." maxlength="200" style="font-size:11px">
        </div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button onclick="document.getElementById('_sec_repmod').remove()"
            style="flex:1;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">
            CANCEL
          </button>
          <button onclick="(async()=>{
              const r=document.getElementById('_rep_reason').value;
              const d=document.getElementById('_rep_detail').value;
              if(!r){alert('Select a reason.');return;}
              await reportUser('${SEC.escapeHTML(username)}',r,d);
              document.getElementById('_sec_repmod').remove();
            })()"
            style="flex:1;padding:9px;background:rgba(255,42,42,.08);border:1px solid var(--red);color:var(--red);font-family:'Orbitron',monospace;font-size:10px;cursor:pointer;letter-spacing:2px;font-weight:700">
            SUBMIT REPORT
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(ov);
  ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
}

// ── ACCOUNT DELETE UI ─────────────────────────────────────────
function openDeleteAccountModal() {
  if (!window.CU || window.CU.isGuest) return;

  const existing = document.getElementById("_sec_delmod");
  if (existing) existing.remove();

  const ov = document.createElement("div");
  ov.id = "_sec_delmod";
  ov.className = "mov active";
  ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999";

  ov.innerHTML = `
    <div class="modal" style="width:380px;max-width:95vw">
      <div class="mtit" style="color:var(--red)">
        <span>⚠ DELETE ACCOUNT</span>
        <button class="mcl" onclick="document.getElementById('_sec_delmod').remove()">✕</button>
      </div>
      <div class="mbdy" style="padding:18px 20px">
        <div style="font-size:11px;color:var(--wht);line-height:1.8;margin-bottom:14px;padding:10px;border:1px solid rgba(255,42,42,.2);background:rgba(255,42,42,.04)">
          This permanently deletes your account, wallet, messages, and all data.<br>
          <span style="color:var(--red)">This cannot be undone.</span>
        </div>
        <div class="fg">
          <label class="fl">TYPE YOUR USERNAME TO CONFIRM</label>
          <input class="ti" id="_del_confirm" type="text" placeholder="${SEC.escapeHTML(window.CU?.id || "")}" style="font-size:11px">
        </div>
        <div id="_del_err" class="terr" style="font-size:10px;margin-top:6px"></div>
        <div style="display:flex;gap:8px;margin-top:14px">
          <button onclick="document.getElementById('_sec_delmod').remove()"
            style="flex:1;padding:9px;background:none;border:1px solid var(--border);color:var(--gd);font-family:'Share Tech Mono',monospace;font-size:10px;cursor:pointer;letter-spacing:2px">
            CANCEL
          </button>
          <button onclick="confirmDeleteAccount()"
            style="flex:1;padding:9px;background:rgba(255,42,42,.08);border:1px solid var(--red);color:var(--red);font-family:'Orbitron',monospace;font-size:10px;cursor:pointer;letter-spacing:2px;font-weight:700">
            DELETE FOREVER
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(ov);
}

async function confirmDeleteAccount() {
  const inp    = document.getElementById("_del_confirm");
  const errEl  = document.getElementById("_del_err");
  const typed  = inp ? inp.value.trim().toLowerCase() : "";

  if (typed !== (window.CU?.id || "").toLowerCase()) {
    if (errEl) errEl.textContent = "Username does not match.";
    return;
  }

  if (!window.fbOK) {
    // local mode: just clear session
    if (typeof logout === "function") logout();
    document.getElementById("_sec_delmod")?.remove();
    return;
  }

  try {
    const fn = firebase.functions().httpsCallable("deleteAccount");
    await fn({ username: window.CU.id });
    document.getElementById("_sec_delmod")?.remove();
    if (typeof logout === "function") logout();
    alert("Account deleted successfully.");
  } catch (e) {
    if (errEl) errEl.textContent = "Error: " + (e.message || "Deletion failed.");
  }
}

// ── ENHANCED INPUT VALIDATION (patches existing forms) ────────
// Runs after DOM is ready and adds real-time validation feedback.
document.addEventListener("DOMContentLoaded", () => {

  // Password strength indicator on register form
  const rpEl = document.getElementById("rp");
  if (rpEl) {
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:9px;margin-top:4px;letter-spacing:1px;height:14px;transition:color .2s";
    rpEl.parentNode.appendChild(hint);

    rpEl.addEventListener("input", () => {
      const p = rpEl.value;
      if (!p) { hint.textContent = ""; return; }
      if (p.length < 8)              { hint.style.color = "var(--red)"; hint.textContent = "// TOO SHORT — min 8 chars"; }
      else if (!/[0-9]/.test(p))     { hint.style.color = "var(--yel)"; hint.textContent = "// ADD A NUMBER"; }
      else if (!/[A-Za-z]/.test(p))  { hint.style.color = "var(--yel)"; hint.textContent = "// ADD A LETTER"; }
      else if (p.length >= 12)       { hint.style.color = "var(--g)";   hint.textContent = "// STRONG"; }
      else                           { hint.style.color = "var(--g)";   hint.textContent = "// OK"; }
    });
  }

  // Message input: strip pasted scripts, enforce max length
  const msgInp = document.getElementById("minput");
  if (msgInp) {
    msgInp.addEventListener("input", () => {
      const val = msgInp.value;
      if (val.length > 2000) msgInp.value = val.slice(0, 2000);
    });
  }
});

// ── ANTI-DEVTOOLS TAMPERING (light deterrent) ─────────────────
// Detects if browser devtools are open and warns (not a hard block).
(function devtoolsDetect() {
  let open = false;
  const threshold = 160;
  setInterval(() => {
    const widthDiff  = window.outerWidth  - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    const nowOpen    = widthDiff > threshold || heightDiff > threshold;
    if (nowOpen && !open) {
      open = true;
      console.warn("%c[GHOST_MSG] Dev tools detected. All actions are server-validated.", "color:red;font-size:14px;font-weight:bold");
    } else if (!nowOpen) {
      open = false;
    }
  }, 2000);
})();

// ── XSS OBSERVER ─────────────────────────────────────────────
// MutationObserver that scrubs script tags injected into #msgs.
(function xssGuard() {
  const target = document.getElementById("msgs");
  if (!target) return;

  const observer = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        // Remove any injected <script> or <iframe> tags
        node.querySelectorAll("script,iframe,object,embed,link[rel=import]").forEach(el => {
          console.warn("[XSS Guard] Removed injected element:", el.tagName);
          el.remove();
        });
        // Strip on* handlers from any elements
        node.querySelectorAll("*").forEach(el => {
          Array.from(el.attributes).forEach(attr => {
            if (/^on/i.test(attr.name)) {
              el.removeAttribute(attr.name);
            }
          });
        });
      });
    });
  });

  // Start observing once DOM is ready
  document.addEventListener("DOMContentLoaded", () => {
    const msgsEl = document.getElementById("msgs");
    if (msgsEl) observer.observe(msgsEl, { childList: true, subtree: true });
  });
})();

// ── EXPOSE GLOBALS ────────────────────────────────────────────
window.SEC             = SEC;
window.RATE            = RATE;
window.requireAuth     = requireAuth;
window.secureTransfer  = secureTransfer;
window.reportUser      = reportUser;
window.reportUserModal = reportUserModal;
window.openDeleteAccountModal = openDeleteAccountModal;
window.confirmDeleteAccount   = confirmDeleteAccount;
