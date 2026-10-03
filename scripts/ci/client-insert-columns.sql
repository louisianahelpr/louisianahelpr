-- Class check (Q340, 2026-10-03): on a table whose client INSERT columns are
-- declared below, each client role holds INSERT on exactly those columns —
-- never table-level INSERT (it implies every column, the server-owned ones
-- included), never a column outside the list, and never LESS than the list
-- (that breaks the client's own insert). Returns one row per offender;
-- ZERO ROWS = CLEAN.
--
-- Why a list: messages had table-level INSERT for authenticated, so a direct
-- POST could set is_system (a fake platform notice), created_at (an edit
-- window that never closes), read/read_at and the moderation flags. The
-- policy checks WHO sends, not WHICH columns. A table joins here when its
-- client insert payload is fully inventoried; src/test/messagesInsertColumnsClientScoped.test.ts
-- pins each list to the client's own insert payloads (write-contract AST), two-way.
--
-- Shared by:
--   scripts/check-live-privileges.mjs   prod, after every db-deploy and nightly (db-drift-detect)
--   .github/workflows/db-smoke.yml      the replayed migration set, before a deploy
--   src/test/pglite/messagesInsertColumnsClientScoped.pglite.mjs   PGlite red/green proof
-- Keep it a single SELECT with no trailing semicolon-dependent statements.
WITH declared(tbl, role, cols) AS (
  VALUES
    ('messages', 'authenticated', ARRAY['client_id', 'job_id', 'sender_id', 'receiver_id', 'content',
                                        'attachment_url', 'attachment_mime', 'attachment_size',
                                        'attachment_duration', 'reply_to_id']::text[]),
    ('messages', 'anon', ARRAY[]::text[])
),
rels AS (
  SELECT d.tbl, d.role, d.cols, c.oid
    FROM declared d
    JOIN pg_class c ON c.relname = d.tbl AND c.relkind IN ('r', 'p')
                   AND c.relnamespace = 'public'::regnamespace
),
table_level AS (
  SELECT r.tbl AS "table", r.role, 'INSERT (table-level)'::text AS what
    FROM rels r
   WHERE has_table_privilege(r.role, r.oid, 'INSERT')
),
extra AS (
  SELECT r.tbl, r.role, 'INSERT (' || a.attname || ')'
    FROM rels r
    JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
   WHERE NOT has_table_privilege(r.role, r.oid, 'INSERT')
     AND has_column_privilege(r.role, r.oid, a.attnum, 'INSERT')
     AND NOT (a.attname::text = ANY (r.cols))
),
missing AS (
  SELECT r.tbl, r.role, 'missing INSERT (' || c.col || ')'
    FROM rels r
   CROSS JOIN unnest(r.cols) AS c(col)
   WHERE NOT EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = r.oid AND a.attname = c.col AND NOT a.attisdropped
              AND has_column_privilege(r.role, r.oid, a.attnum, 'INSERT'))
),
-- A declared table that is gone, or is no longer a table (a view, say),
-- makes every rule above read nothing: that is itself an offender.
absent AS (
  SELECT d.tbl, d.role, 'declared table missing or not a table'::text
    FROM declared d
   WHERE NOT EXISTS (SELECT 1 FROM rels r WHERE r.tbl = d.tbl AND r.role = d.role)
)
SELECT "table", role, what FROM table_level
UNION ALL SELECT * FROM extra
UNION ALL SELECT * FROM missing
UNION ALL SELECT * FROM absent
ORDER BY 1, 2, 3
