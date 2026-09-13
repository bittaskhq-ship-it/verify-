const path = require("node:path");
const fs = require("node:fs");

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const isTurso = Boolean(TURSO_URL && TURSO_TOKEN);

let turso;
let local;

if (isTurso) {
  const { createClient } = require("@libsql/client");
  turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
} else {
  const origEmit = process.emit;
  process.emit = function (name, data, ...args) {
    if (
      name === "warning" &&
      data?.name === "ExperimentalWarning" &&
      String(data?.message ?? "").includes("SQLite is an experimental feature")
    ) {
      return false;
    }
    return origEmit.call(this, name, data, ...args);
  };
  fs.mkdirSync(path.join(__dirname, "..", "data"), { recursive: true });
  const { DatabaseSync } = require("node:sqlite");
  local = new DatabaseSync(path.join(__dirname, "..", "data", "capture.db"));
}

const DDL = `
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    reviewed_at TEXT
  );
`;

async function init() {
  if (turso) await turso.executeMultiple(DDL);
  else local.exec(DDL);
}

async function run(sql, args = []) {
  if (turso) await turso.execute({ sql, args });
  else local.prepare(sql).run(...args);
}

async function get(sql, args = []) {
  if (turso) {
    const { rows } = await turso.execute({ sql, args });
    return rows[0] ?? undefined;
  }
  return local.prepare(sql).get(...args);
}

async function all(sql, args = []) {
  if (turso) {
    const { rows } = await turso.execute({ sql, args });
    return rows.map((row) => ({ ...row }));
  }
  return local.prepare(sql).all(...args).map((row) => ({ ...row }));
}

module.exports = { init, run, get, all, isTurso };