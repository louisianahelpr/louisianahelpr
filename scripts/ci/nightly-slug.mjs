#!/usr/bin/env node
// The nightly-red issue name a workflow's red run belongs under.
//
// A workflow that runs .github/actions/nightly-issue-sync itself already owns
// `nightly-red: <its workflow-name>`. main-red-watch used to file every push
// red as `nightly-red: main: <display name>` regardless, so one workflow had
// two issues and two ops-ledger items (2026-09-27: "main: staleness watch" and
// "staleness-watch" open at once). This returns the workflow's own slug when it
// has exactly one literal one, else `main: <display name>`, plus who may close it:
//   selfFilesOnPush  the workflow's own sync runs on push reds too, so its run
//                    already filed or closed the issue; main-red-watch must not.
//   selfFiles        it syncs only on schedule/dispatch. main-red-watch files a
//                    push red there but never closes it: a green PUSH run can
//                    skip jobs the scheduled run has (prod-freshness runs one job
//                    on push), and closing on it would be a false green.
//
// Usage: node scripts/ci/nightly-slug.mjs "<workflow display name>"   (prints JSON)
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function nightlySlug(displayName, dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows")) {
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
    const src = readFileSync(join(dir, f), "utf8");
    const name = /^name:\s*["']?(.+?)["']?\s*$/m.exec(src)?.[1];
    if (name !== displayName) continue;
    const slugs = new Set();
    let onPush = false;
    const re = /uses:\s*\.\/\.github\/actions\/nightly-issue-sync[\s\S]*?workflow-name:\s*["']?([^"'\n]+?)["']?\s*$/gm;
    for (let m; (m = re.exec(src)); ) {
      if (m[1].includes("${{")) continue;
      slugs.add(m[1]);
      // The step's `if:` sits just above its `uses:` or between it and `with:`.
      // Schedule-only means it names schedule/dispatch and nothing that admits push.
      const before = src.slice(0, m.index).split("\n").slice(-12).join("\n") + m[0];
      const cond = [...before.matchAll(/^\s*if:\s*(.*(?:\n\s{6,}\S.*)*)/gm)].pop()?.[1] ?? "";
      if (!/event_name\s*==\s*'schedule'/.test(cond)) onPush = true;
    }
    if (slugs.size === 1) return { slug: [...slugs][0], selfFiles: true, selfFilesOnPush: onPush };
  }
  return { slug: `main: ${displayName}`, selfFiles: false, selfFilesOnPush: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) { console.error("usage: nightly-slug.mjs <workflow display name>"); process.exit(2); }
  console.log(JSON.stringify(nightlySlug(process.argv[2])));
}
