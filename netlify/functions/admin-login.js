const { sessionCookieHeader } = require("./lib/auth");
const { ok, fail } = require("./lib/http");

const SECRET = process.env.ADMIN_PASSWORD || "admin";

exports.handler = async (event) => {
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    body = {};
  }

  const password = String(body.password ?? "");
  if (!SECRET || password !== SECRET) {
    return fail(401, "Incorrect password");
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": sessionCookieHeader(),
    },
    body: JSON.stringify({ ok: true }),
  };
};