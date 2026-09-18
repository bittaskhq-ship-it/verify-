const { deleteClaim } = require("../../lib/db");
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
    if (!Number.isFinite(id)) return fail(400, "Missing id");

    await deleteClaim(id);

    return ok({ ok: true });
  } catch (err) {
    console.error("admin-delete handler error:", err);
    return fail(500, "Something went wrong, try again.");
  }
};