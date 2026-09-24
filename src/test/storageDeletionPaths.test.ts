/**
 * CLASS GUARD: a code path that deletes a row which owns storage must remove
 * that storage too.
 *
 * WHAT IT CATCHES: the 2026-09-14 storage audit
 * (docs/archive/storage-audit-2026-09-14.md) found 32 orphaned files, 10.3 MB:
 * avatars and credential scans of deleted users, proof photos / chat
 * attachments / application attachments of deleted jobs, and a chat attachment
 * of a deleted message. Every one came from a path that removed the ROW and
 * not the FILE: Messages deleteMessage, the post-job checkout cleanup, the
 * jobs purge_user_data() deletes, and the prod scripts' teardowns.
 *
 * HOW: the inventory is derived from source, never listed. Every file under
 * src/, supabase/functions/ and scripts/ is scanned for
 *   - a jobs row delete      (.from("jobs")…delete(), REST `jobs?…` DELETE,
 *                             or an rpc() of a SQL function whose LATEST
 *                             migration definition runs DELETE FROM jobs)
 *   - a messages row delete  (.from("messages")…delete(), REST `messages?…` DELETE)
 *   - a user delete          (auth.admin.deleteUser, DELETE /auth/v1/admin/users/<id>)
 * and each hit must reference that class's storage removal, or be EXEMPT by
 * file with a reason. A red proof: STORAGE_PATHS_ROOT=<checkout of 028f2e308>.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { jobMediaPrefixes as denoPrefixes, removeJobMedia } from "../../supabase/functions/_shared/jobMedia";
import { jobMediaPrefixes as nodePrefixes, messageAttachmentPath } from "../../scripts/lib/jobMediaRest.mjs";
import { messageAttachmentObjectPath } from "@/lib/storageCleanup";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = process.env.STORAGE_PATHS_ROOT ?? resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|sh)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = ["src", "supabase/functions", "scripts"].flatMap((d) => walk(join(ROOT, d)));
const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(ROOT, p);

/**
 * The source with COMMENTS and IMPORT STATEMENTS blanked (blanked, not deleted,
 * so offsets and line numbers survive).
 *
 * WHY (vacuity proof, 2026-09-21): `rule.removal` was tested against the raw
 * file, so the `import { … purgeAccount } from "../_shared/accountPurge.ts"`
 * line alone satisfied it. Replacing the whole
 * `const purge = await purgeAccount(supabaseAdmin, userId);` in
 * supabase/functions/admin-delete-user/index.ts with a stub — an admin deleting
 * an account removes the auth row and leaves every avatar, ID document,
 * credential scan and proof photo in storage forever — left this guard GREEN
 * (12 passed). Same shape as the `retireStuckSeedSplits()` hole: a DEFINITION
 * or IMPORT satisfying an assertion that meant a CALL. A comment would have
 * done it too.
 *
 * Only `//` at the start of a line is treated as a comment, so a `https://`
 * inside a string literal is left alone.
 */
const blank = (m: string) => m.replace(/[^\n]/g, " ");
function callSites(src: string): string {
  // Comments via the string-aware scanner (a regex cannot tell it is inside a
  // string, so a `/`+`*` in a URL or literal blanks real code to the next
  // `*`+`/`). The two import rules stay as they are — they are about imports,
  // not comments, and an import line contains no comment syntax to be fooled by.
  return blankComments(src)
    .replace(/(^|\n)[ \t]*import\s[\s\S]*?from\s*["'][^"']+["'];?/g, blank)
    .replace(/(^|\n)[ \t]*import\s*\{[\s\S]*?\}\s*from[^\n]*/g, blank);
}

/** SQL functions whose latest definition deletes from jobs. */
function jobDeletingFunctions(): string[] {
  const dir = join(ROOT, "supabase/migrations");
  const latest = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = read(join(dir, f));
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?"?(\w+)"?\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) latest.set(m[1].toLowerCase(), m[4]);
  }
  return [...latest].filter(([, body]) => /delete\s+from\s+(?:public\.)?jobs\b/i.test(body)).map(([n]) => n);
}

interface Rule {
  name: string;
  /** Minimum number of files this rule must still match. */
  floor: number;
  hits: (src: string) => boolean;
  removal: RegExp;
  exempt: Record<string, string>;
}

const JOB_FNS = jobDeletingFunctions();

