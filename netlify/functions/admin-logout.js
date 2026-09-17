const { clearCookieHeader } = require("./lib/auth");

exports.handler = async () => ({
  statusCode: 200,
  headers: {
    "Content-Type": "application/json",
    "Set-Cookie": clearCookieHeader(),
  },
  body: JSON.stringify({ ok: true }),
});