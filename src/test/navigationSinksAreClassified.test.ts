// @mutate src/components/profile/HelperWorkPhotos.tsx | href={safeDocumentUrl(url) ?? undefined} | href={url}
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

/**
 * CLASS CHECK: every navigation sink in src/ is either safe by construction or
 * classified here with the reason its value cannot carry a `javascript:` URL.
 *
 * Why: users can write URL-shaped values into their own rows with no shape
 * CHECK (measured live 2026-09-23 via information_schema.column_privileges +
 * pg_policies: profiles.avatar_url / portfolio_urls, jobs.photos, …). React 18
 * renders a `javascript:` href (a console warning, nothing more) and the CSP
 * allows 'unsafe-inline', so one such value bound to an `href` is stored XSS on
 * whoever clicks it — 3c81624d0 (admin document link) and the follow-up that
 * added this file (public profile "Recent work", admin People tab, job photo
 * strips) were all that shape.
 *
 * A "navigation sink" is where a string becomes a place the browser GOES:
 *   JSX `href={…}`, `window.open(…)`, `location.href = …`,
 *   `location.assign/replace(…)`, `openExternalUrl(…)`, `<el>.href = …`.
 * `<img src>` / `<video src>` are deliberately NOT sinks: no browser executes a
 * `javascript:` or SVG script from an image/media src.
 *
 * Safe by construction (auto-passes): a string literal; a template literal whose
 * text starts with a fixed scheme or a `/`; an UPPER_CASE constant;
 * `safeDocumentUrl(…)`; `undefined`. Anything else must appear in CLASSIFIED
 * below with its reason, and every CLASSIFIED entry must still exist (a stale
 * entry fails too, so the list cannot rot into a blanket pass).
 */
const SRC = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "test") continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}
const norm = (e: string) => e.replace(/\s+/g, " ").trim();

/**
 * Every navigation-sink expression in a source file, read from the TypeScript
 * AST (so comments, strings and regex literals can never be mistaken for code).
 */