const RULES: Rule[] = [
  {
    name: "jobs row delete removes job media",
    floor: 14,
    hits: (src) =>
      /from\(\s*["']jobs["']\s*\)(?:(?!;)[\s\S]){0,120}?\.delete\(/.test(src) ||
      /jobs\?[^`"']*`[^)]*\{\s*method:\s*["']DELETE["']/.test(src) ||
      /\bdel\(\s*(?:s,\s*)?[`"']jobs[?"'`]/.test(src) ||
      /rest\/v1\/jobs\?[^`]*`,\s*\{\s*method:\s*["']DELETE["']/.test(src) ||
      JOB_FNS.some((fn) => new RegExp(`rpc\\(\\s*["']${fn}["']`).test(src)),
    removal: /removeJobMedia|removeJobPhotos|removeMediaOfDeletedJobs/,
    exempt: {
      "scripts/probes/admin-dispute-race.prod.mjs": "creates a bare job with no uploads; the weekly storage-orphan-sweep is the net",
      "scripts/probes/release-race.prod.mjs": "creates a bare job with no uploads; the weekly storage-orphan-sweep is the net",
      "scripts/probes/mint-funded-seed-jobs.prod.mjs": "deletes a job it just inserted, before any upload; the weekly sweep is the net",
      "scripts/probes/admin-release-vs-refund.prod.mjs": "tears down the minted funded seed job it raced; no uploads are ever made on it; the weekly storage-orphan-sweep is the net",
      "scripts/probes/dispute-open-race.prod.mjs": "creates a bare job with no uploads (evidence urls are example.invalid strings, never storage objects); the weekly storage-orphan-sweep is the net",
      "scripts/probes/settle-dispute-race.prod.mjs": "creates a bare job with no uploads; the weekly storage-orphan-sweep is the net",
      "scripts/probes/completion-race.prod.mjs": "creates a bare job with no uploads; the weekly storage-orphan-sweep is the net",
      "scripts/probes/direct-patch-hire.prod.mjs": "Q346 probe: creates bare seed jobs with no photo column and never touches storage; the weekly storage-orphan-sweep is the net",
      "scripts/probes/recurring-helper-patch.prod.mjs": "Q356 probe: creates bare seed jobs with no photo column and never touches storage; the weekly storage-orphan-sweep is the net",
      "scripts/probes/messages-inbox-states.prod.mjs": "creates two bare `unpaid` jobs for the inbox screenshot states and deletes them in `restore`; the POST body carries no photo column and nothing in the file ever touches storage, so those job ids own no object. The weekly storage-orphan-sweep is the net",
    },
  },
  {
    name: "messages row delete removes its attachment",
    floor: 5,
    hits: (src) =>
      /from\(\s*["']messages["']\s*\)(?:(?!;)[\s\S]){0,120}?\.delete\(/.test(src) ||
      // The REST spelling, with or without the `rest/v1/` prefix. The prefixed
      // form was the only one here until 2026-09-19, when
      // `messages-inbox-states.prod.mjs` landed a bare `rest(\`messages?…\`,
      // { method: "DELETE" })` — a real hit this rule walked straight past.
      // Only the JOBS rule caught that file, and only because its own matcher
      // already had the unprefixed form. Same shape as the jobs one now.
      // `[^`]*`, not `[^`"']*`: the URL is a template literal, so an
      // interpolation inside it may legitimately contain a quote. It does —
      // `scripts/audit/two-account-journey.mjs` deletes its own message rows
      // through
      //   `${SUPABASE_URL}/rest/v1/messages?content=like.${encodeURIComponent(MARK + "%")}`
      // and the `"` in `"%"` made the old class fail, so a REAL messages
      // DELETE was invisible to this rule and its exemption looked stale
      // (found 2026-09-21 by the stale-exemption check below).
      /messages\?[^`]*`[^)]*\{\s*method:\s*["']DELETE["']/.test(src) ||
      /\bdel\(\s*(?:s,\s*)?[`"']messages[?"'`]/.test(src),
    removal: /removeMessageAttachment|collectMessageAttachments|removeJobMedia/,
    exempt: {
      "scripts/audit/two-account-journey.mjs": "deletes only text messages it typed (content marker); it sends no attachment",
      "scripts/probes/messages-inbox-states.prod.mjs": "deletes only the messages it INSERTED itself, on the two jobs it created; its insert body is { job_id, sender_id, receiver_id, content, read } — no attachment_url, so those rows own no object",
    },
  },
  {
    name: "user delete removes the user's storage",
    floor: 4,
    hits: (src) =>
      /auth\.admin\.deleteUser\(/.test(src) ||
      /auth\/v1\/admin\/users\/\$\{[^}]+\}`,\s*\{\s*method:\s*["']DELETE["']/.test(src),
    removal: /purgeAccount|removeUserStorageRest/,
    exempt: {},
  },
];

describe("storage deletion paths (class guard)", () => {
  it("finds the SQL job-deleting function the purge calls (inventory is live)", () => {
    expect(JOB_FNS).toContain("purge_user_data");
  });

  // An exemption whose premise nobody checks is a hole with a reason attached.
  // Every exempt path must still BE a hit: once a file stops deleting rows the
  // exemption is dead text, and dead text is how a real offender gets waved
  // through later under a name that was once legitimate.
  it("no exemption is stale — every exempt file still matches its rule", () => {
    const stale: string[] = [];
    for (const rule of RULES) {
      const hits = new Set(files.filter((f) => rule.hits(read(f))).map(rel));
      for (const path of Object.keys(rule.exempt)) if (!hits.has(path)) stale.push(`${rule.name}: ${path}`);
    }
    expect(stale, "these exemptions no longer describe anything — delete them").toEqual([]);
  });

  for (const rule of RULES) {
    it(rule.name, () => {
      const hits = files.filter((f) => rule.hits(read(f)));
      // Floored at the real count, not at 1: a matcher that rots down to a
      // single hit would otherwise still look healthy.
      expect(hits.length, `${rule.name}: inventory found nothing — the matcher is broken`).toBeGreaterThanOrEqual(
        rule.floor,
      );
      // `callSites()`, not `read()`: an import or a comment naming the removal
      // helper is not a call to it. See the note on callSites above.
      const offenders = hits.filter((f) => !rule.removal.test(callSites(read(f))) && !rule.exempt[rel(f)]).map(rel);
      expect(offenders, `${rule.name}: these delete rows but leave the files`).toEqual([]);
    });
  }
});

describe("job media prefixes", () => {
  const job = {
    id: "a5eed000-0000-4000-8000-000000000001",
    customer_id: "76b07824-9b41-4741-a4c4-4f8de362f682",
    helper_id: "b0f6ebec-ab03-40fe-a33c-3cc69ed05f7e",
  };

  it("Deno and Node twins agree", () => {
    expect(nodePrefixes(job)).toEqual(denoPrefixes(job));
  });

  it("covers every job-keyed upload scheme from the audit", () => {
    const got = denoPrefixes(job).map((p) => `${p.bucket}/${p.prefix}`);
    expect(got).toEqual(
      expect.arrayContaining([
        `job-photos/${job.id}`,
        `proof-photos/${job.id}`,
        `message-attachments/${job.id}`,
        `message-attachments/voice-notes/${job.id}`,
        `proof-photos/${job.customer_id}/disputes/${job.id}`,
        `application-attachments/${job.helper_id}/${job.id}`,
      ]),
    );
  });

  it("a non-UUID job id yields nothing (never a bucket-wide prefix)", () => {
    expect(denoPrefixes({ id: "" })).toEqual([]);
    expect(nodePrefixes({ id: "../x" })).toEqual([]);
  });
});

describe("removeJobMedia", () => {
  const job = { id: "a5eed000-0000-4000-8000-000000000001" };

  it("never throws, and reports a remove that deleted fewer than asked", async () => {
    const client = {
      storage: {
        from: (bucket: string) => ({
          list: async (prefix: string) =>
            bucket === "proof-photos" && prefix === job.id
              ? { data: [{ name: "a.png", id: "1" }, { name: "b.png", id: "2" }], error: null }
              : bucket === "job-photos"
              ? { data: null, error: { message: "boom" } }
              : { data: [], error: null },
          remove: async () => ({ data: [{ name: "a.png" }], error: null }),
        }),
      },
    };
    const r = await removeJobMedia(client, [job], "test");
    expect(r.removed).toBe(1);
    expect(r.failures.join()).toMatch(/removed 1 of 2/);
    expect(r.failures.join()).toMatch(/job-photos.*boom/);
  });
});

describe("attachment path from attachment_url", () => {
  const path = "a22c2df1-10a9-415b-889b-c35e25b17cdd/71c56dfb-b326-4010-b960-b18dd3966e7f/3e30e9e2-x.png";
  it.each([
    [path, path],
    [`https://x.supabase.co/storage/v1/object/sign/message-attachments/${path}?token=t`, path],
    ["https://elsewhere.example/x.png", null],
    [null, null],
  ])("%s", (input, expected) => {
    expect(messageAttachmentObjectPath(input)).toBe(expected);
    expect(messageAttachmentPath(input)).toBe(expected);
  });
});

// PROVEN RED 2026-09-21 — and GREEN before the callSites() hardening above,
// which is the whole finding: removing the ONLY purgeAccount() call from
// admin-delete-user (an admin deleting an account takes the auth row and
// leaves every avatar, ID document, credential scan and proof photo in storage
// forever) passed 12/12, because the import line satisfied the removal regex.
// @mutate supabase/functions/admin-delete-user/index.ts | const purge = await purgeAccount(supabaseAdmin, userId); | const purge = { failures: [] };
// @mutate src/pages/Messages.tsx | await removeMessageAttachment(messages.find((m) => m.id === messageId)?.attachment_url, messageId); | 0;
