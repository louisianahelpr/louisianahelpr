#!/usr/bin/env node
/**
 * state-review — the pass that actually LOOKS.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 2026-08-31 sweep captured screenshots for 69 routes at 8 breakpoint/theme
 * pairs and then nobody examined them. The gates it ran — axe, overflow, tap
 * size, h1 count — all passed, so the run reported clean, and the owner found
 * ~20 defects by hand the same week. Every one of those defects passes every
 * one of those gates (see docs/audit/STATE_REVIEW_PROMPT.md for the list).
 *
 * Capturing images and asserting predicates are two different activities, and
 * this repo had only ever done the second. This script is the first: it turns
 * each captured frame into a review packet — the image, the exact state it was
 * forced into, and the DOM measurements a picture cannot give you — and asks
 * for a critique framed as "what is wrong with this image".
 *
 * IT NEVER RETURNS A GREEN TICK ON ITS OWN.
 * With no reviewer configured it emits the packets, ranks them by how likely
 * they are to be worth a human's next ten minutes, and reports N frames
 * AWAITING REVIEW. "Awaiting review" is the honest state of an unexamined
 * screenshot; "passed" is not.
 *
 * USAGE
 *   node scripts/state-review.mjs                       # triage + packets
 *   node scripts/state-review.mjs --in /tmp/lh-state-sweep --out /tmp/lh-review
 *   node scripts/state-review.mjs --top 40              # rank, keep the worst 40
 *   node scripts/state-review.mjs --review              # call a vision model
 *
 * MODEL REVIEW (optional, --review)
 * Uses an OpenAI-compatible chat/completions endpoint with image content —
 * the same shape `supabase/functions/ai-job-builder/index.ts` already talks to,
 * so no new dependency and no second provider to keep configured:
 *   REVIEW_API_BASE  default https://generativelanguage.googleapis.com/v1beta/openai
 *   REVIEW_API_KEY   required for --review
 *   REVIEW_MODEL     default gemini-3.6-flash
 * Without REVIEW_API_KEY, --review is refused loudly rather than silently
 * degrading to "no findings".
 *
 * CI
 * Runnable as-is. It is deliberately NOT wired into any workflow file from
 * here — workflows are owned elsewhere. The intended shape is: run the sweep,
 * run this with --review, fail the job on any HIGH finding, and upload
 * findings.json plus the ranked packets as artifacts.
 *
 * Exit codes:
 *   0  reviewed with no HIGH findings, or triage-only run
 *   1  at least one HIGH finding
 *   2  bad invocation / nothing to review
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);

const IN = resolve(arg("--in", process.env.STATE_SWEEP_OUT || "/tmp/lh-state-sweep"));
const OUT = resolve(arg("--out", process.env.STATE_REVIEW_OUT || "/tmp/lh-state-review"));
const TOP = Number(arg("--top", "0")) || 0;
const DO_REVIEW = flag("--review");
const PROMPT_PATH = resolve(
  arg("--prompt", new URL("../docs/audit/STATE_REVIEW_PROMPT.md", import.meta.url).pathname),
);

if (!existsSync(IN)) {
  console.error(`state-review: no sweep output at ${IN}`);
  console.error("Run the sweep first:");
  console.error(
    "  RUN_STATE_SWEEP=1 PLAYWRIGHT_WEB_SERVER=1 npx playwright test --project=happy-path state-sweep",
  );
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// load records
// ---------------------------------------------------------------------------

const recordFiles = readdirSync(IN).filter(
  (f) => f.endsWith(".json") && !["index.json", "state-matrix.json"].includes(f),
);
const records = recordFiles
  .map((f) => {
    try {
      return JSON.parse(readFileSync(resolve(IN, f), "utf8"));
    } catch {
      return null;
    }
  })
  .filter((r) => r && r.cellId);

if (records.length === 0) {
  console.error(`state-review: ${IN} holds no review records.`);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// triage
// ---------------------------------------------------------------------------

/**
 * Rank frames by how likely they are to repay a look.
 *
 * READ THIS BEFORE TREATING A SCORE AS A VERDICT: every signal here is a
 * PRIOR, not a finding. A frame can score zero and still be broken (a "Report"
 * button on a finished job produces no signal at all — that is the whole point
 * of the class). A frame can score high and be perfectly correct (the tracker
 * rail legitimately carries an amber current step beside green passed steps).
 *
 * The score exists for one purpose: when a person or a model has time for forty
 * frames and there are three hundred, it decides which forty. It must never be
 * used to skip the rest, and `--top` records how many were left unreviewed so
 * the omission stays visible.
 */
