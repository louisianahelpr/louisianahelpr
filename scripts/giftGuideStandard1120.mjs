/**
 * THE STANDARD (owner 11-20, ~/.lh-shots/gg-reference-1120/STANDARD.md; verified plan in
 * scripts/gift-guide-standard-1120.json, built by scripts/gift-guide-standard-1120-build.mjs): the LAST pass
 * scripts/gift-guide-picks.mjs makes. Each planned guide ends as the plan lists it:
 *   - every pick the plan cuts leaves the page (a cut the plan left as an owner call stays where it was);
 *   - each kept pick sits in the plan's section, in the plan's order, with the plan's shopper reason (a kept pick the
 *     plan gives no reason keeps the line it had);
 *   - a pick on the page the plan never listed (neither kept nor cut) leaves too and is reported (the plan wins over
 *     later reworks); a sponsor or one of the owner's own picks is never dropped: it stays after the pick it followed;
 *   - the old section ids of the guide open its top (aliases).
 * Picks match on name + href; a renamed pick matches on its href alone when one pick on the page has it, then on its
 * name alone. A kept pick an earlier pass took off the page comes back (ctx.snapshots: the pages before those passes).
 * Nothing new is ever added. Guard: src/test/giftGuideStandard1120.test.ts.
 */
const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function findPick(list, used, want) {
  const free = list.filter((p) => !used.has(p));
  const both = free.find((p) => p.name === want.name && (p.href ?? "") === (want.href ?? ""));
  if (both) return both;
  if (want.href) {
    const byHref = free.filter((p) => p.href === want.href);
    if (byHref.length === 1) return byHref[0];
    const n = byHref.find((p) => fold(p.name) === fold(want.name));
    if (n) return n;
  }
  const byName = free.filter((p) => fold(p.name) === fold(want.name));
  if (byName.length === 1) return byName[0];
  if (byName.length) return undefined;
  // A later rename of the same pick: the brand dropped from the front ("Fable Pets Fable Bed" -> "Fable Bed") or a
  // business given its product ("Basic Bee" -> "Basic Bee Bitty Bit of Honey Gift Set"). Only when exactly one fits.
  const w = fold(want.name);
  const near = free.filter((p) => { const n = fold(p.name); return n.length > 5 && w.length > 5 && (w.endsWith(` ${n}`) || n.startsWith(`${w} `) || n.startsWith(`${w}s `)); });
  return near.length === 1 ? near[0] : undefined;
}

export function applyStandard(pageList, spec, ctx = {}) {
  const missing = [];
  const extras = [];
  const aliases = {};
  const counts = { guides: 0, kept: 0, restored: 0, cut: 0, ownerCall: 0, extraOut: 0, extraKept: 0 };
  const kept = [];
  const snaps = [...(ctx.snapshots ?? [])].reverse();
  const none = new Set();
  const restore = (slug, want) => {
    for (const s of snaps) { const p = findPick(s[slug] ?? [], none, want); if (p) return p; }
    for (const s of [pageList, ...snaps]) for (const [k, l] of Object.entries(s)) { if (k === slug) continue; const p = findPick(l, none, want); if (p) return p; }
    return undefined;
  };
  for (let [slug, g] of Object.entries(spec.guides ?? {})) {
    const list = pageList[slug];
    if (!list?.length) { missing.push(`${slug}: no guide`); continue; }
    counts.guides++;
    const used = new Set();
    const ownFrom = list.some((p) => p.from === slug);
    const placed = new Map(); // old pick -> section index
    // A section that keeps its heading keeps its id (Kids "babies"): old links, the finder and the anchors still land.
    const idOf = new Map(list.filter((p) => p.sectionId && p.section).map((p) => [p.section, p.sectionId]));
    const taken = new Set(g.sections.map((x) => x.id));
    g = { ...g, sections: g.sections.map((x) => (idOf.has(x.title) && !taken.has(idOf.get(x.title)) ? { ...x, id: idOf.get(x.title) } : x)) };
    const secs = g.sections.map(() => []);
    g.sections.forEach((sec, i) => {
      for (const want of sec.picks) {
        const p = findPick(list, used, want);
        if (!p) {
          // An earlier pass took it off this page (a by-use re-cut, a cap, a move): the plan wins, so it comes back as
          // the pipeline last had it (this guide's earlier states first, then any guide now, then any guide earlier).
          const back = restore(slug, want);
          if (!back) { missing.push(`${slug}: keep "${want.name}"`); continue; }
          secs[i].push({ ...back, ...(ownFrom ? { from: slug } : {}), ...(want.line ? { line: want.line } : {}), section: sec.title, sectionId: sec.id });
          counts.kept++;
          counts.restored++;
          continue;
        }
        used.add(p);
        placed.set(p, i);
        secs[i].push({ ...p, ...(want.line ? { line: want.line } : {}), section: sec.title, sectionId: sec.id });
        counts.kept++;
      }
    });
    const gone = new Set();
    for (const want of g.cut ?? []) {
      const p = findPick(list, used, want);
      if (!p) continue; // already off the page
      used.add(p);
      gone.add(p);
      counts.cut++;
    }
    // What is left: the owner's calls and picks the plan never saw. Each stays after the kept pick it followed.
    const calls = new Set();
    for (const want of g.ownerCall ?? []) { const p = findPick(list, new Set([...used].filter((x) => !calls.has(x))), want); if (p) calls.add(p); }
    let at = 0;
    for (const p of list) {
      if (placed.has(p)) { at = placed.get(p); continue; }
      if (gone.has(p)) continue;
      const sec = g.sections[at];
      // The plan wins: a pick it never listed leaves (reported), unless it is the owner's call, a sponsor or her own pick.
      // A sponsor's pick the plan keeps on another guide lives there only (one place per item; store pages do not count).
      const elsewhere = !calls.has(p) && Object.entries(spec.guides).some(([k, o]) => k !== slug && !k.startsWith("store-") && o.sections.some((x) => x.picks.some((w) => (w.href && w.href === p.href) || fold(w.name) === fold(p.name))));
      if ((!calls.has(p) && !p.sponsor && !p.ownerPick) || elsewhere) { counts.extraOut++; extras.push(`${slug}: "${p.name}"`); continue; }
      secs[at].push({ ...p, section: sec.title, sectionId: sec.id });
      if (calls.has(p)) counts.ownerCall++;
      else { counts.extraKept++; kept.push(`${slug}: "${p.name}"`); }
    }
    pageList[slug] = secs.flat();
    const ids = new Set(g.sections.map((s) => s.id));
    const oldIds = [...new Set(list.map((p) => p.sectionId).filter(Boolean))].filter((k) => !ids.has(k));
    aliases[slug] = Object.fromEntries([...Object.keys(ctx.aliases?.[slug] ?? {}), ...oldIds].filter((k) => !ids.has(k)).map((k) => [k, ""]));
    for (const k of Object.keys(ctx.anchors ?? {})) if (ctx.parentOf?.(k) === slug && !ids.has(ctx.anchors[k])) delete ctx.anchors[k];
  }
  return { counts, missing, extras, kept, aliases };
}
