const { getClaimById, setClaimStatus } = require("../../lib/db");
const { hasValidSession } = require("./lib/auth");
const { ok, fail, unauthorized } = require("./lib/http");

exports.handler = async (event) => {
  if (!hasValidSession(event)) return unauthorized();
  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      body = {};
    }

    const id = Number(body.id);
    const password = String(body.password ?? "").trim();
    if (!Number.isFinite(id) || !password) {
      return fail(400, "Missing id or password");
    }

    const row = await getClaimById(id);
    if (!row) return fail(404, "Claim not found");
    if (row.password !== password) {
      return fail(
        400,
        "Password doesn't match the one submitted. If the entry looks wrong, reject it.",
      );
    }

    await setClaimStatus(id, "approved");

    return ok({ ok: true });
  } catch (err) {
    console.error("admin-approve handler error:", err);
    return fail(500, "Something went wrong, try again.");
  }
};