const { createHmac, timingSafeEqual } = require("node:crypto");

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SECRET = process.env.ADMIN_PASSWORD || "admin";

function sign(payload) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function makeSessionToken() {
  const payload = String(Date.now() + SESSION_TTL_MS);
  return `${payload}.${sign(payload)}`;
}

function parseCookies(header) {
  const out = {};
  if (header) {
    for (const part of header.split(";")) {
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

function hasValidSession(event) {
  const cookieHeader = event.headers?.cookie ?? event.headers?.["Cookie"] ?? "";
  const token = parseCookies(cookieHeader).admin_session;
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

function sessionCookieHeader() {
  return `admin_session=${makeSessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

function clearCookieHeader() {
  return "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

module.exports = { hasValidSession, sessionCookieHeader, clearCookieHeader };