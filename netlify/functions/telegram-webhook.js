const { handleTelegramWebhook } = require("../../lib/telegram");

exports.handler = async (event) => {
  let body;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return { statusCode: 400, body: "invalid json" };
  }

  try {
    await handleTelegramWebhook(body);
  } catch (err) {
    console.error("telegram-webhook error:", err.message);
  }

  return { statusCode: 200, body: "ok" };
};