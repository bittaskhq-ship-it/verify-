function json(statusCode, data) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  };
}

function ok(data) {
  return json(200, data);
}

function fail(statusCode, error) {
  return json(statusCode, { error });
}

function unauthorized() {
  return json(401, { error: "Unauthorized" });
}

module.exports = { json, ok, fail, unauthorized };