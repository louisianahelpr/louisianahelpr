-- F-SEC-06 (pre-launch audit redo, 2026-07-06): sync_credential_from_check and
-- insert_job_status_system_message are SECURITY DEFINER trigger functions with
-- no pinned search_path — a gap versus every sibling SECURITY DEFINER function
-- in this codebase, which all pin search_path=public. Pin them to match, closing
-- the standard search_path-hijacking hardening gap the Postgres linter flags.
alter function public.sync_credential_from_check() set search_path = public;
alter function public.insert_job_status_system_message() set search_path = public;
