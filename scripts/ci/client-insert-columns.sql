-- Class check (Q340, 2026-10-03; UPDATE added by Q1166): on a table whose
-- client write columns are declared below, each client role holds the declared
-- privilege (INSERT or UPDATE) on exactly those columns: never table-level (it
-- implies every column, the server-owned ones included), never a column
-- outside the list, and never LESS than the list (that breaks the client's own
-- write). Returns one row per offender; ZERO ROWS = CLEAN.
--
-- Why a list: messages had table-level INSERT for authenticated, so a direct
-- POST could set is_system (a fake platform notice), created_at (an edit
-- window that never closes), read/read_at and the moderation flags (Q340); and
-- column UPDATE on edited_at, so a sender could erase or forge the "edited"
-- mark (Q1166). A policy checks WHO writes, not WHICH columns. A table joins
-- here when its client payloads are fully inventoried;
-- src/test/messagesInsertColumnsClientScoped.test.ts pins each list to the
-- client's own insert/update payloads (write-contract AST), two-way.
--
-- Shared by:
--   scripts/check-live-privileges.mjs   prod, after every db-deploy and nightly (db-drift-detect)
--   .github/workflows/db-smoke.yml      the replayed migration set, before a deploy
--   src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs   PGlite red/green proof (INSERT)
--   src/test/pglite/messageReadReceiptIsTheReceivers.pglite.mjs    PGlite red/green proof (UPDATE)
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
WITH declared(tbl, role, priv, cols) AS (
  VALUES
    ('messages', 'authenticated', 'INSERT', ARRAY['client_id', 'job_id', 'sender_id', 'receiver_id', 'content',
                                                  'attachment_url', 'attachment_mime', 'attachment_size',
                                                  'attachment_duration', 'reply_to_id']::text[]),
    ('messages', 'anon', 'INSERT', ARRAY[]::text[]),
    ('messages', 'authenticated', 'UPDATE', ARRAY['content', 'read']::text[]),
    ('messages', 'anon', 'UPDATE', ARRAY[]::text[])
),
rels AS (
  SELECT d.tbl, d.role, d.priv, d.cols, c.oid
    FROM declared d
    JOIN pg_class c ON c.relname = d.tbl AND c.relkind IN ('r', 'p')
                   AND c.relnamespace = 'public'::regnamespace
),
table_level AS (
  SELECT r.tbl AS "table", r.role, r.priv || ' (table-level)' AS what
    FROM rels r
   WHERE has_table_privilege(r.role, r.oid, r.priv)
),
extra AS (
  SELECT r.tbl, r.role, r.priv || ' (' || a.attname || ')'
    FROM rels r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE NOT has_table_privilege(r.role, r.oid, r.priv)
     AND has_column_privilege(r.role, r.oid, a.attnum, r.priv)
     AND NOT (a.attname::text = ANY (r.cols))
),
missing AS (
  SELECT r.tbl, r.role, 'missing ' || r.priv || ' (' || c.col || ')'
    FROM rels r
   CROSS JOIN unnest(r.cols) AS c(col)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = r.oid AND a.attname = c.col AND NOT a.attisdropped
              AND has_column_privilege(r.role, r.oid, a.attnum, r.priv))
),
-- A declared table that is gone, or is no longer a table (a view, say),
-- makes every rule above read nothing: that is itself an offender.
absent AS (
  SELECT d.tbl, d.role, d.priv || ': declared table missing or not a table'
    FROM declared d
   WHERE NOT EXISTS (SELECT 1 FROM rels r WHERE r.tbl = d.tbl AND r.role = d.role AND r.priv = d.priv)
)
SELECT "table", role, what FROM table_level
UNION ALL SELECT * FROM extra
UNION ALL SELECT * FROM missing
UNION ALL SELECT * FROM absent
ORDER BY 1, 2, 3
