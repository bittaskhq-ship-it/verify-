const path = require("node:path");
const fs = require("node:fs");
const { createClient } = require("@supabase/supabase-js");

const envFile = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envFile)) {
  require("dotenv").config({ path: envFile, quiet: true });
}

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_HITS = 12;

const STATUS_ORDER = { pending: 0, approved: 1, rejected: 2 };

function client() {
  if (!global.__supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY environment variables.",
      );
    }
    global.__supabaseClient = createClient(url, key);
  }
  return global.__supabaseClient;
}

function randomClaimCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function insertClaim({ name, email, password, createdAt }) {
  const supabase = client();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from("claims")
      .insert([
        {
          name,
          email,
          password,
          status: "pending",
          claim_code: randomClaimCode(),
          created_at: createdAt,
        },
      ])
      .select()
      .single();
    if (!error) return { row: data, claimCode: data.claim_code };
    if (String(error.code) !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not allocate a unique claim code");
}

async function listClaims() {
  const { data, error } = await client()
    .from("claims")
    .select("*")
    .eq("deleted", false)
    .order("id", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).slice().sort((a, b) => {
    const d = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
    return d !== 0 ? d : Number(b.id) - Number(a.id);
  });
}

async function getClaimById(id) {
  const { data, error } = await client()
    .from("claims")
    .select("id, name, email, password, status, created_at, reviewed_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function setClaimStatus(id, status) {
  const { data, error } = await client()
    .from("claims")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteClaim(id) {
  const { data, error } = await client()
    .from("claims")
    .update({ deleted: true, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("deleted", false)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function claimAllowed(ip) {
  const { data, error } = await client().rpc("claim_allowed", {
    client_ip: ip,
    window_ms: RATE_LIMIT_WINDOW_MS,
    max_hits: RATE_LIMIT_MAX_HITS,
  });
  if (error) throw new Error(error.message);
  return Boolean(data);
}

async function getRecentClaims(limit = 3) {
  const { data, error } = await client()
    .from("claims")
    .select("id, name, email, password, claim_code, status, created_at")
    .eq("deleted", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function escapeLike(term) {
  return String(term).replace(/[%_,']/g, " ");
}

async function searchRecentClaims(term, limit = 3) {
  const q = String(term ?? "").trim();
  if (!q) return [];
  const p = `%${escapeLike(q)}%`;
  const { data, error } = await client()
    .from("claims")
    .select("id, name, email, password, claim_code, status, created_at, deleted")
    .eq("deleted", false)
    .or(`email.ilike.${p},password.ilike.${p}`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

module.exports = {
  insertClaim,
  listClaims,
  getClaimById,
  setClaimStatus,
  deleteClaim,
  claimAllowed,
  searchRecentClaims,
  getRecentClaims,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_HITS,
};