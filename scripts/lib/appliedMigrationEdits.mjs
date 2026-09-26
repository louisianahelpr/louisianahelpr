/**
 * Q719 — an applied migration's SQL is never edited in place.
 *
 * db-deploy applies a migration once, by version. Editing the file afterwards
 * changes nothing on prod, but the repo now claims it did: 42a7962cc edited
 * three applied files (a Q298 early return, a cron_record_work wrapper, the
 * work_visibility columns) and none of it reached the database that way.
 * The fix for an applied migration is a NEW migration.
 *
 * Allowed without ceremony: a diff that only touches comments or whitespace.
 * Allowed with an acknowledgement: a replay-safety guard (the file must still
 * replay cleanly from zero), listed in scripts/audit/applied-migration-edits.json
 * with the sha256 of the file as it now stands and the reason. The list is
 * exact: an entry whose hash no longer matches its file is stale and fails.
 */
import { createHash } from "node:crypto";

/** SQL with `--` and block comments removed and whitespace collapsed. */
export function sqlCode(text) {
  let out = "";
  let i = 0;
  let quote = false;
  while (i < text.length) {
    const c = text[i];
    if (quote) {
      out += c;
      if (c === "'") quote = false;
      i++;
    } else if (c === "'") {
      quote = true;
      out += c;
      i++;
    } else if (c === "-" && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end < 0 ? text.length : end + 2;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * @param edits  [{ file, before, after }] for migrations that existed at the
 *               diff base (after === null for a deleted file)
 * @param acks   [{ file, sha256, reason }]
 * @param current  file -> current content (for stale-ack detection), or null if absent
 */
export function appliedEditFindings(edits, acks, current) {
  const findings = [];
  for (const e of edits) {
    if (e.after === null) {
      findings.push(`${e.file}: an applied migration was deleted`);
      continue;
    }
    if (sqlCode(e.before) === sqlCode(e.after)) continue;
    const ack = acks.find((a) => a.file === e.file && a.sha256 === sha256(e.after));
    if (!ack) findings.push(`${e.file}: SQL of an applied migration changed (write a new migration, or acknowledge a replay-safety guard with sha256 ${sha256(e.after)})`);
  }
  for (const a of acks) {
    if (!a.reason || !String(a.reason).trim()) findings.push(`${a.file}: acknowledgement has no reason`);
    const text = current(a.file);
    if (text == null) findings.push(`${a.file}: acknowledged file no longer exists (stale entry)`);
    else if (sha256(text) !== a.sha256) findings.push(`${a.file}: acknowledgement is stale (file sha256 is ${sha256(text)})`);
  }
  return findings;
}
