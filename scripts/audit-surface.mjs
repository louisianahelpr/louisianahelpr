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
const tabs = new Set();
const views = new Set();
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/[?&]tab=([a-zA-Z_][\w-]*)/g)) tabs.add(m[1]);
  for (const m of s.matchAll(/[?&]view=([a-zA-Z_][\w-]*)/g)) views.add(m[1]);
}

// --- overlays: anything that renders a Dialog/Sheet/Drawer/Popover ----------
const OVERLAY_TAG = /<(Dialog|AlertDialog|Sheet|Drawer|Popover|HoverCard|DropdownMenu|ContextMenu)\b/;
const overlays = [];
for (const f of files) {
  if (rel(f).startsWith("src/components/ui/")) continue; // primitives, not surfaces
  const s = readFileSync(f, "utf8");
  if (!OVERLAY_TAG.test(s)) continue;
  const kinds = new Set(
    [...s.matchAll(/<(Dialog|AlertDialog|Sheet|Drawer|Popover|HoverCard|DropdownMenu|ContextMenu)\b/g)].map((m) => m[1]),
  );
  overlays.push({ file: rel(f), kinds: [...kinds].sort() });
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
const notifTypes = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/notification_?[Tt]ype\s*[:=]\s*["']([a-z0-9_]+)["']/g)) notifTypes.add(m[1]);
  for (const m of src.matchAll(/\btype:\s*["']([a-z0-9_]+)["'][^}]*\blink:/g)) notifTypes.add(m[1]);
}

const surface = {
  routes: routes.filter((r) => !redirects.has(r)),
  redirects: [...redirects],
  tabs: [...tabs].sort(),
  views: [...views].sort(),
  overlays: overlays.sort((a, b) => a.file.localeCompare(b.file)),
  flows,
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

// Emails and notification types ARE separate surfaces (a user reads them outside
// the app), so they count. Flows are cross-cutting — they live inside routes and
// overlays — so they are listed but not added, to avoid double-counting.
const total =
  surface.routes.length + surface.tabs.length + surface.views.length +
  surface.overlays.length + surface.emails.length + surface.notifTypes.length;

const L = [];
L.push("# Auditable surface — the coverage checklist");
L.push("");
L.push("_Generated by `node scripts/audit-surface.mjs`. Do not hand-edit._");
L.push("");
L.push("**Routes are roughly a quarter of the surface.** A previous audit walked routes,");
L.push("reported coverage, and missed a large number of dialogs and sub-paths. Every lane");
L.push("reports coverage against THIS file, not against the route list.");
L.push("");
L.push(`| Surface class | Count |`);
L.push(`|---|---|`);
L.push(`| Routes (non-redirect) | ${surface.routes.length} |`);
L.push(`| Redirect-only routes | ${surface.redirects.length} |`);
L.push(`| \`?tab=\` variants | ${surface.tabs.length} |`);
L.push(`| \`?view=\` variants | ${surface.views.length} |`);
L.push(`| Overlay-rendering components | ${surface.overlays.length} |`);
L.push(`| Multi-step flows — confirmed | ${surface.flowsConfirmed.length} |`);
L.push(`| Multi-step flows — probable | ${surface.flowsProbable.length} |`);
L.push(`| Back/next navigation only (eyeball these) | ${surface.flowsNavOnly.length} |`);
L.push(`| Email templates | ${surface.emails.length} |`);
L.push(`| Notification types (copy + destination) | ${surface.notifTypes.length} ⚠︎ |`);
L.push(`| **Addressable surfaces** | **${total}** |`);
L.push("");
L.push("Multi-step flows are **cross-cutting**, not a separate surface: they live inside");
L.push("the routes and overlays above, so they are excluded from the total to avoid");
L.push("double-counting. They are listed separately because each one adds intermediate");
L.push("states that a route-level walk never reaches.");
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
L.push("| Component | Overlay kinds |");
L.push("|---|---|");
for (const o of surface.overlays) L.push(`| \`${o.file}\` | ${o.kinds.join(", ")} |`);
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
console.log(`  routes ${surface.routes.length} · redirects ${surface.redirects.length} · tabs ${surface.tabs.length} · views ${surface.views.length} · overlays ${surface.overlays.length} · flows ${surface.flows.length}`);
