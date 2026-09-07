-- Grant anon EXECUTE on get_parish_for_zip.
--
-- THE BUG: signup collects a ZIP and resolves the member's parish from it via
-- `lookupParishByZip()` → `supabase.rpc("get_parish_for_zip")`. That entire
-- form runs BEFORE the account exists, so the call is made as `anon`. The
-- function's ACL was `{postgres=X/postgres,service_role=X/postgres,
-- authenticated=X/postgres}` — anon had no EXECUTE — so every call from the
-- signup form returned `42501 permission denied for function
-- get_parish_for_zip`. `lookupParishByZip` reports that as a warning and
-- returns null, so the failure was completely silent: the form's live
-- City/ZIP mismatch hint never rendered, and `parish` reached
-- `complete-signup` as null, which skipped the column.
--
-- Measured against prod 2026-09-06: a profile created through the real /signup
-- UI 2026-09-05 23:59 carried `zip_code = '70802'` and `parish = NULL`, while
-- `get_parish_for_zip('70802')` returns 'East Baton Rouge' when called as a
-- role that has the grant. 14 of 45 profiles had a parish; only accounts that
-- resolved it POST-auth (via /complete-profile, which runs as `authenticated`)
-- ever got one.
--
-- HOW THE GRANT CAME TO BE MISSING, because the reasoning was correct when it
-- was written and quietly expired. `20260529072718_grant_execute_client_rpcs_
-- audit_2026_05_28.sql` granted this function to `authenticated` only, labelled
-- it "Profile-edit ZIP→parish autofill", and states in its header:
--
--     All grants are to `authenticated` only — every call site is reached
--     post-auth ... Granting to `anon` would widen the exposure surface
--     without unlocking a real call site.
--
-- True on 2026-05-29: the only caller was ProfileEditForm, behind a login. It
-- stopped being true on 2026-09-05, when ZIP moved into signup step 2 (commit
-- eaa553f48, "ZIP is required now — at BOTH entry points"). That added a
-- pre-auth call site to a function whose ACL was justified by there not being
-- one, and the justification is still sitting in the migration comment reading
-- as current. Nothing failed loudly, so nothing pointed at it.
--
-- Why granting anon is safe: the function is a STABLE SECURITY DEFINER lookup
-- against `public.louisiana_zip_parishes`, a 252-row public reference table of
-- Louisiana ZIP → parish mappings. It takes a ZIP and returns a parish name.
-- There is no user data on either side of it, and the mapping is public record.
-- The signup form is the only pre-auth caller.
--
-- NOTE the role list. Per CLAUDE.md, `REVOKE ... FROM PUBLIC` does not revoke
-- anon, because Supabase's ALTER DEFAULT PRIVILEGES grants each role
-- individually — the same asymmetry means a grant must name anon explicitly.
--
-- Replay-safe: guarded on the function existing, and GRANT is idempotent.

DO $$
BEGIN
  IF to_regprocedure('public.get_parish_for_zip(text)') IS NOT NULL THEN
    GRANT EXECUTE ON FUNCTION public.get_parish_for_zip(text) TO anon;
  END IF;
END
$$;