function signalsFor(rec) {
  const o = rec.observation ?? {};
  const out = [];

  // 1. Colour meaning. Same-family members that are SATURATED and differ by a
  //    small hue step are the "two greens" shape. A family whose members are
  //    the same hue at different alphas is the "--bark/0.12 vs --bark/0.18"
  //    shape — accepted vs completed, adjacent in the same list.
  for (const fam of o.hueFamilies ?? []) {
    if (fam.members.length < 2) continue;
    const hues = fam.members.map((m) => Number(/h(-?\d+)/.exec(m)?.[1] ?? NaN)).filter(Number.isFinite);
    const alphas = fam.members.map((m) => Number(/a([\d.]+)/.exec(m)?.[1] ?? NaN)).filter(Number.isFinite);
    const hueSpread = hues.length > 1 ? Math.max(...hues) - Math.min(...hues) : 0;
    if (hueSpread > 3 && hueSpread <= 45) {
      out.push({
        class: "colour-meaning",
        weight: 3,
        note: `${fam.members.length} distinct "${fam.family}" values in one frame, hue spread ${hueSpread}deg — do they mean different things, and can a reader tell?`,
        detail: fam.members.slice(0, 6),
      });
    } else if (hueSpread <= 3 && new Set(alphas).size > 1) {
      out.push({
        class: "colour-meaning",
        weight: 2,
        note: `same hue at ${new Set(alphas).size} alphas in the "${fam.family}" family — two states told apart only by tint strength`,
        detail: fam.members.slice(0, 6),
      });
    }
  }

  // 1b. Sibling colour split — the tracker-rail shape, which 1 above misses.
  //     Passed step dots are --success-ink (h142, true green); the current dot
  //     is --bark (h71, olive). They fall in DIFFERENT families, so a
  //     within-family multiplicity check reports nothing while a reader sees a
  //     row of dots that are green, green, green, and a different green.
  for (const s of (o.siblingColorSplits ?? []).slice(0, 6)) {
    out.push({
      class: "colour-meaning",
      weight: 4,
      note: `one row of siblings painted across ${s.families.length} hue families (${s.families.join(", ")}) — is the difference meaningful, and readable?`,
      detail: s.members,
    });
  }

  // 2. Near-miss alignment. 2..12px is the band; a 1px spread is sub-pixel.
  for (const a of o.nearMissAlignments ?? []) {
    if (a.spread >= 2 && a.spread <= 12 && a.values.length >= 2) {
      out.push({
        class: "alignment",
        weight: a.spread >= 4 ? 3 : 2,
        note: `${a.values.length} sibling ${a.axis} edges spread over ${a.spread}px — aligned or not?`,
        detail: a.samples,
      });
    }
  }

  // 3. Empty bands.
  for (const b of o.emptyBands ?? []) {
    if (b.height >= 24) {
      out.push({
        class: "empty-band",
        weight: b.height >= 56 ? 3 : 2,
        note: `${b.height}px with nothing painted, between "${b.above}" and "${b.below}"`,
        detail: [`offset ${b.top}px from the top of the region`],
      });
    }
  }

  // 4. Overlaps.
  for (const ov of (o.overlaps ?? []).slice(0, 6)) {
    out.push({
      class: "overlap",
      weight: ov.area >= 400 ? 4 : 2,
      note: `"${ov.a}" and "${ov.b}" intersect over ${ov.area}px^2`,
      detail: [],
    });
  }

  // 5. Unlabelled content. A region with real content and no heading at all is
  //    the strongest form of the class; anything subtler needs the image.
  const contentful = (o.copy ?? []).length >= 8;
  if (contentful && (o.sections ?? []).length === 0) {
    out.push({
      class: "section-labels",
      weight: 2,
      note: `${(o.copy ?? []).length} text runs and zero headings or eyebrows in the region`,
      detail: (o.copy ?? []).slice(0, 6),
    });
  }

  // 6. Console errors while the state rendered.
  for (const e of (o.consoleErrors ?? []).slice(0, 3)) {
    out.push({ class: "console", weight: 3, note: `console error while rendering: ${e}`, detail: [] });
  }

  // 7. Actions. No signal is computed for "does this action make sense" — it
  //    cannot be. The labels are surfaced so the reviewer is asked the question.
  if ((o.actions ?? []).length > 0) {
    out.push({
      class: "action-sense",
      weight: 1,
      note: `${o.actions.length} controls in this state — ask of each whether a person in this exact state would press it`,
      detail: o.actions.map((a) => `${a.label}${a.disabled ? " (disabled)" : ""}`),
    });
  }

  // 8. A frame the sweep could not drive is not reviewable at all.
  if (rec.unverified) {
    out.push({ class: "unverified", weight: 5, note: rec.unverified, detail: [] });
  }

  return out;
}

