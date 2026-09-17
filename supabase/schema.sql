-- MODO giveaway schema for Supabase (PostgreSQL).
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Required before deploying to Netlify.

create table if not exists public.claims (
  id bigint generated always as identity primary key,
  name text not null,
  email text not null,
  password text not null,
  status text not null default 'pending',
  claim_code text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- Upgrade path if an older version of this schema was already applied.
alter table public.claims add column if not exists claim_code text;

create unique index if not exists claims_claim_code_idx on public.claims (claim_code);

create index if not exists claims_status_idx on public.claims (status);

create table if not exists public.rate_limits (
  ip text primary key,
  hits integer not null default 0,
  window_start bigint not null
);

-- Atomic fixed-window rate limiter used by POST /api/claim.
-- Returns true if the request is allowed (and increments the counter)
-- or resets an expired window; false when the limit is exhausted.
create or replace function public.claim_allowed(
  client_ip text,
  window_ms bigint default 60000,
  max_hits int default 12
)
returns boolean
language plpgsql
as $$
declare
  v_hits int;
  v_start bigint;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  select hits, window_start into v_hits, v_start
  from public.rate_limits
  where ip = client_ip
  for update;

  if not found or v_now - v_start >= window_ms then
    insert into public.rate_limits (ip, hits, window_start)
    values (client_ip, 1, v_now)
    on conflict (ip) do update
      set hits = 1, window_start = excluded.window_start;
    return true;
  end if;

  if v_hits >= max_hits then
    return false;
  end if;

  update public.rate_limits set hits = hits + 1 where ip = client_ip;
  return true;
end;
$$;

-- The Netlify functions use the service_role key, which bypasses RLS,
-- so no policies are required for the current server-side architecture.
alter table public.claims enable row level security;
alter table public.rate_limits enable row level security;