/**
 * docs/OPEN.md is the ONE open-work list (owner, 2026-09-27: "can this just be
 * merged into open so we aren't tracking several different things").
 *
 * The other trackers are FEEDS into it: the ops alert ledger
 * (public.ops_alert_ledger), the open nightly-red GitHub issues and the audit
 * bus (docs/audit/launch-2026-09/findings.jsonl). Each open source item is
 * mirrored by exactly one OPEN.md queue item carrying a sticky tag:
 *
 *   feed: issue #1921          a nightly-red issue
 *   feed: ledger 88ecf6e765df  an ops_alert_ledger row (first 12 hex of its fingerprint)
 *   feed: bus NB-004           an audit-bus finding
 *
 * A nightly-red ledger row and its GitHub issue are ONE source and share one
 * item (both tags). scripts/open-sync-trackers.mjs writes the tags;
 * src/test/openFeedsMirrored.test.ts fails when an open source has none.
 */
import { CLOSED_STATUSES, foldFindings, parseFindingsLog } from "./auditFindings.mjs";

export const FINDINGS = "docs/audit/launch-2026-09/findings.jsonl";
export const SNAPSHOT = "docs/audit/open-feeds.json";
export const FEEDS_HEADING = "## FEEDS — mirrored from the alert ledger, nightly-red issues and the audit bus (node scripts/open-sync-trackers.mjs)";

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

/** How many not-done OPEN.md items came from each feed (an item counts once per feed). */
export function feedCounts(md) {
  const c = { ledger: 0, issue: 0, bus: 0 };
  for (const it of queueItems(md)) {
    if (it.state === "x") continue;
    const feeds = new Set(tagsOf(it.text).map((k) => k.split(" ")[0]));
    for (const f of feeds) c[f]++;
  }
  return c;
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

export const LEDGER_SQL = `SELECT fingerprint, source_kind, source, status, sample_ref,
       CASE WHEN source_kind = 'user-report' THEN 'a user report (read it on /admin?view=health)' ELSE title END AS title
  FROM public.ops_alert_ledger WHERE status <> 'closed' ORDER BY first_seen`;

export const ledgerMarker = (fp) => `done-when: sql \`SELECT status FROM public.ops_alert_ledger WHERE fingerprint = '${fp}'\` => closed`;

/** Bus severity -> OPEN.md tier (src/test/openItemsHaveTier.test.ts). POLISH is LOW; unknown is MEDIUM. */
export const tierOf = (sev) => ({ HIGH: "HIGH", MEDIUM: "MEDIUM", LOW: "LOW", POLISH: "LOW" })[String(sev ?? "").toUpperCase()] ?? "MEDIUM";

const oneLine = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").replace(/\*\*/g, "").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const bare = (t) => String(t ?? "").toLowerCase().replace(/^(nightly-red:\s*)+/, "").trim();

/**
 * One source group per mirrored item. A nightly_red ledger row joins its
 * issue by sample_ref.issue, else by title ("nightly-red: nightly-red: X").
 */
export function groupSources({ ledger, issues }) {
  const groups = [];
  const byIssue = new Map();
  for (const i of issues ?? []) {
    const g = {
      keys: [`issue #${i.number}`],
      title: `${i.title} is red`,
      origin: `nightly-red issue #${i.number}`,
      markers: [`done-when: issue #${i.number} closed`],
      issue: i,
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
    });
  }
  return groups;
}

function safeJson(s) { try { return JSON.parse(s); } catch { return {}; } }

/** Exact tokens that let an existing item cover a source key. */
function coverTokens(key) {
  const [feed, id] = key.split(" ");
  if (feed === "issue") return [new RegExp(`(?<![\\w#])${id}(?!\\d)`), new RegExp(`issues/${id.slice(1)}(?!\\d)`)];
  if (feed === "ledger") return [new RegExp(id)];
  return [new RegExp(`(?<![\\w-])${id.replace(/[#]/g, "\\#")}(?![\\w-]|#)`)];
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
export function applyFeeds(md, groups, { status, nextFree, today }) {
  const created = [], attached = [], flipped = [], ambiguous = [];
  let lines = md.split("\n");
  const snapshotMd = () => lines.join("\n");
  const newItems = [];
  let next = nextFree;

  for (const g of groups) {
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
      const suffix = ` ${add.map((k) => `feed: ${k}`).join(" · ")}. ${idx.map((n) => g.markers[n]).filter((m) => !target.text.includes(m)).join(", ")}`.replace(/\.\s*$/, ".");
      const last = target.end - 1 - [...lines.slice(target.start, target.end)].reverse().findIndex((l) => l.trim());
      lines[last] = lines[last].replace(/\s*$/, "") + suffix.replace(/\s+$/, "");
      attached.push({ id: target.id, keys: add });
      continue;
    }
    const id = `Q${next++}`;
    const tier = g.tier ?? "MEDIUM";
    const title = oneLine(g.title, 170).replace(/\.$/, "");
    newItems.push(`- [ ] **${id} ${title.startsWith(`${tier} `) ? "" : `${tier} `}${title}.** Mirrored ${today} from ${g.origin} by \`scripts/open-sync-trackers.mjs\`: find the root cause, fix it, re-run the source's own detector. ${g.keys.map((k) => `feed: ${k}`).join(" · ")}. ${g.markers.join(", ")}`);
    created.push({ id, keys: g.keys });
  }

  if (newItems.length) {
    let h = lines.indexOf(FEEDS_HEADING);
    if (h < 0) {
      const carried = lines.findIndex((l) => l.startsWith("## CARRIED"));
      const at = carried >= 0 ? carried : lines.length;
      lines.splice(at, 0, FEEDS_HEADING, "", "Each item mirrors one open source; its `feed:` tag is sticky (never edit it) and its `done-when:` holds once the source closes, when the sync flips it to `[~]`.", "");
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
    if (it.state !== " ") continue;
    const keys = tagsOf(it.text);
    if (!keys.length) continue;
    const st = keys.map((k) => status(k));
    if (st.every((s) => s === "closed")) {
      lines[it.start] = lines[it.start].replace(/^- \[ \]/, "- [~]");
      flipped.push(it.id);
    }
  }
  return { md: lines.join("\n"), created, attached, flipped, ambiguous };
}
