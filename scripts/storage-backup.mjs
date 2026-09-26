#!/usr/bin/env node
/**
 * Q147: copy the uploaded files into the nightly encrypted backup, and prove in
 * the weekly restore drill that they restore. Logic: scripts/lib/storageBackup.mjs.
 *
 *   node scripts/storage-backup.mjs backup <outdir>
 *       env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF
 *       Lists storage.objects (read-only SQL through the Management API),
 *       downloads every object outside EXCLUDED_BUCKETS with the service key,
 *       writes <outdir>/<bucket>/<name> and <outdir>/manifest.json. Exit 1 on
 *       ANY failed download or size mismatch, or when no file was written.
 *
 *   node scripts/storage-backup.mjs verify <dir> <restored-rows.tsv>
 *       <restored-rows.tsv>: `bucket_id<TAB>name` per line, read from the
 *       RESTORED database. Exit 1 unless every manifest file is present and
 *       byte-identical, and every restored row outside the excluded buckets has
 *       its file.
 *
 * Never prints file contents or object names beyond a failing one.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { OBJECTS_SQL, backupObjects, verifyRestore } from "./lib/storageBackup.mjs";

const [mode, dir, rowsFile] = process.argv.slice(2);

async function mgmtSql(query) {
  const token = process.env.SUPABASE_ACCESS_TOKEN, ref = process.env.SUPABASE_PROJECT_REF;
  if (!token || !ref) throw new Error("needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function backup(outdir) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  const objects = await mgmtSql(OBJECTS_SQL);
  if (!Array.isArray(objects)) throw new Error("storage.objects listing was not an array");
  const download = async (bucket, name) => {
    const path = name.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${path}`, {
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const write = (rel, bytes) => {
    const p = join(outdir, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  };
  const { manifest, errors } = await backupObjects({ objects, download, write });
  writeFileSync(join(outdir, "manifest.json"), JSON.stringify({ takenAt: new Date().toISOString(), listed: objects.length, ...manifest }, null, 1));
  const bytes = manifest.files.reduce((n, f) => n + f.size, 0);
  console.log(`storage.objects listed: ${objects.length}; files written: ${manifest.files.length} (${bytes} bytes)`);
  console.log(`per bucket: ${JSON.stringify(manifest.byBucket)}; excluded: ${JSON.stringify(manifest.skipped)}`);
  if (errors.length) {
    for (const e of errors.slice(0, 20)) console.log(`::error::${e}`);
    throw new Error(`${errors.length} object(s) could not be backed up — a partial file backup is a failed one`);
  }
  if (!manifest.files.length) throw new Error("no files written: an empty file backup is a failed one");
}

function verify(root, tsv) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  const restoredRows = readFileSync(tsv, "utf8").split("\n").filter(Boolean).map((l) => {
    const [bucket_id, ...rest] = l.split("\t");
    return { bucket_id, name: rest.join("\t") };
  });
  const read = (rel) => (existsSync(join(root, rel)) ? new Uint8Array(readFileSync(join(root, rel))) : null);
  const { problems, checked, pointed } = verifyRestore({ manifest, restoredRows, read });
  console.log(`files byte-identical to the manifest: ${checked} of ${manifest.files.length}; restored rows needing a file: ${pointed}`);
  if (problems.length) {
    for (const p of problems.slice(0, 20)) console.log(`::error::${p}`);
    throw new Error(`${problems.length} storage restore problem(s)`);
  }
  if (!checked) throw new Error("the backup holds no files: nothing was proven");
}

try {
  if (mode === "backup" && dir) await backup(dir);
  else if (mode === "verify" && dir && rowsFile) verify(dir, rowsFile);
  else {
    console.error("usage: storage-backup.mjs backup <outdir> | verify <dir> <restored-rows.tsv>");
    process.exit(2);
  }
} catch (e) {
  console.error(`::error::${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