const triaged = records
  .map((rec) => {
    const signals = signalsFor(rec);
    return { rec, signals, score: signals.reduce((n, s) => n + s.weight, 0) };
  })
  .sort((a, b) => b.score - a.score);

// ---------------------------------------------------------------------------
// packets
// ---------------------------------------------------------------------------

const promptText = existsSync(PROMPT_PATH)
  ? readFileSync(PROMPT_PATH, "utf8")
  : "What is wrong with this image? (docs/audit/STATE_REVIEW_PROMPT.md not found)";

function packetFor({ rec, signals, score }) {
  return {
    cellId: rec.cellId,
    shot: rec.shot,
    surface: rec.surface,
    route: rec.route,
    screenshot: rec.screenshot,
    state: {
      describe: rec.describe,
      status: rec.status,
      derived: rec.derived,
      expanded: rec.expanded,
      axes: rec.axes,
    },
    triageScore: score,
    triageSignals: signals,
    observation: rec.observation,
    driven: rec.driven,
    unverified: rec.unverified ?? null,
  };
}

const selected = TOP > 0 ? triaged.slice(0, TOP) : triaged;
const skipped = TOP > 0 ? triaged.slice(TOP) : [];
const packets = selected.map(packetFor);

writeFileSync(resolve(OUT, "packets.json"), JSON.stringify({ prompt: PROMPT_PATH, packets }, null, 2));

// A flat, human-openable queue: worst first, with the image path on the line.
const queue = [
  "# State review queue",
  "",
  `Source: ${IN}`,
  `Prompt: ${PROMPT_PATH}`,
  `${records.length} frames captured. ${packets.length} in this queue${skipped.length ? `, ${skipped.length} NOT queued (--top ${TOP}) and therefore UNREVIEWED` : ""}.`,
  "",
  "Ordered by triage score, which is a prior and never a verdict. A zero-score",
  "frame can still be broken — the 'action makes no sense in this state' class",
  "produces no signal by construction.",
  "",
];
for (const { rec, signals, score } of selected) {
  queue.push(`## [${score}] ${rec.cellId} @ ${rec.shot}`);
  queue.push(`${rec.describe}`);
  queue.push(`Image: ${rec.screenshot}`);
  if (rec.unverified) queue.push(`**UNVERIFIED — ${rec.unverified}**`);
  for (const s of signals) queue.push(`- \`${s.class}\` ${s.note}`);
  queue.push("");
}
if (skipped.length) {
  queue.push("## Not queued — UNREVIEWED");
  queue.push("");
  for (const { rec, score } of skipped) queue.push(`- [${score}] ${rec.cellId} @ ${rec.shot}`);
  queue.push("");
}
writeFileSync(resolve(OUT, "queue.md"), queue.join("\n") + "\n");

// ---------------------------------------------------------------------------
// optional model review
// ---------------------------------------------------------------------------

