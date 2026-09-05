// Replay-safety probe for 20260905024022_restrict_marketing_media_listing.sql.
// Needs real Postgres; pglite is deliberately NOT a repo dependency. See
// scripts/probes/claim-marketing-content.probe.mjs for the setup one-liner.
const PGLITE_DIR = process.env.PGLITE_DIR ?? `${process.env.HOME}/.lh-pglite-probe`;
let PGlite;
try {
  ({ PGlite } = await import(`${PGLITE_DIR}/node_modules/@electric-sql/pglite/dist/index.js`));
} catch {
  console.error(`Could not load pglite from ${PGLITE_DIR} — see the claim-marketing-content probe header.`);
  process.exit(2);
}
import { readFileSync } from "node:fs";
const MIG = new URL("../../supabase/migrations/20260905024022_restrict_marketing_media_listing.sql", import.meta.url).pathname;
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  ok  ${n}`)) : (fail++, console.log(`FAIL  ${n} ${x}`)); };

// Minimal stand-in for the parts of Supabase Storage the migration touches.
await db.exec(`
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (id text PRIMARY KEY, public boolean NOT NULL DEFAULT false);
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  INSERT INTO storage.buckets (id, public) VALUES ('marketing-media', true);
  CREATE POLICY "Marketing media is publicly readable" ON storage.objects
    FOR SELECT USING (bucket_id = 'marketing-media');
  CREATE POLICY "Admins write marketing media" ON storage.objects
    FOR ALL USING (bucket_id = 'marketing-media') WITH CHECK (bucket_id = 'marketing-media');
`);

const policies = async () => (await db.query(
  `SELECT policyname FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY policyname`
)).rows.map((r) => r.policyname);

ok("starts with BOTH policies present", (await policies()).length === 2);

const sql = readFileSync(MIG, "utf8");

// Apply 3x consecutively — the replay-safety bar.
for (let i = 1; i <= 3; i++) {
  let err = null;
  try { await db.exec(sql); } catch (e) { err = String(e.message ?? e); }
  ok(`apply #${i} succeeds`, err === null, err ?? "");
  const p = await policies();
  ok(`apply #${i}: public read policy is gone`, !p.includes("Marketing media is publicly readable"));
  ok(`apply #${i}: admin policy survives (uploads still work)`, p.includes("Admins write marketing media"));
  ok(`apply #${i}: exactly one policy remains`, p.length === 1, p.join(","));
}

// The guards must actually fire — otherwise the DO block is decoration.
await db.exec(`DROP POLICY "Admins write marketing media" ON storage.objects`);
let e1 = null;
try { await db.exec(sql); } catch (e) { e1 = String(e.message ?? e); }
ok("RAISES if the admin policy is missing (would break uploads silently)",
   e1 !== null && /admin policy .* missing/i.test(e1), e1 ?? "no error");

await db.exec(`CREATE POLICY "Admins write marketing media" ON storage.objects
  FOR ALL USING (bucket_id='marketing-media') WITH CHECK (bucket_id='marketing-media')`);
await db.exec(`UPDATE storage.buckets SET public = false WHERE id='marketing-media'`);
let e2 = null;
try { await db.exec(sql); } catch (e) { e2 = String(e.message ?? e); }
ok("RAISES if the bucket stopped being public (Instagram fetch would break)",
   e2 !== null && /no longer public/i.test(e2), e2 ?? "no error");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
