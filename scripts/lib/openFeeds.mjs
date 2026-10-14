/**
 * docs/OPEN.md is the ONE open-work list (owner, 2026-09-27: "can this just be
 * merged into open so we aren't tracking several different things").
 *
 * The other trackers are FEEDS into it: the ops alert ledger
 * (public.ops_alert_ledger), the open GitHub issues under an alert label
 * (nightly-red, schedule-stalled, ...: scripts/lib/alertIssueLabels.mjs) and
 * the audit bus (docs/audit/launch-2026-09/findings.jsonl). Each open source
 * item is mirrored by exactly one OPEN.md queue item carrying a sticky tag:
 *
 *   feed: issue #1921          an alert issue (nightly-red, schedule-stalled, ...)
 *   feed: ledger 88ecf6e765df  an ops_alert_ledger row (first 12 hex of its fingerprint)
 *   feed: bus NB-004           an audit-bus finding
 *
 * A nightly_red ledger row and its GitHub issue are ONE source and share one
 * item (both tags). scripts/open-sync-trackers.mjs writes the tags;
 * src/test/openFeedsMirrored.test.ts fails when an open source has none.
 */
import { CLOSED_STATUSES, foldFindings, parseFindingsLog } from "./auditFindings.mjs";
import { ALERT_ISSUE_LABELS, ALERT_LABELS } from "./alertIssueLabels.mjs";
import { qCounter } from "./queueAllocator.mjs";
import { itemTitleKey } from "./openQueue.mjs";

export const FINDINGS = "docs/audit/launch-2026-09/findings.jsonl";
export const SNAPSHOT = "docs/audit/open-feeds.json";
export const FEEDS_HEADING = "## FEEDS — mirrored from the alert ledger, nightly-red issues and the audit bus (node scripts/open-sync-trackers.mjs)";

/**
 * The text to write for the feeds snapshot. When nothing but `measured_at`
 * changed, the previous text is kept byte for byte: a fresh timestamp alone
 * made every open-auto-tick run open a PR, whose merge re-deployed prod, whose
 * finished deploy re-ran open-auto-tick (a PR every ~5 min, #3089-#3102,
 * 2026-10-14). Nothing reads measured_at for freshness.
 */
export function snapshotText(prevText, snap) {
  const next = JSON.stringify(snap, null, 2) + "\n";
  if (prevText == null) return next;
  try {
    const { measured_at: _a, ...prev } = JSON.parse(prevText);
    const { measured_at: _b, ...cur } = snap;
    if (JSON.stringify(prev) === JSON.stringify(cur)) return prevText;
  } catch {
    // An unreadable previous snapshot is replaced.
  }
  return next;
}