function navigationSinks(source: string, fileName = "f.tsx"): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const push = (e: ts.Node | undefined) => e && out.push(norm(e.getText(sf)));
  const calleeText = (e: ts.Expression) => norm(e.getText(sf)).replace(/\?\./g, ".");
  const visit = (node: ts.Node) => {
    // <a href={…}>
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === "href" && node.initializer && ts.isJsxExpression(node.initializer)) {
      push(node.initializer.expression);
    }
    // window.open(…), location.assign/replace(…), openExternalUrl(…)
    if (ts.isCallExpression(node)) {
      const callee = calleeText(node.expression);
      if (/(^|\.)window\.open$/.test(callee)) push(node.arguments[0]);
      else if (/(^|\.)location\.(assign|replace)$/.test(callee)) push(node.arguments[0]);
      else if (callee === "openExternalUrl") push(node.arguments[0]);
    }
    // x.href = … / location.href = … / window.location = …
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      (node.left.name.text === "href" || (node.left.name.text === "location" && calleeText(node.left.expression) === "window"))
    ) {
      push(node.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** True when the expression's scheme is fixed by the author, not by data. */
function safeByConstruction(expr: string): boolean {
  if (/^(["'])[^"']*\1$/.test(expr)) return !/^["']\s*(javascript|vbscript|data):/i.test(expr);
  if (/^`(\/(?!\/)|https:\/\/|mailto:|tel:|sms:|helpr:)/i.test(expr)) return true;
  if (/^[A-Z][A-Z0-9_]*$/.test(expr)) return true;
  // Exactly `safeDocumentUrl(x)` or `safeDocumentUrl(x) ?? undefined` — not
  // `safeDocumentUrl(x) ?? raw`, which would hand the raw value back.
  if (/^safeDocumentUrl\([^()]*\)( \?\? undefined)?$/.test(expr)) return true;
  if (expr === "undefined") return true;
  return false;
}

/**
 * `file::expression` → why this value cannot carry a script scheme. Keep the
 * reason specific (where the value comes from); "trusted" is not a reason.
 */
const STRIPE_EDGE_URL = "a Stripe/checkout URL returned by our own edge function (server-built, not a user-writable column)";
const STORAGE_SIGNED = "supabase.storage createSignedUrl() output: always https on this project's own origin";
const PROOF_SIGNED = "useProofPhotoUrls(): a signed proof-photos URL, or the stored value only when it matches ^https?:// (signProofPhotoUrls), else null";
const OBJECT_URL = "URL.createObjectURL() of a Blob the app built itself (blob: on our own origin)";
const MAPS = "mapsSearchUrl(): a fixed https://maps.apple.com / maps:// / geo: prefix + encodeURIComponent(address)";

const CLASSIFIED: Record<string, string> = {
  // --- stored values, sanitized upstream of the sink ---
  "components/AttachmentLink.tsx::signed": "getAttachmentSignedUrl(): isStorageObjectPath-gated createSignedUrl output, else null",
  "components/MessageAttachment.tsx::url": "thumbUrl / getMessageAttachmentSignedUrl(): isStorageObjectPath-gated createSignedUrl output, else null",
  "components/DisputeTimelineDialog.tsx::src ?? undefined": `${PROOF_SIGNED}; input is partitionEvidenceUrls().trusted`,
  "components/admin/adminDisputes/DisputeCard.tsx::src ?? undefined": `${PROOF_SIGNED}; input is partitionEvidenceUrls().trusted`,
  "components/PhotoProof.tsx::beforeSrcs[i] ?? undefined": PROOF_SIGNED,
  "components/PhotoProof.tsx::afterSrcs[i] ?? undefined": PROOF_SIGNED,
  "components/activity/HelperRevisionCard.tsx::url": PROOF_SIGNED,
  "components/admin/AdminCredentialQueue.tsx::signedUrl": "SignedOpenLink state: safeDocumentUrl(path) or createSignedUrl output, nothing else is ever set",
  "components/admin/AdminCredentialQueue.tsx::safe": "const safe = safeDocumentUrl(path) on the line above",
  "components/admin/AdminCredentialQueue.tsx::data.signedUrl": STORAGE_SIGNED,
  "components/profile/CredentialsTab.tsx::safe": "const safe = safeDocumentUrl(path) on the line above",
  "components/profile/CredentialsTab.tsx::signed.signedUrl": STORAGE_SIGNED,
  "components/messages/MessageBubble.tsx::url": "isSafeHttpsUrl(url) (new URL(url).protocol === 'https:') returns inert text first",
  // --- app-built URLs, no stored value in the scheme position ---
  "components/activity/JobCardMetaRow.tsx::mapHref": MAPS,
  "components/activity/appliedJobCard/DirectionsButton.tsx::href": MAPS,
  "components/ReferralSection.tsx::href": "`sms:?&body=${encodeURIComponent(...)}` built on the line above",
  "components/admin/AdminIDVReview.tsx::stripeSessionUrl(r.idv_session_id)": "fixed https://dashboard.stripe.com/... prefix + session id",
  "components/dashboard/FilterSheet.tsx::signupHref": "signupUrlFor(): \"/signup\" or `/signup?redirect=${encodeURIComponent(safeInternalRedirect(...))}`",
  "components/postjob/MaterialsPanel.tsx::item.searchUrl": "src/lib/materialsGuide.ts static https://www.amazon.com/... literals",
  "pages/strSettings/AddCalendarForm.tsx::helpUrl": "PLATFORM_HELP static literal map (pages/strSettings/types)",
  "pages/legal/PrivacySection.tsx::`#${DATA_EXPORT_ANCHOR}`": "in-page #anchor built from a constant",
  "hooks/usePageMeta.ts::meta.canonical": "<link rel=canonical> href set from page-level static meta, not a navigation",
  "lib/calendarExport.ts::objectUrl": OBJECT_URL,
  "lib/nativeShare.ts::objectUrl": OBJECT_URL,
  "lib/chunkReload.ts::url.toString()": "new URL(window.location.href) with a _v param: the current page, reloaded",
  "lib/nativeReturnBounce.ts::target": "`${NATIVE_RETURN_SCHEME}://${url.pathname}${url.search}`: fixed app scheme",
  "lib/openExternalUrl.ts::url": "the helper itself; every caller is classified below",
  // --- openExternalUrl callers: edge-function-returned Stripe URLs ---
  "components/AwardGateDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/CompletionPrompts.tsx::data.url": STRIPE_EDGE_URL,
  "components/IDVPromptDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/JobBoostDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/PayoutSetupForm.tsx::data.url": STRIPE_EDGE_URL,
  "components/TipDialog.tsx::data.url": STRIPE_EDGE_URL,
  "components/profile/BackgroundCheckCard.tsx::data.url": STRIPE_EDGE_URL,
  "components/profile/SubscriptionTab.tsx::data.url": STRIPE_EDGE_URL,
  "hooks/useFundExistingJob.ts::url": STRIPE_EDGE_URL,
  "pages/GiftCard.tsx::data.url": STRIPE_EDGE_URL,
  "pages/postjob/useJobSubmit.ts::paymentUrl": STRIPE_EDGE_URL,
};

function unclassifiedSinks(files: { rel: string; source: string }[]) {
  const unclassified: string[] = [];
  const seen = new Set<string>();
  for (const { rel, source } of files) {
    for (const expr of navigationSinks(source, rel)) {
      const key = `${rel}::${expr}`;
      seen.add(key);
      if (safeByConstruction(expr) || key in CLASSIFIED) continue;
      unclassified.push(key);
    }
  }
  return { unclassified, seen };
}

function srcFiles() {
  return walk(SRC).map((f) => ({ rel: f.slice(SRC.length + 1), source: readFileSync(f, "utf8") }));
}

describe("every navigation sink in src/ is safe by construction or classified", () => {
  const { unclassified, seen } = unclassifiedSinks(srcFiles());

  it("finds the sinks (the scan is not silently empty)", () => {
    expect(seen.size).toBeGreaterThanOrEqual(40);
  });

  it("no unclassified href / window.open / location / openExternalUrl value", () => {
    expect(unclassified).toEqual([]);
  });

  it("is RED on the shapes that shipped (raw user column in an href)", () => {
    const asShipped = [
      // HelperWorkPhotos (public profile) and JobCardPhotoStrip, before the fix
      `{urls.map((url, i) => (<a key={url} href={url} target="_blank">`,
      // DocumentsTab / DetailHeader, before the fix
      `<a\n  href={viewProfile.avatar_url}\n  target="_blank"\n>`,
      `<a href={row.external_url} target="_blank">`,
      `window.open(path, "_blank", "noopener");`,
      `window.location.href = profile.website;`,
    ];
    for (const s of asShipped) {
      const { unclassified: u } = unclassifiedSinks([{ rel: "fixture.tsx", source: s }]);
      expect(u, s).toHaveLength(1);
    }
    for (const s of [
      `<a href={safeDocumentUrl(url) ?? undefined}>`,
      `<a href={\`/user/\${id}\`}>`,
      `<a href="https://x.example">`,
      `<a href={APP_STORE_URL}>`,
      // a comment mentioning a sink is not a sink
      `// window.location.href = data.url`,
    ]) {
      expect(unclassifiedSinks([{ rel: "fixture.tsx", source: s }]).unclassified, s).toEqual([]);
    }
    // A template literal that lets DATA pick the scheme is not safe.
    expect(safeByConstruction("`${row.url}`")).toBe(false);
    expect(safeByConstruction('"javascript:alert(1)"')).toBe(false);
    expect(safeByConstruction("safeDocumentUrl(url) ?? url")).toBe(false);
  });

  it("every CLASSIFIED entry still exists (no stale blanket passes)", () => {
    expect(Object.keys(CLASSIFIED).filter((k) => !seen.has(k))).toEqual([]);
  });
});
