-- Read receipts stopped working on 2026-08-30 and nothing said so.
--
-- R11 (20260824180000_security_hardening_r1_r4_r11.sql:291) narrowed the
-- authenticated UPDATE grant on public.messages to (content, edited_at, read).
-- 20260830233932 then added `read_at` WITHOUT widening that grant, so the
-- client's `{ read: true, read_at: <now> }` patch named a column it had no
-- privilege on and Postgres rejected the WHOLE statement with 42501 — verified
-- live: PATCH {read,read_at} → 403, PATCH {read} → 200. Opening a chat has not
-- marked a single message read since. d7639cdc4 fixed the marking half by
-- writing `read` only; this migration fixes the receipt half.
--
-- The fix is a trigger, deliberately NOT a wider grant. `read_at` is a fact the
-- database observes, not a value a client should be trusted to assert: widening
-- the grant would let the receiver backdate or forward-date their own read
-- receipt, which is exactly the kind of claim the sender is reading it for.
-- Column privileges are checked against the columns named in the UPDATE's SET
-- list, not against what a BEFORE trigger assigns, so the trigger can stamp a
-- column the caller may not name. That is the whole mechanism.
--
-- Semantics:
--   false → true : stamp now() (coalesce, so a service_role/edge write that
--                  supplies its own read_at — e.g. a backfill — is preserved).
--   true  → true : leave OLD.read_at alone. Re-opening a thread must not bump
--                  the receipt; "read at" means FIRST read.
--   true  → false: leave read_at alone rather than clearing it. There is no
--                  product path that un-reads a message, and if one ever
--                  appears, silently destroying the timestamp of a read that
--                  demonstrably happened is the wrong default — the row should
--                  keep the evidence.
--   anything else: pass through untouched, so this trigger never interferes
--                  with the sender's 15-minute content edit.

create or replace function public.stamp_message_read_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if coalesce(NEW.read, false) and not coalesce(OLD.read, false) then
    NEW.read_at := coalesce(NEW.read_at, now());
  else
    NEW.read_at := OLD.read_at;
  end if;
  return NEW;
end;
$$;

comment on function public.stamp_message_read_at() is
  'Stamps messages.read_at when read flips false->true. Exists because the '
  'authenticated UPDATE grant deliberately excludes read_at — the receipt is '
  'observed server-side, never asserted by the client.';

-- Replay-safe: drop-then-create, and the function is CREATE OR REPLACE above.
-- Named to sort after trg_messages_non_sender_read_only so the ownership guard
-- runs first (it has no opinion on read_at, but the ordering is the honest one).
drop trigger if exists trg_stamp_message_read_at on public.messages;
create trigger trg_stamp_message_read_at
  before update on public.messages
  for each row
  execute function public.stamp_message_read_at();

-- Definer function: lock the ACL down rather than inherit Supabase's default
-- grant-to-everyone. Nothing should ever CALL this directly; it is a trigger
-- body. REVOKE must name the roles individually — FROM PUBLIC alone leaves
-- anon/authenticated/service_role's explicit grants intact.
revoke all on function public.stamp_message_read_at() from public, anon, authenticated;
