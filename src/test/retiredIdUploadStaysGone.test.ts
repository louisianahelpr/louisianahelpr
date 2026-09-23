/**
 * CLASS CHECK — the retired "upload your ID to us" path stays retired (Q40).
 *
 * Users never send an ID to Helpr: Stripe Identity collects it (owner,
 * 2026-09-23). The legacy path survived anyway, in four layers that did not
 * know about each other:
 *   - Profile.tsx `handleIdUpload` → id-documents + profiles.id_document_url
 *     (+ idv_status 'pending'), unreachable but live code;
 *   - CompleteProfile / uploadProfileFiles `idFile` → id-documents, always null;
 *   - complete-signup `idBase64` → id-documents + id_document_url, and its
 *     `portfolioFiles` → user-documents + portfolio_urls, sent by no client;
 *   - admin People → Documents "ID Document" section, signing id-documents.
 *
 * INVENTORY: every non-test .ts/.tsx under src/ and supabase/functions/,
 * walked from the tree, comments blanked with the shared helper (string bodies
 * kept: the bucket name lives in a string). A hit on any RETIRED token is a
 * reader or writer of the retired path coming back.
 *
 * KNOWN_READERS is EXACT and two-way. Its one entry is the account purge: the
 * id-documents bucket still holds ONE object on prod (a real, non-seed
 * person's ID, measured 2026-09-23), so deleting an account must keep sweeping
 * that bucket until the owner decides what happens to it and the bucket goes.
 *
 * Not covered here: the database half (the column, the bucket's storage
 * policies). The column drop waits on that same owner decision; its migration
 * brings the migration-reading half of this guard.
 *
 * @mutate src/pages/AccountPending.tsx | const idDone = profile?.idv_status === "verified"; | const idDone = !!profile?.id_document_url \|\| profile?.idv_status === "verified";
 * @mutate supabase/functions/complete-signup/index.ts | if (phone) updateData.phone = phone; | if (phone) updateData.phone = phone; if (body.idBase64) updateData.id_document_url = "x";
 * @mutate src/components/admin/adminusers/useOpenProfile.ts | setViewProfile(profile); | setViewProfile(profile); void supabase.storage.from("id-documents").createSignedUrl("x", 1);
 * @mutate supabase/functions/_shared/accountPurge.ts | "id-documents", | "user-documents-2",
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const REPO = resolve(__dirname, "..", "..");
const ROOTS = ["src", "supabase/functions"];

/** Generated from the live schema; follows the column, not the app. */
const GENERATED = new Set(["src/integrations/supabase/types.ts"]);

/** Tokens that only the retired path uses. */
const RETIRED: { token: RegExp; what: string }[] = [
  { token: /\bid_document_url\b/, what: "profiles.id_document_url" },
  { token: /["'`]id-documents["'`]/, what: "the id-documents bucket" },
  { token: /\bidBase64\b/, what: "complete-signup's idBase64 upload" },
  { token: /\bportfolioFiles\b/, what: "complete-signup's portfolioFiles upload" },
];

/** `file :: what`, each with why it may stay. */
// @two-way src/test/retiredIdUploadStaysGone.test.ts:const staleReaders =
const KNOWN_READERS: Record<string, string> = {
  "supabase/functions/_shared/accountPurge.ts :: the id-documents bucket":
    "account deletion must still sweep the one object left in the bucket (Q40: owner decision pending)",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "node_modules" || entry === "test" || entry === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

function retiredHits(files: { file: string; text: string }[]): string[] {
  const hits = new Set<string>();
  for (const { file, text } of files) {
    if (GENERATED.has(file)) continue;
    const code = blankComments(text);
    for (const { token, what } of RETIRED) if (token.test(code)) hits.add(`${file} :: ${what}`);
  }
  return [...hits].sort();
}

describe("the retired ID-upload path stays gone (Q40)", () => {
  const files = ROOTS.flatMap((r) => walk(join(REPO, r))).map((f) => ({
    file: relative(REPO, f),
    text: readFileSync(f, "utf8"),
  }));

  it("walks the real tree (not vacuous)", () => {
    expect(files.length).toBeGreaterThan(800);
    expect(files.some((f) => f.file === "supabase/functions/complete-signup/index.ts")).toBe(true);
    expect(files.some((f) => f.file === "src/pages/Profile.tsx")).toBe(true);
  });

  it("no reader or writer of the retired path, beyond the exact known list", () => {
    const hits = retiredHits(files);
    const staleReaders = Object.keys(KNOWN_READERS).filter((k) => !hits.includes(k));
    expect(staleReaders, "stale KNOWN_READERS entry — remove it in the same commit").toEqual([]);
    expect(
      hits.filter((h) => !(h in KNOWN_READERS)),
      "the retired 'upload your ID to us' path is back — Stripe Identity collects the ID (Q40)",
    ).toEqual([]);
  });

  it("can fail: the deleted Profile.tsx writer is caught, a comment is not", () => {
    const planted = [
      "// id_document_url in a comment is fine",
      'await supabase.storage.from("id-documents").upload(path, file);',
      "await supabase.from(\"profiles\").update({ id_document_url: path, idv_status: \"pending\" });",
    ].join("\n");
    expect(retiredHits([{ file: "src/pages/Profile.tsx", text: planted }])).toEqual([
      "src/pages/Profile.tsx :: profiles.id_document_url",
      "src/pages/Profile.tsx :: the id-documents bucket",
    ]);
    expect(retiredHits([{ file: "src/x.ts", text: "// id_document_url, \"id-documents\"" }])).toEqual([]);
  });
});
