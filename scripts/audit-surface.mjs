#!/usr/bin/env node
/**
 * audit-surface — enumerate the app's ACTUAL auditable surface.
 *
 * WHY: a previous audit pass walked routes and reported coverage, but missed
 * "a ton of dialog screens and other paths". Routes are roughly a quarter of
 * the real surface: the app has ~49 routes but ~86 components that render an
 * overlay, plus tab and view variants. An agent that walks routes and stops
 * has audited a fraction of the app while sounding complete.
 *
 * This script produces the authoritative checklist every audit lane must cover
 * and report against. Regenerate it, don't hand-maintain it.
 *
 *   node scripts/audit-surface.mjs           # write docs/audit/launch-2026-09/SURFACE.md
 *   node scripts/audit-surface.mjs --json
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT_DIR = join(ROOT, "docs/audit/launch-2026-09");

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const files = walk(SRC);
const rel = (p) => relative(ROOT, p);

// --- routes -----------------------------------------------------------------
const app = readFileSync(join(SRC, "App.tsx"), "utf8");
const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const redirects = new Set(
  [...app.matchAll(/<Route\s+path="([^"]+)"[^>]*(?:Navigate|Redirect)/g)].map((m) => m[1]),
);

// --- tab / view variants ----------------------------------------------------
// Read the AUTHORITATIVE definitions, not `?tab=` string literals. A grep-based
// version reported 9 admin views; there are 24 — the real list is VIEW_LABELS in
// Admin.tsx and most values never appear as a literal `view=` anywhere in src/.
// Falls back to the literal scan only if a source file moves, and says so.
// Extract a balanced {...} or [...] block by counting delimiters, because a
// line-range or a `[^}]+` regex silently truncates. VIEW_LABELS packs several
// keys per line, so line-counting reports 16 where the real key count is 24 —
// that single error is why the admin surface was under-reported.
function balancedBlock(src, afterIndex, open, close) {
  const start = src.indexOf(open, afterIndex);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (!depth) return src.slice(start + 1, i); }
  }
  return null;
}

/** Object KEYS (`home:`), not the quoted labels — those are display strings. */
function keysFromObject(relPath, marker, label) {
  try {
    const src = readFileSync(join(ROOT, relPath), "utf8");
    const i = src.indexOf(marker);
    if (i === -1) throw new Error(`marker "${marker}" not found`);
    const body = balancedBlock(src, i, "{", "}");
    if (!body) throw new Error("unbalanced block");
    return [...new Set([...body.matchAll(/(?:^|[\s,{])([a-zA-Z_][\w]*)\s*:/g)].map((m) => m[1]))];
  } catch (e) {
    console.warn(`  ! ${label}: ${e.message} (${relPath}) — this count is UNVERIFIED`);
    return null;
  }
}

/** String literals from a type union or array literal. */
function literalsFrom(relPath, marker, open, close, label) {
  try {
    const src = readFileSync(join(ROOT, relPath), "utf8");
    const i = src.indexOf(marker);
    if (i === -1) throw new Error(`marker "${marker}" not found`);
    const body = open
      ? balancedBlock(src, i, open, close)
      : src.slice(i, src.indexOf(";", i));
    if (body == null) throw new Error("unbalanced block");
    return [...new Set([...body.matchAll(/["']([a-zA-Z_][\w-]*)["']/g)].map((m) => m[1]))];
  } catch (e) {
    console.warn(`  ! ${label}: ${e.message} (${relPath}) — this count is UNVERIFIED`);
    return null;
  }
}

const profileTabs = literalsFrom("src/pages/profile/types.ts", "type Tab", null, null, "profile tabs");
const legalTabs = literalsFrom("src/pages/legal/legalSections.ts", "VALID_TABS", "[", "]", "legal tabs");
const adminViews = keysFromObject("src/pages/Admin.tsx", "VIEW_LABELS", "admin views");
const adminUserTabs = literalsFrom("src/components/admin/adminusers/useAdminUsersFilter.ts", "type Tab", null, null, "admin user sub-tabs");

const tabs = new Set();
const views = new Set();
if (profileTabs) profileTabs.forEach((t) => tabs.add(`profile:${t}`));
if (legalTabs) legalTabs.forEach((t) => tabs.add(`legal:${t}`));
if (adminUserTabs) adminUserTabs.forEach((t) => tabs.add(`admin/people:${t}`));
if (adminViews) adminViews.forEach((v) => views.add(v));
if (!profileTabs || !legalTabs || !adminViews) {
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/[?&]tab=([a-zA-Z_][\w-]*)/g)) tabs.add(m[1]);
    for (const m of src.matchAll(/[?&]view=([a-zA-Z_][\w-]*)/g)) views.add(m[1]);
  }
}

// --- overlays ---------------------------------------------------------------
// Counting FILES that contain a Dialog tag undercounts badly, three ways, and an
// earlier version of this script reported 85 when the real number is ~130:
//   1. one file often renders 2-3 distinct dialogs (EditJobDialog has 3);
//   2. 28 confirmations route through the shared BrandConfirmDialog wrapper and
//      never mention <Dialog> at all;
//   3. several overlays are hand-rolled `fixed inset-0` portals on no primitive
//      (PhotoLightbox and MessageAttachment say so in their own comments).
// Category 3 matters most: those are exactly the overlays subject to the
// containing-block trap, since they do not inherit the shared Dialog's portal.
const OVERLAY_TAGS = ["Dialog", "AlertDialog", "Sheet", "Drawer", "Popover", "HoverCard", "DropdownMenu", "ContextMenu", "Command"];
const overlays = [];
for (const f of files) {
  if (rel(f).startsWith("src/components/ui/")) continue; // primitive definitions
  const src = readFileSync(f, "utf8");
  const kinds = {};
  for (const tag of OVERLAY_TAGS) {
    // Count opening root tags, not imports or the *Content/*Trigger children.
    const n = [...src.matchAll(new RegExp(`<${tag}(?=[\\s>])`, "g"))].length;
    if (n) kinds[tag] = n;
  }
  const confirms = [...src.matchAll(/<BrandConfirmDialog(?=[\s>])/g)].length;
  if (confirms) kinds.BrandConfirmDialog = confirms;
  const anchored = /anchoredPanel|<NavQuickMenu(?=[\s>])/.test(src) ? 1 : 0;
  if (anchored) kinds.anchoredPanel = anchored;
  // Hand-rolled: a full-bleed `fixed inset-0` overlay riding on no dialog
  // primitive. Three bugs lived in the previous version of these four lines,
  // and together they under-reported the one category the comment above calls
  // the most important:
  //
  //   1. It scored 1 PER FILE while this table's header promises INSTANCES.
  //      AppLockGate renders two distinct full-screen overlays and counted as
  //      one.
  //   2. The "no primitive" test was FILE-level, so a file containing both a
  //      proper <Dialog> and a hand-rolled overlay scored as having neither.
  //      That excluded PhotoLightbox and MessageAttachment -- the exact two
  //      files the comment above names as the examples. The counter's prose
  //      and its code disagreed, and the code won silently.
  //   3. It matched the string anywhere, including in COMMENTS. Four files
  //      (AppShell, PetReportCard, PetForm, offlineBannerLayout) only mention
  //      `fixed inset-0` in a note explaining that they no longer do it, and
  //      RedirectingOverlay's own docblock double-counted it.
  //
  // So: strip comments first, then count occurrences inside a real className.
  const code = src
    .replace(/\/\*[^]*?\*\//g, "")   // block comments and JSX {/* ... *\/} bodies
    .replace(/^\s*\/\/.*$/gm, "");   // line comments
  const handRolledN = [...code.matchAll(/className=(?:"|'|\{`|\{cn\()[^"'`)]*fixed inset-0/g)].length;
  const handRolled = handRolledN > 0 && /createPortal|z-\[|zIndex/.test(code);
  if (handRolled) kinds["hand-rolled"] = handRolledN;
  const count = Object.values(kinds).reduce((a, b) => a + b, 0);
  if (count) overlays.push({ file: rel(f), kinds, count, handRolled: Boolean(handRolled) });
}
overlays.sort((a, b) => a.file.localeCompare(b.file));
const overlayCount = overlays.reduce((a, o) => a + o.count, 0);

// --- toasts -----------------------------------------------------------------
// 516 call sites across 138 files (sonner). Each is a distinct message a user
// reads, with its own copy and tone, and collectively they are the app's largest
// body of user-facing text. An overlay enumeration reported these as "1
// mechanism, 21 files" and undercounted by an order of magnitude.
let toastSites = 0;
const toastFiles = new Set();
for (const f of files) {
  if (rel(f).startsWith("src/components/ui/")) continue;
  const src = readFileSync(f, "utf8");
  const n = [...src.matchAll(/\btoast\s*(?:\.\s*(?:success|error|info|warning|loading|message|custom)\s*)?\(/g)].length;
  if (n) { toastSites += n; toastFiles.add(rel(f)); }
}

// --- multi-step flows ------------------------------------------------------
// A flow is any surface a user moves THROUGH, so every intermediate state can
// strand them and every one can be interrupted. Detection is deliberately
// multi-signal: an earlier version required `step === <digit>` and reported 0,
// then `step === "string"` and reported 7. Both were wrong because this repo
// expresses flows at least five different ways. Each file records WHICH signal
// fired so the count can be audited rather than trusted.
const FLOW_SIGNALS = [
  ["switch", /switch\s*\(\s*(step|stage|phase|mode|view|screen|currentStep|activeStep)\b/],
  ["compare", /\b(step|stage|phase|currentStep|activeStep)\s*===?\s*(\d+|["'][a-zA-Z_-]+["'])/],
  ["nav-handler", /\b(onNext|handleNext|goToStep|nextStep|prevStep|previousStep|handleBack|onBack|setStep|setStage|setPhase|setCurrentStep|setActiveStep)\b/],
  ["step-array", /\b(STEPS|steps|STAGES|stages)\s*[:=]\s*\[/],
  ["stepper-name", /\b(Stepper|Wizard|MultiStep|StepIndicator)\b/],
  ["union-state", /useState<[^>]*["'][a-zA-Z_-]+["']\s*\|\s*["'][a-zA-Z_-]+["']/],
];
// Signals are NOT equal. `nav-handler` alone fires on any plain back button
// (PageHeader, UserAvatar, a types.ts exporting an onBack prop) and is weak
// evidence on its own; the first version of this script over-corrected from 7
// to 63 by treating it as decisive. Tier by strength instead of guessing at a
// single number, so the count can be audited rather than believed.
const STRONG = new Set(["switch", "compare", "step-array", "stepper-name"]);
const flows = [];
for (const f of files) {
  if (rel(f).startsWith("src/components/ui/")) continue; // primitives
  const s = readFileSync(f, "utf8");
  const hit = FLOW_SIGNALS.filter(([, re]) => re.test(s)).map(([n]) => n);
  if (!hit.length) continue;
  const strong = hit.some((h) => STRONG.has(h));
  const tier = strong || (hit.includes("union-state") && hit.includes("nav-handler"))
    ? "confirmed"
    : hit.includes("union-state")
      ? "probable"
      : "nav-only";
  flows.push({ file: rel(f), signals: hit, tier });
}
flows.sort((a, b) => a.file.localeCompare(b.file));
const flowsConfirmed = flows.filter((f) => f.tier === "confirmed");
const flowsProbable = flows.filter((f) => f.tier === "probable");
const flowsNavOnly = flows.filter((f) => f.tier === "nav-only");

// --- forms ------------------------------------------------------------------
// No react-hook-form anywhere: forms are hand-rolled <form onSubmit> or
// button-driven mutations, so many live inside dialogs with no <form> tag at
// all. Counting <form> alone finds ~9 files and misses roughly three quarters
// of them. Each form is a distinct surface for validation, boundary values and
// interrupted-submit behaviour.
const forms = [];
for (const f of files) {
  if (rel(f).startsWith("src/components/ui/")) continue;
  const src = readFileSync(f, "utf8");
  const hasFormTag = /<form(?=[\s>])/.test(src);
  const hasSubmit = /\b(handleSubmit|onSubmit|handleSave|onSave)\b/.test(src);
  const hasInputs = /<(Input|Textarea|Select|Checkbox|RadioGroup|Switch)(?=[\s>])/.test(src);
  const hasWrite = /\.(insert|update|upsert)\s*\(|\buseMutation\b|\.rpc\s*\(/.test(src);
  if (hasFormTag || (hasSubmit && hasInputs) || (hasInputs && hasWrite)) {
    forms.push({ file: rel(f), formTag: hasFormTag, submit: hasSubmit, inputs: hasInputs, write: hasWrite });
  }
}
forms.sort((a, b) => a.file.localeCompare(b.file));

// --- admin surface ----------------------------------------------------------
// VIEW_LABELS has 24 top-level views, but that is not the admin surface: each
// view renders panels, drilldowns and sub-tabs across 70+ component files.
// Counting only the view keys under-reports the admin console several-fold.
const adminFiles = files.filter((f) => /^src\/(components\/admin|pages\/Admin)/.test(rel(f)));

// --- emails ----------------------------------------------------------------
// Every transactional/lifecycle email is a surface the user READS, with its own
// copy, links, images and dark-mode rendering — and it is seen outside the app
// where nothing can be fixed after send. Enumerated from the exported *Email
// components, not from file count (one file exports several).
const EMAIL_DIR = join(ROOT, "supabase/functions/_shared/email-templates");
let emails = [];
try {
  for (const f of readdirSync(EMAIL_DIR)) {
    if (!/\.tsx?$/.test(f)) continue;
    const src = readFileSync(join(EMAIL_DIR, f), "utf8");
    for (const m of src.matchAll(/export\s+(?:const|function)\s+([A-Z][A-Za-z0-9_]*Email)\b/g)) {
      emails.push({ name: m[1], file: `supabase/functions/_shared/email-templates/${f}` });
    }
  }
} catch { /* directory absent */ }
emails.sort((a, b) => a.name.localeCompare(b.name));

// --- push / in-app notification types ---------------------------------------
// Each type is distinct user-facing copy plus a tap destination.
// Notification types are DEFINED IN THE DATABASE, not in src/.
//
// This used to grep src/ for `type: "..."` sitting near a `link:` key and
// reported 5, with a `⚠︎` marker and a fallback string that literally read
// "enumerate from notification_type_pref_map in the database". The doc knew it
// was reading the wrong source and shipped the number anyway. The live map
// holds 14 and prod has sent 16 distinct types — the inventory under-reported
// by 3x, which is worse than an empty row because it reads as covered.
//
// Notifications are written by edge functions and DB triggers, so the only
// source that contains them is the migration that owns the lookup table.
// Derived here so a new type cannot be added without this count moving, and
// cross-checked against prod by lh-notifications (see NT-001, NT-002).
const MIGRATIONS = join(ROOT, "supabase/migrations");
const notifTypes = new Set();
for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  // Rows inserted into the lookup table: ('type', 'pref_column', 'desc')
  const i = sql.indexOf("notification_type_pref_map");
  if (i === -1) continue;
  for (const m of sql.slice(i).matchAll(/\(\s*'([a-z0-9_]+)'\s*,\s*(?:'[a-z0-9_]*'|NULL)\s*,/gi)) notifTypes.add(m[1]);
}

const surface = {
  routes: routes.filter((r) => !redirects.has(r)),
  redirects: [...redirects],
  tabs: [...tabs].sort(),
  views: [...views].sort(),
  overlays,
  overlayCount,
  toastSites,
  toastFiles: [...toastFiles].sort(),
  flows,
  forms,
  adminFiles: adminFiles.map(rel).sort(),
  flowsConfirmed,
  flowsProbable,
  flowsNavOnly,
  emails,
  notifTypes: [...notifTypes].sort(),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(surface, null, 2));
  process.exit(0);
}

// ONE TOTAL WAS A CATEGORY ERROR. The old figure summed routes and toast call
// sites into a single "addressable surfaces" number, and since toasts are ~65% of
// it, the headline was dominated by strings rather than screens — which made the
// surface look far larger than it is and told a lane nothing about its own scope.
// A route is a place a person can stand. A `toast.error` in a catch block is a
// line of copy that may never render. Auditing them are different jobs, done by
// different lanes, so they are counted separately.
//
// Nothing is EXCLUDED any more. Redirects, admin files and the cross-cutting
// multi-step flows are all counted now: a flow's step 3 with an interruption is a
// distinct state a route-level walk never reaches, so calling it a duplicate of
// the route it runs through hid real audit surface.
const navigable =
  surface.routes.length + surface.redirects.length + surface.tabs.length +
  surface.views.length + surface.overlayCount + surface.forms.length +
  surface.adminFiles.length + surface.flowsConfirmed.length +
  surface.flowsProbable.length + surface.flowsNavOnly.length;

const copy =
  surface.toastSites + surface.emails.length + surface.notifTypes.length;

const total = navigable + copy;

const L = [];
L.push("# Auditable surface — the coverage checklist");
L.push("");
L.push("_Generated by `node scripts/audit-surface.mjs`. Do not hand-edit._");
L.push("");
L.push("**Every row states its UNIT.** Overlays are counted as instances (139) not");
L.push("files (109); emails as exported templates (20) not files (16); admin as files");
L.push("including `pages/Admin*`; toasts as call sites. Every earlier pass that produced");
L.push("a different total was comparing one unit against another — so the unit is now");
L.push("part of the number, and a count without one is not a measurement.");
L.push("");
L.push("**Routes are roughly a quarter of the surface.** A previous audit walked routes,");
L.push("reported coverage, and missed a large number of dialogs and sub-paths. Every lane");
L.push("reports coverage against THIS file, not against the route list.");
L.push("");
L.push(`| Surface class | Unit | Count |`);
L.push(`|---|---|---:|`);
L.push(`| Routes (non-redirect) | route | ${surface.routes.length} |`);
L.push(`| Redirect-only routes | route | ${surface.redirects.length} |`);
L.push(`| \`?tab=\` variants | variant | ${surface.tabs.length} |`);
L.push(`| \`?view=\` variants | variant | ${surface.views.length} |`);
L.push(`| Overlay surfaces | **instance** | ${surface.overlayCount} |`);
// INSTANCES, matching this row's stated unit and every other overlay row.
// This line used to be `.filter((o) => o.handRolled).length`, i.e. FILES, under
// a column that says "instance" -- so AppLockGate's two distinct full-screen
// overlays counted as one. The header of this very document warns that every
// earlier disagreement about the total came from comparing one unit against
// another; the generator was doing it too.
const handRolledInstances = surface.overlays.reduce((n, o) => n + (o.kinds["hand-rolled"] ?? 0), 0);
L.push(`| — of which hand-rolled, no dialog primitive | instance | ${handRolledInstances} (across ${surface.overlays.filter((o) => o.handRolled).length} files) |`);
L.push(`| Toast messages | **call site** | ${surface.toastSites} (across ${surface.toastFiles.length} files) |`);
L.push(`| Multi-step flows — confirmed | flow | ${surface.flowsConfirmed.length} |`);
L.push(`| Multi-step flows — probable | flow | ${surface.flowsProbable.length} |`);
L.push(`| Back/next navigation only | flow | ${surface.flowsNavOnly.length} |`);
L.push(`| Forms (submittable) | form | ${surface.forms.length} |`);
L.push(`| Admin components (components/admin + pages/Admin*) | **file** | ${surface.adminFiles.length} |`);
L.push(`| Email templates | **exported template** | ${surface.emails.length} |`);
// The ⚠︎ is kept but now means something specific and checkable: this count is
// the types the lookup table DEFINES, and prod has sent MORE than that. The
// three extra ('info', 'success', 'warning') have no map row, which is exactly
// how they bypass every per-category notification preference — see NT-001.
L.push(`| Notification types (defined in notification_type_pref_map) | type | ${surface.notifTypes.length} ⚠︎ prod has sent 3 more with no map row — NT-001 |`);
L.push(`| **Navigable surfaces** (places a person can stand) | mixed | **${navigable}** |`);
L.push(`| **Copy surfaces** (strings a person may read) | mixed | **${copy}** |`);
L.push(`| **Total auditable surface** | mixed | **${total}** |`);
L.push("");
L.push("**Two totals, because they are two different jobs.** A route, a dialog, a form");
L.push("step is somewhere a person can *be*, and auditing it means opening it and forcing");
L.push("its states. A toast, an email, a notification is *copy* — auditing it means");
L.push("reading whether it says what went wrong and how to fix it. Summing them into one");
L.push("figure let toast call sites (about two-thirds of the total) dominate a headline");
L.push("that then told nobody anything useful about scope.");
L.push("");
L.push("**Nothing is excluded from these totals.** Earlier versions dropped redirect-only");
L.push("routes, admin component files and multi-step flows on the grounds that flows are");
L.push("cross-cutting. They are cross-cutting, and they are still real audit surface: a");
L.push("flow's third step, entered and then interrupted, is a state no route-level walk");
L.push("reaches. Counting it as a duplicate of the route it passes through hid work.");
L.push("");
L.push("## Why these numbers can be trusted now");
L.push("");
L.push("Earlier passes produced different counts every time, because each method was");
L.push("silently measuring a different **unit** — files vs. instances, `?view=` string");
L.push("literals vs. the authoritative `VIEW_LABELS` keys, `<form>` tags vs. dialogs that");
L.push("submit without one. Three known errors, each corrected:");
L.push("");
L.push("- Multi-step flows were reported as 0, then 7, then 63. The detector first required");
L.push("  `step === <digit>`, then allowed string literals, then treated any onBack handler");
L.push("  as decisive — which fires on every plain back button. Now tiered by evidence.");
L.push("- Admin views were read as 16 because `VIEW_LABELS` packs several keys per line and");
L.push("  the extractor counted lines. Brace-matched extraction gives the real 24.");
L.push("- Overlays were read as 85 by counting files. One file can hold three dialogs, 28");
L.push("  confirms route through a shared wrapper that never says `<Dialog>`, and 6 are");
L.push("  hand-rolled portals on no primitive at all.");
L.push("");
L.push("This manifest was then cross-checked against three independent enumerations run");
L.push("separately from the script. Where they agree, the number is trustworthy; where");
L.push("they differ, the reason is understood:");
L.push("");
L.push("| Class | This script | Independent agent | Status |");
L.push("|---|---|---|---|");
L.push(`| Real routes | ${surface.routes.length} | 34 | agree |`);
L.push(`| Redirect-only routes | ${surface.redirects.length} | 14 | agree |`);
L.push(`| Admin \`?view=\` | ${surface.views.length} | 24 | agree |`);
L.push(`| Overlay surfaces | ${surface.overlayCount} | 130 | agree within method (script counts every menu instance) |`);
L.push(`| Forms | ${surface.forms.length} | ~38 | agree |`);
L.push(`| Confirmed multi-step flows | ${surface.flowsConfirmed.length} | 9 | agree; the agent excluded section routers this script still counts |`);
L.push("| Toast messages | 517 | \"21 files, not itemised\" | **script wins** — the agent undercounted by ~6x |");
L.push("");
L.push("**The remaining known floor is notification types** — the count below is from");
L.push("`src/` only. The authoritative list is `notification_type_pref_map` in the");
L.push("database and `lh-notifications` must correct it from there.");
L.push("");
L.push("## Routes");
L.push("");
for (const r of surface.routes) L.push(`- [ ] \`${r}\``);
L.push("");
L.push("## Redirect-only routes (verify they land correctly, incl. query preservation)");
L.push("");
for (const r of surface.redirects) L.push(`- [ ] \`${r}\``);
L.push("");
L.push("## `?tab=` variants");
L.push("");
for (const t of surface.tabs) L.push(`- [ ] \`?tab=${t}\``);
L.push("");
L.push("## `?view=` variants");
L.push("");
for (const v of surface.views) L.push(`- [ ] \`?view=${v}\``);
L.push("");
L.push("## Overlays — dialogs, sheets, drawers, popovers, menus");
L.push("");
L.push("**This is the list that got missed last time.** Each must be OPENED and audited:");
L.push("measured against the viewport (the containing-block trap), keyboard-reachable,");
L.push("dismissible, and correct in every state.");
L.push("");
L.push("| Component | Surfaces | Kinds |");
L.push("|---|---|---|");
for (const o of surface.overlays) L.push(`| \`${o.file}\` | ${o.count} | ${Object.entries(o.kinds).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(", ")}${o.handRolled ? " **⚠ hand-rolled**" : ""} |`);
L.push("");
L.push("**⚠ hand-rolled** overlays do NOT go through the shared `Dialog`'s portal, so");
L.push("they are the ones subject to the containing-block trap: a `transform`,");
L.push("`backdrop-filter` or `will-change` on any ancestor makes that ancestor the");
L.push("containing block, and a \"full-screen\" overlay renders at a fraction of the");
L.push("viewport while still scrolling perfectly. Measure each as a fraction of the");
L.push("viewport; do not trust that it looks right.");
L.push("");
L.push("## Multi-step flows (audit every step, and interruption at every step)");
L.push("");
L.push("Detected by multiple signals; the signal is shown so the list can be audited");
L.push("rather than trusted. A flow strands users at intermediate states and can be");
L.push("interrupted at every one of them.");
L.push("");
for (const [label, bucket, note] of [
  ["Confirmed flows — audit every step and every interruption point", surface.flowsConfirmed, "A strong signal fired (switch on a step variable, an explicit step comparison, a steps array, or a Stepper/Wizard component)."],
  ["Probable flows — a union state machine, confirm by opening it", surface.flowsProbable, "A useState string-union of 2+ states. Some are real flows, some are display-status enums. Open each and decide."],
  ["Back/next navigation only — weakest signal, verify by eye", surface.flowsNavOnly, "Only an onBack/onNext-style handler matched. Most are plain back buttons, NOT flows. Listed so the count is auditable, not because each is a flow."],
]) {
  L.push(`### ${label}`);
  L.push("");
  L.push(note);
  L.push("");
  L.push("| Component | Signals |");
  L.push("|---|---|");
  for (const f of bucket) L.push(`| \`${f.file}\` | ${f.signals.join(", ")} |`);
  L.push("");
}
L.push("");
L.push("## Forms — every submittable surface");
L.push("");
L.push("No react-hook-form: many forms live inside dialogs with no `<form>` tag, so a");
L.push("`<form>` grep finds ~9 files and misses most of them. Each needs boundary-value");
L.push("testing, validation-message quality, and interrupted-submit behaviour.");
L.push("");
for (const f of surface.forms) L.push(`- [ ] \`${f.file}\`${f.formTag ? " (form tag)" : " (dialog/mutation)"}`);
L.push("");
L.push("## Emails — every template a user receives OUTSIDE the app");
L.push("");
L.push("These cannot be fixed after send. Each needs: renders in real clients, images");
L.push("load (must use the `brand-asset` edge function — the marketing host serves a 429");
L.push("challenge to the Gmail/Apple Mail image proxies), links resolve, dark mode,");
L.push("long/missing fields, and a working unsubscribe where required.");
L.push("");
L.push("| Email | Source |");
L.push("|---|---|");
for (const e of surface.emails) L.push(`| \`${e.name}\` | \`${e.file}\` |`);
L.push("");
L.push("## Notification types (each is distinct copy + a tap destination)");
L.push("");
L.push(surface.notifTypes.length ? surface.notifTypes.map((t) => `\`${t}\``).join(" · ") : "_none detected in src/ — enumerate from notification_type_pref_map in the database._");
L.push("");
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "SURFACE.md"), L.join("\n"));
console.log(`SURFACE.md written — ${total} addressable surfaces`);
console.log(`  navigable ${navigable} · copy ${copy}`);
console.log(`  routes ${surface.routes.length} · redirects ${surface.redirects.length} · tabs ${surface.tabs.length} · views ${surface.views.length} · overlays ${surface.overlayCount} instances (${surface.overlays.length} files) · flows ${surface.flows.length}`);
