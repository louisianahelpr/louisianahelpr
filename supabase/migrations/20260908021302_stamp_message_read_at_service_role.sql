-- Follow-up to 20260908020743: don't let the read_at trigger silently revert a
-- backfill.
--
-- As shipped, the else-branch pinned `NEW.read_at := OLD.read_at` for EVERY
-- writer. That is right for a user write — it is what stops a receiver
-- re-stamping their own receipt by re-opening a thread — but it also means a
-- service_role or migration backfill of the shape
--
--   update public.messages set read_at = created_at where read and read_at is null;
--
-- is a true->true update, hits the else-branch, and is reverted to OLD.read_at
-- with no error. That is precisely the failure this project keeps paying for:
-- a statement that reads as done in review and changed nothing. (Migration
-- 20260830233932 contains exactly that backfill; anyone re-running it, or
-- writing the next one, would have got a silent no-op.)
--
-- Fix: only pin on a real user write. `auth.uid() IS NULL` means no JWT —
-- service_role, cron, an edge function, or a migration — and those writers are
-- already trusted with a full-table UPDATE grant on read_at. This mirrors the
-- convention enforce_message_non_sender_read_only() already uses on this same
-- table, so the two triggers now agree about what "a user write" means.

create or replace function public.stamp_message_read_at()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- No JWT: service_role / cron / edge function / migration. Trusted to write
  -- read_at directly (it holds the column grant); pass through untouched.
  if auth.uid() is null then
    return NEW;
  end if;

  if coalesce(NEW.read, false) and not coalesce(OLD.read, false) then
    NEW.read_at := now();
  else
    -- Re-opening a thread must not bump the receipt, and true->false keeps the
    -- evidence of a read that demonstrably happened rather than clearing it.
    NEW.read_at := OLD.read_at;
  end if;
  return NEW;
end;
$$;

comment on function public.stamp_message_read_at() is
  'Stamps messages.read_at when read flips false->true on a user write. Exists '
  'because the authenticated UPDATE grant deliberately excludes read_at — the '
  'receipt is observed server-side, never asserted by the client. Writers with '
  'no JWT (service_role, cron, migrations) pass through so a backfill is not '
  'silently reverted.';

revoke all on function public.stamp_message_read_at() from public, anon, authenticated;