async function reviewOne(packet) {
  const base = process.env.REVIEW_API_BASE || "https://generativelanguage.googleapis.com/v1beta/openai";
  const model = process.env.REVIEW_MODEL || "gemini-3.6-flash";
  const key = process.env.REVIEW_API_KEY;

  let imageB64 = null;
  try {
    imageB64 = readFileSync(packet.screenshot).toString("base64");
  } catch {
    return {
      cellId: packet.cellId,
      shot: packet.shot,
      findings: [],
      checked: [],
      error: `screenshot missing at ${packet.screenshot}`,
    };
  }

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          promptText +
          "\n\nReply with ONLY the JSON object described under 'Output format'. No prose around it.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              `cellId: ${packet.cellId}\nshot: ${packet.shot}\nstate: ${packet.state.describe}\n` +
              `axes: ${JSON.stringify(packet.state.axes)}\n\n` +
              `observation record:\n${JSON.stringify(packet.observation, null, 1).slice(0, 24_000)}`,
          },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageB64}` } },
        ],
      },
    ],
    temperature: 0,
  };

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Never swallow this into "no findings" — an unreviewed frame must read as
    // unreviewed. That substitution is the exact failure the ledger exists for.
    return {
      cellId: packet.cellId,
      shot: packet.shot,
      findings: [],
      checked: [],
      error: `review call failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    };
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) {
    return { cellId: packet.cellId, shot: packet.shot, findings: [], checked: [], error: "unparseable reply" };
  }
  try {
    const parsed = JSON.parse(m[0]);
    return { cellId: packet.cellId, shot: packet.shot, ...parsed };
  } catch (e) {
    return {
      cellId: packet.cellId,
      shot: packet.shot,
      findings: [],
      checked: [],
      error: `unparseable reply: ${String(e).slice(0, 120)}`,
    };
  }
}

let findings = null;
if (DO_REVIEW) {
  if (!process.env.REVIEW_API_KEY) {
    console.error(
      "state-review: --review requires REVIEW_API_KEY. Refusing to run: a review that\n" +
        "silently produced no findings would be indistinguishable from a clean app.",
    );
    process.exit(2);
  }
  findings = [];
  // Serial on purpose — rate limits, and a review run is not the hot path.
  for (const p of packets) {
    process.stderr.write(`reviewing ${p.cellId} @ ${p.shot} … `);
    // eslint-disable-next-line no-await-in-loop
    const r = await reviewOne(p);
    findings.push(r);
    process.stderr.write(`${r.error ? "ERROR" : `${(r.findings ?? []).length} findings`}\n`);
  }
  writeFileSync(resolve(OUT, "findings.json"), JSON.stringify({ generatedAt: new Date().toISOString(), findings }, null, 2));
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const bySignal = {};
for (const t of triaged) for (const s of t.signals) bySignal[s.class] = (bySignal[s.class] ?? 0) + 1;

console.log("");
console.log(`state-review — ${records.length} frames from ${IN}`);
console.log("");
console.log("Triage signals (priors, not findings):");
for (const [k, v] of Object.entries(bySignal).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`);
}
console.log("");
const undriven = records.filter((r) => r.unverified);
console.log(`  ${String(undriven.length).padStart(5)}  frames UNVERIFIED (the sweep could not reach the state)`);
console.log("");
console.log(`Queue:   ${resolve(OUT, "queue.md")}`);
console.log(`Packets: ${resolve(OUT, "packets.json")}`);

if (!findings) {
  console.log("");
  console.log(`${packets.length} frames AWAITING REVIEW — nothing has been judged yet.`);
  console.log("Run with --review (and REVIEW_API_KEY set), or open queue.md and look.");
  process.exit(0);
}

const high = findings.flatMap((f) => (f.findings ?? []).filter((x) => x.severity === "HIGH"));
const med = findings.flatMap((f) => (f.findings ?? []).filter((x) => x.severity === "MEDIUM"));
const low = findings.flatMap((f) => (f.findings ?? []).filter((x) => x.severity === "LOW"));
const errored = findings.filter((f) => f.error);
console.log("");
console.log(`Reviewed ${findings.length} frames: ${high.length} HIGH, ${med.length} MEDIUM, ${low.length} LOW`);
if (errored.length) console.log(`${errored.length} frames could NOT be reviewed — they are UNVERIFIED, not clean.`);
console.log(`Findings: ${resolve(OUT, "findings.json")}`);
for (const f of high) console.log(`  HIGH  ${f.what}`);
process.exit(high.length > 0 ? 1 : 0);
