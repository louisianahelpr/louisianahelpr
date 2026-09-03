-- Take TRUNCATE and TRIGGER away from the two client roles, on every table.
--
-- WHAT WAS WRONG, measured in prod:
--     anon           TRUNCATE + TRIGGER on 75 tables
--     authenticated  TRUNCATE + TRIGGER on 80 tables
--
-- This is Supabase's default `GRANT ALL ON ALL TABLES IN SCHEMA public` and it
-- is almost certainly present on every Supabase project. It is not a defect
-- anyone introduced here. It is still worth removing, for one specific reason:
--
--   ROW LEVEL SECURITY DOES NOT APPLY TO TRUNCATE.
--
-- Every other write these roles hold is gated by a policy — a member may UPDATE
-- only their own row, DELETE only what a policy allows. TRUNCATE is the single
-- privilege where the policy layer simply does not run: it empties the table
-- regardless. So it is the one grant in the schema with no second line of
-- defence, sitting on `profiles`, `jobs`, `payments`, `messages` and 76 others.
--
-- NOT REACHABLE TODAY, and that is stated as plainly as the risk. PostgREST
-- exposes no TRUNCATE verb, so no client holding an anon or authenticated JWT
-- can issue one through the API. Reaching it needs a direct Postgres connection
-- as one of those roles. This closes a latent hole, not a live one, and anyone
-- reading this later should not conclude the app was wide open.
--
-- TRIGGER goes with it for the same reason it was never wanted: it lets the
-- holder attach a trigger function to a table, i.e. run arbitrary code on
-- everyone else's writes. Neither role has any use for either privilege — no
-- client path creates triggers or empties tables.
--
-- REVOKE is idempotent, so this is replay-safe by construction. The ALTER
-- DEFAULT PRIVILEGES lines stop the grant coming back on tables created later,
-- which is what would otherwise make this a one-time cleanup that silently
-- undoes itself.

REVOKE TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Future tables. Without these, the next migration that creates a table hands
-- the grant straight back and this file becomes a lie the moment it lands.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE, TRIGGER ON TABLES FROM authenticated;
