const { listClaims } = require("../../lib/db");
const { hasValidSession } = require("./lib/auth");
const { ok, fail, unauthorized } = require("./lib/http");

exports.handler = async (event) => {
  if (!hasValidSession(event)) return unauthorized();
  try {
    const claims = await listClaims();
    return ok({ claims });
  } catch (err) {
    console.error("admin-claims handler error:", err);
    return fail(500, "Something went wrong, try again.");
  }
};