const TAG = /feed: (issue #\d+|ledger [0-9a-f]{12}|bus [A-Z]+-\d+(?:#[\w-]+)?)/g;
const ITEM = /^- \[([ x~])\] \*\*(Q\d+)\b/;
const ITEM_START = /^(- \[|#)/;

/** Every queue item: id, state (" ", "~", "x"), line range [start, end) and full text. */
export function queueItems(md) {
  const lines = md.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = ITEM.exec(lines[i]);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !ITEM_START.test(lines[j])) j++;
    out.push({ id: m[2], state: m[1], start: i, end: j, text: lines.slice(i, j).join("\n") });
  }
  return out;
}

export const tagsOf = (text) => [...text.matchAll(TAG)].map((m) => m[1]);

/** Does this item carry a `feed:` tag, i.e. was it mirrored from an alert feed (its origin key)? */
export const isFeedMirrored = (text) => tagsOf(text).length > 0;

/** feed key -> ids of NOT-done items carrying its tag. */
export function mirrored(md) {
  const by = new Map();
  for (const it of queueItems(md)) {
    if (it.state === "x") continue;
    for (const k of tagsOf(it.text)) by.set(k, [...(by.get(k) ?? []), it.id]);
  }
  return by;
}

/** Keys with no not-done OPEN.md item, and keys on more than one. */
export function mirrorProblems(openKeys, md) {
  const by = mirrored(md);
  return {
    missing: openKeys.filter((k) => !by.has(k)),
    doubled: [...by].filter(([, ids]) => new Set(ids).size > 1).map(([k, ids]) => `${k} on ${[...new Set(ids)].join(", ")}`),
  };
}

/**
 * How many not-done OPEN.md items came from each feed (an item counts once per
 * feed), and how many red overnight checks the one test-robots item lists
 * (`robots`: its sub-lines, 0 when there is no such item).
 */
export function feedCounts(md) {
  const c = { ledger: 0, issue: 0, bus: 0, robots: 0 };
  for (const it of queueItems(md)) {
    if (it.state === "x") continue;
    const feeds = new Set(tagsOf(it.text).map((k) => k.split(" ")[0]));
    for (const f of feeds) c[f]++;
    if (isRobotsItem(it.text)) c.robots += robotMembersOf(it.text).length;
  }
  return c;
}

/**
 * ALL RED OVERNIGHT CHECKS ARE ONE ITEM (owner 2026-10-14, pop-up: "All failing
 * robot checks roll into ONE 'fix the test robots' item instead of 18"). Every
 * open nightly-red issue, and every open nightly_red ledger row, was its own
 * docs/OPEN.md item (18 on 2026-10-14: Q785, Q1275, Q1374, ... Q1815), so the
 * open count moved with how many robots were red, not with how much work there
 * was. They are now members of ONE item, marked ROBOTS_MARK, whose title
 * counts them and whose sub-lines name each workflow, its issue and its newest
 * red run. The sync rewrites the sub-lines every run (a member whose issue
 * closed drops off); the item stays open while any member is red and is ticked
 * when none is. Each red check is still fixed (standing order unchanged): only
 * the counting changed. Other alert labels (prod-down, schedule-stalled, ...)
 * and every other ledger row keep one item each.
 * Guard: src/test/openRobotsRollup.test.ts.
 */
export const ROBOTS_MARK = "rollup: nightly-red";
export const ROBOTS_GUARD = "src/test/openRobotsRollup.test.ts";
export const isRobotsItem = (text) => String(text).split("\n")[0].includes(ROBOTS_MARK);
const ROBOT_LINE = /^ {2}- (.+?): (issue #(\d+)|no open issue)\b(.*)$/;

/** The member sub-lines of a robots item: [{ workflow, issue, line }]. */
export function robotMembersOf(text) {
  return String(text).split("\n").slice(1)
    .map((l) => ROBOT_LINE.exec(l))
    .filter(Boolean)
    .map((m) => ({ workflow: m[1], issue: m[3] ? Number(m[3]) : null, line: m[0] }));
}

export function robotsTitle(n) {
  return `Fix the test robots: ${n} overnight check${n === 1 ? "" : "s"} red`;
}

/** The newest run URL in an issue's body and comments (nightly-issue-sync writes "Run:" / "Still red:"). */
export function newestRunUrl(texts) {
  let best = null;
  for (const t of texts ?? []) {
    for (const m of String(t ?? "").matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/(\d+)/g)) {
      if (!best || Number(m[1]) > Number(best.id)) best = { id: m[1], url: m[0] };
    }
  }
  return best?.url ?? null;
}

/** One sub-line of the robots item. `notes` (e.g. "notes: Q1374") is carried over from the line it replaces. */
function robotLine(m, notes) {
  const where = m.issue ? `issue #${m.issue}` : "no open issue";
  const run = m.run ? `, newest red run ${m.run}` : m.runUnknown ? ", newest red run: see the issue's latest comment" : "";
  return `  - ${m.workflow}: ${where}${run}.${notes ? ` ${notes}.` : ""} ${m.keys.map((k) => `feed: ${k}`).join(" · ")}`;
}

/** Open audit-bus findings from findings.jsonl text, as feed sources. */
export function busSources(text) {
  return foldFindings(parseFindingsLog(text))
    .filter((f) => !CLOSED_STATUSES.has(f.status) && f.id !== "V-001")
    .map((f) => ({
      keys: [`bus ${f.id}`],
      tier: tierOf(f.severity),
      title: `${f.severity}${f.launch_blocker ? " LAUNCH BLOCKER" : ""} audit finding ${f.id} (${f.surface}): ${oneLine(f.claim, 160)}`,
      origin: `audit-bus finding ${f.id} (\`node scripts/audit-bus.mjs show ${f.id}\`)`,
      markers: [`done-when: bus ${f.id} closed`],
    }));
}

/** Every bus id with its folded status (closed or not). */
export function busStatus(text) {
  return new Map(foldFindings(parseFindingsLog(text)).map((f) => [`bus ${f.id}`, CLOSED_STATUSES.has(f.status) ? "closed" : "open"]));
}

/**
 * Open ledger rows that are WORK. An informational admin notice ("New member
 * joined", "Dispute auto-resolved": public.admin_alert_close_rule(title) =
 * 'notice') is recorded on every post and closes on the next verify; it has
 * nothing to fix, so it is never mirrored into docs/OPEN.md. The real signups
 * re-opened "new member joined" 9 times and the mirror filed it as Q1580.
 * The rule table is the database's own, so a new notice title is excluded
 * without a second list here. Guard: src/test/openFeedsSkipNotices.test.ts.
 */
export const LEDGER_SQL = `SELECT fingerprint, source_kind, source, status, sample_ref,
       CASE WHEN source_kind = 'user-report' THEN 'a user report (read it on /admin?view=health)' ELSE title END AS title
  FROM public.ops_alert_ledger
 WHERE status <> 'closed'
   AND public.admin_alert_close_rule(title) IS DISTINCT FROM 'notice'
 ORDER BY first_seen`;

export const ledgerMarker = (fp) => `done-when: sql \`SELECT status FROM public.ops_alert_ledger WHERE fingerprint = '${fp}'\` => closed`;

/** Bus severity -> OPEN.md tier (src/test/openItemsHaveTier.test.ts). POLISH is LOW; unknown is MEDIUM. */
export const tierOf = (sev) => ({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", POLISH: "LOW" })[String(sev ?? "").toUpperCase()] ?? "MEDIUM";

const oneLine = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const bare = (t) => String(t ?? "").toLowerCase().replace(/^(nightly-red:\s*)+/, "").trim();

/**
 * Every OPEN issue under an alert label, once each, with the label it was
 * found under. `list(label)` returns `gh issue list --label <label> --state
 * open --json number,title`. Before 2026-10-03 the feed read nightly-red
 * only, and schedule-stalled #2196 reached no list.
 */
export function openAlertIssues(list) {
  const seen = new Map();
  for (const label of ALERT_LABELS) {
    for (const i of list(label) ?? []) {
      if (seen.has(i.number)) continue;
      const comments = Array.isArray(i.comments) ? i.comments : [];
      const run = label === "nightly-red" ? newestRunUrl([i.body, ...comments.map((c) => c?.body)]) : null;
      // gh returns an issue's FIRST 100 comments only; past that the newest run is not in hand.
      const runTruncated = comments.length >= 100;
      seen.set(i.number, { number: i.number, title: i.title, label, ...(label === "nightly-red" ? { run: runTruncated ? null : run, runTruncated } : {}) });
    }
  }
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

/** The queue-item title for an alert issue: "<nightly title> is red", else "<label>: <title>" without a leading emoji. */
function issueTitle(i, label) {
  if (label === "nightly-red") return `${i.title} is red`;
  const t = String(i.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "");
  return t.toLowerCase().startsWith(`${label}:`) ? t : `${label}: ${t}`;
}

/**
 * One source group per mirrored item. A nightly_red ledger row joins its
 * issue by sample_ref.issue, else by title ("nightly-red: nightly-red: X").
 * An issue with no `label` (a snapshot from before labels were recorded) is
 * nightly-red.
 */
export function groupSources({ ledger, issues }) {
  const groups = [];
  const byIssue = new Map();
  for (const i of issues ?? []) {
    const label = i.label ?? "nightly-red";
    const g = {
      keys: [`issue #${i.number}`],
      title: issueTitle(i, label),
      origin: `${label} issue #${i.number}`,
      markers: [`done-when: issue #${i.number} closed`],
      issue: i,
      label,
      ...(ALERT_ISSUE_LABELS[label]?.severity === "critical" ? { tier: "HIGH" } : {}),
    };
    groups.push(g);
    byIssue.set(i.number, g);
  }
  for (const r of ledger ?? []) {
    const key = `ledger ${r.fingerprint.slice(0, 12)}`;
    const ref = typeof r.sample_ref === "string" ? safeJson(r.sample_ref) : r.sample_ref ?? {};
    let g = r.source_kind === "nightly_red" ? byIssue.get(Number(ref?.issue)) : null;
    if (!g && r.source_kind === "nightly_red") g = groups.find((x) => x.issue && bare(x.issue.title) === bare(r.title));
    if (g) {
      g.keys.push(key);
      g.origin += ` and alert-ledger row ${r.fingerprint.slice(0, 12)}`;
      g.markers.push(ledgerMarker(r.fingerprint));
      continue;
    }
    groups.push({
      keys: [key],
      title: `${r.title}`,
      origin: `alert-ledger row ${r.fingerprint.slice(0, 12)} (${r.source_kind}: ${r.source}; \`node scripts/ops-alert-ledger.mjs list\`)`,
      markers: [ledgerMarker(r.fingerprint)],
      ...(r.source_kind === "nightly_red" ? { robotTitle: r.title } : {}),
    });
  }
  return rollUpRobots(groups);
}

/** Every nightly-red issue group and nightly_red ledger group becomes one member of ONE robots group. */
function rollUpRobots(groups) {
  const isRobot = (g) => g.label === "nightly-red" || g.robotTitle !== undefined;
  const robots = groups.filter(isRobot);
  if (!robots.length) return groups;
  const members = robots.map((g) => ({
    workflow: String(g.issue?.title ?? g.robotTitle ?? "").replace(/^(nightly-red:\s*)+/i, "").trim() || "unknown",
    issue: g.issue?.number ?? null,
    run: g.issue?.run ?? null,
    runUnknown: Boolean(g.issue && !g.issue.run && g.issue.runTruncated),
    keys: g.keys,
  })).sort((a, b) => (a.issue ?? Infinity) - (b.issue ?? Infinity) || a.workflow.localeCompare(b.workflow));
  const rollup = {
    keys: members.flatMap((m) => m.keys),
    title: robotsTitle(members.length),
    origin: `${members.length} red overnight check(s)`,
    markers: [],
    robots: members,
  };
  const at = groups.findIndex(isRobot);
  const rest = groups.filter((g) => !isRobot(g));
  rest.splice(at, 0, rollup);
  return rest;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

function escapeRegExpLiteral(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Exact tokens that let an existing item cover a source key. */
function coverTokens(key) {
  const [feed, id] = key.split(" ");
  if (feed === "issue") return [new RegExp(`(?<![\\w#])${id}(?!\\d)`), new RegExp(`issues/${id.slice(1)}(?!\\d)`)];
  if (feed === "ledger") return [new RegExp(escapeRegExpLiteral(id))];
  return [new RegExp(`(?<![\\w-])${escapeRegExpLiteral(id)}(?![\\w-]|#)`)];
}

/**
 * Apply open source groups to OPEN.md text.
 *   status(key) -> "open" | "closed" | null (feed unreadable: leave it alone)
 * Returns { md, created: [{id, keys}], attached: [{id, keys}], flipped: [id], ambiguous: [{keys, ids}] }.
 *
 * A source whose name opens the first line of MORE than one open item is
 * AMBIGUOUS: it is neither attached nor filed again (a new item would be one
 * more copy of it), but returned so the sync exits 1 until a human tags the
 * one item that owns it (2026-10-02: issue #1719 opened 10 items, #1582 9).
 */
export function applyFeeds(md, groups, { status, nextFree, today, robotsReadable = true }) {
  const created = [], attached = [], flipped = [], ambiguous = [], robots = [];
  let lines = md.split("\n");
  const snapshotMd = () => lines.join("\n");
  const newItems = [];
  const take = qCounter(nextFree);

  // The test-robots item is rewritten whole, and only when both feeds were read
  // (a member list from half a measurement would drop red checks).
  if (robotsReadable) {
    const g = groups.find((x) => x.robots);
    const items = queueItems(snapshotMd());
    const current = items.find((it) => it.state !== "x" && isRobotsItem(it.text));
    if (g) {
      const elsewhere = items.filter((it) => it.state !== "x" && it !== current && g.keys.some((k) => tagsOf(it.text).includes(k)));
      if (elsewhere.length) {
        ambiguous.push({ keys: g.keys.filter((k) => elsewhere.some((it) => tagsOf(it.text).includes(k))), ids: elsewhere.map((it) => it.id) });
      } else {
        // A member's "notes: Qn" (the item its history lives in) is carried over by its issue, else its workflow.
        const memberKey = (m) => (m.issue ? `#${m.issue}` : m.workflow.toLowerCase());
        const notes = new Map((current ? robotMembersOf(current.text) : []).map((m) => [memberKey(m), /\b(notes: Q\d+(?:, Q\d+)*)/.exec(m.line)?.[1]]));
        const body = g.robots.map((m) => robotLine(m, notes.get(memberKey(m))));
        const id = current ? current.id : take();
        const head = `- [ ] **${id} MEDIUM ${g.title}.** One item for every red overnight check (owner 2026-10-14: "All failing robot checks roll into ONE 'fix the test robots' item instead of 18"); each one below still gets a root cause, a fix and a green re-run of its own workflow. Rewritten by \`scripts/open-sync-trackers.mjs\` on every sync; it is ticked when no check is red. Guard ${ROBOTS_GUARD}. ${ROBOTS_MARK}`;
        if (current) {
          // keep the blank lines that close the item's span (the gap before the next heading)
          const span = lines.slice(current.start, current.end);
          let trailing = 0;
          while (trailing < span.length - 1 && !span[span.length - 1 - trailing].trim()) trailing++;
          lines.splice(current.start, current.end - current.start, head, ...body, ...Array(trailing).fill(""));
        }
        else newItems.push(head, ...body);
        robots.push({ id, members: g.robots.length, created: !current });
      }
    } else {
      const current2 = queueItems(snapshotMd()).find((it) => it.state === " " && isRobotsItem(it.text));
      if (current2) {
        // No check is red: the item is done. Its guard is named in its own text.
        lines.splice(current2.start, current2.end - current2.start,
          lines[current2.start].replace(/^- \[ \]/, "- [x]").replace(/\*\*(Q\d+) MEDIUM Fix the test robots: \d+ overnight checks? red\.\*\*/, `**$1 MEDIUM Fix the test robots: 0 overnight checks red.** DONE ${today}: no overnight check is red.`));
        robots.push({ id: current2.id, members: 0, created: false });
      }
    }
  }

  for (const g of groups) {
    if (g.robots) continue;
    const by = mirrored(snapshotMd());
    const items = queueItems(snapshotMd());
    const tagged = g.keys.map((k) => by.get(k)?.[0]).find(Boolean);
    const missing = (id) => g.keys.filter((k) => !(by.get(k) ?? []).includes(id));
    let target = tagged ? items.find((it) => it.id === tagged && it.state !== "x") : null;
    if (!target) {
      // An existing OPEN (never partly-done: that would move the markerless
      // [~] baseline) queue item whose FIRST line names exactly this source
      // covers it. Only the first line: a later paragraph that mentions an
      // issue in passing (Q743 citing #1890) is not the item for it.
      const hits = items.filter((it) => it.state === " " && g.keys.some((k) => coverTokens(k).some((re) => re.test(it.text.split("\n")[0]))));
      if (hits.length === 1) target = hits[0];
      else if (hits.length > 1) { ambiguous.push({ keys: g.keys, ids: hits.map((it) => it.id) }); continue; }
    }
    if (target) {
      const add = missing(target.id);
      if (!add.length) continue;
      const idx = g.keys.map((k, n) => (add.includes(k) ? n : -1)).filter((n) => n >= 0);
      // A partly-done item with NO done-when marker keeps none: giving it one
      // moves the exact markerless-[~] baseline
      // (src/test/openPartlyDoneItemsSayDoneWhen.test.ts), so the scoreboard
      // refresh PR could never go green (#2423, 2026-10-06: Q593, whose marker
      // the lead removed on purpose, got `done-when: issue #2375 closed` when
      // its tagged ledger row moved to a new issue). The feed tag still
      // attaches, so the source stays mirrored on one item.
      const keepMarkerless = target.state === "~" && !/done-when:/.test(target.text);
      const markers = keepMarkerless ? [] : idx.map((n) => g.markers[n]).filter((m) => !target.text.includes(m));
      const suffix = ` ${add.map((k) => `feed: ${k}`).join(" · ")}. ${markers.join(", ")}`.replace(/\.\s*$/, ".");
      const last = target.end - 1 - [...lines.slice(target.start, target.end)].reverse().findIndex((l) => l.trim());
      lines[last] = lines[last].replace(/\s*$/, "") + suffix.replace(/\s+$/, "");
      attached.push({ id: target.id, keys: add });
      continue;
    }
    const tier = g.tier ?? "MEDIUM";
    const title = oneLine(g.title, 170).replace(/\.$/, "");
    // The same problem already has an OPEN item (owner 2026-10-14: "the same
    // item merges if it already has an item open"): attach the source to it
    // with a dated note instead of filing a second number.
    const key = itemTitleKey(`- [ ] **Q0 ${tier} ${title}.**`);
    const same = key ? items.filter((it) => it.state !== "x" && !isRobotsItem(it.text) && itemTitleKey(it.text.split("\n")[0]) === key) : [];
    if (same.length) {
      const t = same[0];
      const add = g.keys.filter((k) => !tagsOf(t.text).includes(k));
      const keepMarkerless = t.state === "~" && !/done-when:/.test(t.text);
      const markers = keepMarkerless ? [] : g.markers.filter((m) => !t.text.includes(m));
      const last = t.end - 1 - [...lines.slice(t.start, t.end)].reverse().findIndex((l) => l.trim());
      lines[last] = `${lines[last].replace(/\s*$/, "")} **Seen again ${today}** (${g.origin}). ${add.map((k) => `feed: ${k}`).join(" · ")}. ${markers.join(", ")}`.replace(/[.\s]+$/, ".");
      attached.push({ id: t.id, keys: add, seenAgain: true });
      continue;
    }
    const id = take();
    newItems.push(`- [ ] **${id} ${title.startsWith(`${tier} `) ? "" : `${tier} `}${title}.** Mirrored ${today} from ${g.origin} by \`scripts/open-sync-trackers.mjs\`: find the root cause, fix it, re-run the source's own detector. ${g.keys.map((k) => `feed: ${k}`).join(" · ")}. ${g.markers.join(", ")}`);
    created.push({ id, keys: g.keys });
  }

  if (newItems.length) {
    let h = lines.indexOf(FEEDS_HEADING);
    if (h < 0) {
      const carried = lines.findIndex((l) => l.startsWith("## CARRIED"));
      const at = carried >= 0 ? carried : lines.length;
      lines.splice(at, 0, FEEDS_HEADING, "", "Each item mirrors one open problem; its `feed:` tags are sticky (never edit them) and its `done-when:` holds once the source closes, when the sync flips it to `[~]`. The same problem seen again while its item is open is attached to that item (marked Seen again), never filed twice; every red overnight check is one sub-line of the ONE Fix the test robots item, which the sync rewrites.", "");
      h = at;
    }
    let at = h + 1;
    while (at < lines.length && !lines[at].startsWith("## ")) at++;
    while (at > h + 1 && !lines[at - 1].trim()) at--;
    if (!/^(- \[|  )/.test(lines[at - 1])) newItems.unshift("");
    lines.splice(at, 0, ...newItems);
  }

  // A source that CLOSED: its open item becomes partly done, and
  // scripts/open-done-when.mjs confirms and reports it READY to tick.
  for (const it of queueItems(snapshotMd())) {
    if (it.state !== " " || isRobotsItem(it.text)) continue;
    const keys = tagsOf(it.text);
    if (!keys.length) continue;
    const st = keys.map((k) => status(k));
    if (st.every((s) => s === "closed")) {
      lines[it.start] = lines[it.start].replace(/^- \[ \]/, "- [~]");
      flipped.push(it.id);
    }
  }
  return { md: lines.join("\n"), created, attached, flipped, ambiguous, robots };
}
