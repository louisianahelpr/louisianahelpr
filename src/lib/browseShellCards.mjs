/**
 * /browse's first job cards IN THE RAW HTML (PERF-SHELL, Q652; lead decision 11-01 on Builder 62's question).
 *
 * WHY. A guest's /browse waited for the whole app (~3.5-4.4 s of JS on Slow 4G, lab LCP 4448 ms) before its first
 * card painted. api/share.ts already serves /browse (vercel.json rewrite) and reads the public, masked
 * open_jobs_browse view with the anon key, so it now puts the first few cards into the HTML itself. main.tsx keeps
 * them on screen over the booting app (a fixed overlay), and DashboardGuest removes them once its own list has
 * drawn (src/boot/browseShellHandoff.ts).
 *
 * WHAT A CARD MAY CARRY (lead, 11-01): ONLY what a guest already sees on Guest Browse: title, category, town (the
 * view's mask_job_location value, never a street) and the take-home. Only live, open, non-seed, non-test jobs. No
 * address, no name, no coordinates, no description, no photos, no ids in the markup. A title is free text, so a
 * title this file's check flags is LEFT OUT (the job's card is not drawn), never shortened or rewritten.
 *
 * Plain dependency-free ESM on purpose, like publicPageMeta.mjs: the serverless function imports it at runtime with
 * no TypeScript step and no path aliases. The figures and labels that the app computes in TypeScript are restated
 * here, and src/test/browseShellCards.test.tsx holds each one equal to the app's own (take-home = guestTakeHome,
 * labels = JOB_CATEGORY_LABELS, card classes = the rendered guest JobCard's), so they cannot drift.
 * Types: browseShellCards.d.mts.
 */

/** TIER_PERKS.free.platformFeePercent: the rate every guest card is priced at (DashboardGuest, GUEST_FEE_PERCENT). */
export const SHELL_GUEST_FEE_PERCENT = 12;
/** helprFlatFee.ts HELPR_FLAT_FEE_PERCENT / HELPR_FLAT_FEE_CENTS / the giveaway stamp. */
const FLAT_PERCENT = 10;
const FLAT_CENTS = 70;
const GIVEAWAY_FLAT_CENTS = 700;

/** How many cards the HTML carries: a phone screenful at 375x812 (the first screen is all LCP looks at). */
export const SHELL_CARD_COUNT = 4;

/** Copy of JOB_CATEGORY_LABELS (src/lib/jobCategories.ts); the test holds them equal. */
export const SHELL_CATEGORY_LABELS = {
  cleaning: "Cleaning",
  yard_work: "Yard work",
  handyman: "Handyman",
  moving: "Moving",
  errands: "Errands",
  declutter_help: "Declutter help",
  delivery: "Delivery",
  pet_care: "Pet care",
  assembly: "Assembly",
  painting: "Painting",
  storm_prep: "Storm prep",
  events: "Events",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  roofing: "Roofing",
  welding: "Welding",
  carpentry: "Carpentry",
  auto_repair: "Auto & small engine",
  appliance_repair: "Appliance repair",
  flooring: "Flooring & tile",
  concrete_masonry: "Concrete & masonry",
  fencing: "Fencing",
  pressure_washing: "Pressure washing",
  other: "Other",
};

/** The columns api/share.ts selects. Nothing else is read, so nothing else can reach the markup. */
export const SHELL_JOB_COLUMNS =
  "title,category,budget,location,status,expires_at,boost_expires_at,boosted_at,created_at,is_urgent,urgent_fee,is_group_job,helpers_needed,helper_fee_flat_cents,helper_fee_percent";

/**
 * The anon REST read api/share.ts (and the lab's dist server, scripts/perf/cwv-lab.mjs) makes: the masked
 * open_jobs_browse view, open jobs only, the guest feed's own filter, order and limit (src/lib/guestJobsQuery.ts),
 * only the drawn columns.
 */
export function browseShellRowsUrl(supabaseUrl) {
  const u = new URL(`${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", SHELL_JOB_COLUMNS);
  u.searchParams.set("status", "eq.open");
  u.searchParams.set("payment_status", "neq.abandoned");
  u.searchParams.set("order", "boosted_at.desc.nullslast,created_at.desc");
  u.searchParams.set("limit", "40");
  return u.toString();
}

/**
 * The anon RPC that answers the view's own seed predicate (`NOT is_seed OR NOT seed_hidden_in_discovery()`, in
 * open_jobs_browse's WHERE; GRANTed to anon in 20261007033530). The view does not expose `is_seed`, so the view
 * alone hides seed and test jobs only while that switch hides them. api/share.ts (and the lab server) ask it
 * beside the rows read, and the HTML draws cards ONLY when it answers exactly `true` (lh-authz-rls should-fix,
 * 11-01): with the switch showing test rows, or any failed or odd answer, the page carries no cards.
 */
export function browseShellSeedsHiddenUrl(supabaseUrl) {
  return `${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/rpc/seed_hidden_in_discovery`;
}

/** The rows the HTML may draw from: the read's rows only when seed jobs are known hidden from anon, else null. */
export function shellRowsWhenSeedsHidden(rows, seedsHidden) {
  return seedsHidden === true && Array.isArray(rows) ? rows : null;
}

const blank = (v) => v === null || v === undefined || v === "";

function isFlat(job) {
  return !blank(job.helper_fee_flat_cents) && Number.isFinite(Number(job.helper_fee_flat_cents));
}

/** helprFlatFeeCents for a guest (no poster flat fee is in the view). */
function flatFeeCents(shareCents, job) {
  const share = Math.max(0, Math.round(Number(shareCents) || 0));
  if (share === 0) return 0;
  const flat = isFlat(job);
  const pctRaw = flat ? job.helper_fee_percent : null;
  if (flat && Number(job.helper_fee_flat_cents) === 0 && (blank(pctRaw) || Number(pctRaw) === 0)) return 0;
  const pct = blank(pctRaw) || !Number.isFinite(Number(pctRaw)) ? FLAT_PERCENT : Number(pctRaw);
  const cents = flat ? Math.max(0, Math.round(Number(job.helper_fee_flat_cents))) : FLAT_CENTS;
  return Math.min(share, Math.round((share * pct) / 100) + cents);
}

/** True for the giveaway's fixed-pay stamp (its pay is shown with no "take home" words). */
export function shellIsGiveaway(job) {
  return isFlat(job) && Number(job.helper_fee_flat_cents) === GIVEAWAY_FLAT_CENTS;
}

/**
 * guestTakeHome (GuestJobPreview.tsx) for a guest: computeNet at the free tier, the group split, the fee stamp, no
 * first-payout fee (a guest has no profile). Whole dollars, floored like formatPriceFloor. Null with no budget.
 */
export function shellTakeHomeDollars(job) {
  const budget = typeof job.budget === "number" ? job.budget : Number(job.budget);
  if (!(Number.isFinite(budget) && budget > 0)) return null;
  const helpers = job.is_group_job && job.helpers_needed > 0 ? job.helpers_needed : 1;
  const perHelper = budget / helpers;
  const urgentCents = Math.round((Number(job.urgent_fee) || 0) * 100);
  const urgent = urgentCents > 0 ? urgentCents / 100 : 0;
  const commission = isFlat(job)
    ? flatFeeCents(Math.round(perHelper * 100) + Math.round((urgent / helpers) * 100), job) / 100
    : perHelper * (SHELL_GUEST_FEE_PERCENT / 100);
  const net = perHelper - commission + urgent / helpers;
  if (!(net > 0)) return null;
  return Math.floor(Math.round(net * 100) / 100);
}

/** getCity (src/lib/locationUtils.ts): the town, never anything before it. */
export function shellTown(location) {
  if (!location) return "";
  let parts = String(location).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts[parts.length - 1];
  const stateOrZip = /^\d{5}(-\d{4})?$/.test(last) || /^[A-Za-z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last);
  if (stateOrZip && parts.length > 1) parts = parts.slice(0, -1);
  return parts[parts.length - 1] ?? "";
}

/**
 * Why a title must NOT be drawn into the HTML, or null when it may. Stricter than the app's contact-leak scanner
 * (messageScanner.ts, which the database's write trigger already applies to every title): the test runs every
 * phone/email/payment fixture through both and requires this to flag all the scanner flags. On top of it, anything
 * that looks like a street address or house number, a web address, or a test or seed post.
 */
export function shellTitleProblem(title) {
  const t = String(title ?? "").normalize("NFKC").trim();
  if (!t) return "empty";
  if (t.length > 120) return "long";
  if (/[0-9]{3,}/.test(t.replace(/[^0-9a-zA-Z]/g, ""))) return "digits"; // phone, house number, zip, spelled-out run
  if (/(zero|one|two|three|four|five|six|seven|eight|nine|oh|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)([^a-z0-9]+(zero|one|two|three|four|five|six|seven|eight|nine|oh|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)){6,}/i.test(t)) return "spelled-number";
  if (/@|https?:|www\.|\.(com|net|org|io|co|us|me)\b/i.test(t)) return "contact";
  if (/\b(venmo|cash\s*app|cashapp|zelle|paypal|apple\s*pay|google\s*pay|crypto|bitcoin|btc|eth|whatsapp|telegram|text\s*me|call\s*me|dm\s*me|my\s*number|my\s*email|off\s*the\s*app|outside\s*the\s*app|pay\s*me\s*direct|cash\s*only|in\s*cash|skip\s*the\s*fee|avoid\s*the\s*fee|pay\s*outside|hit\s*me\s*up|contact\s*me\s*at|reach\s*me\s*at|send\s*money\s*to|mi\s*n[uú]mero|mi\s*correo)\b/i.test(t)) return "contact";
  if (/[0-9]+\s*[A-Za-z]?\s+[A-Za-z]+.*\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|hwy|highway|ct|court|cir|circle|pkwy|parkway|pl|place|way|trl|trail)\b/i.test(t)) return "address";
  if (/\b(test|testing|tester|e2e|seed|seeded|qa|dummy|fake|sample|lorem)\b/i.test(t)) return "test";
  return null;
}

/**
 * The rows the HTML may draw, in the feed's own lead order (urgent, then a live boost, then newest), at most
 * SHELL_CARD_COUNT. Open only (an accepted crew with spots left is left to the app), not expired, a clean title,
 * a known category and town, a take-home. `is_seed` is not in the view: open_jobs_browse already hides seed jobs
 * from discovery (seed_hidden_in_discovery), and a seed row that still carries the flag is dropped here too.
 */
export function selectShellJobs(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  const live = rows.filter((j) =>
    j && typeof j === "object" &&
    j.status === "open" &&
    j.is_seed !== true &&
    (!j.expires_at || Date.parse(j.expires_at) > now) &&
    Object.prototype.hasOwnProperty.call(SHELL_CATEGORY_LABELS, j.category) &&
    shellTown(j.location) !== "" &&
    shellTitleProblem(j.title) === null &&
    shellTakeHomeDollars(j) !== null,
  );
  const boosted = (j) => !!j.boost_expires_at && Date.parse(j.boost_expires_at) > now;
  const created = (j) => Date.parse(j.created_at) || 0;
  return live
    .map((j, i) => ({ j, i }))
    .sort((a, b) =>
      Number(!!b.j.is_urgent) - Number(!!a.j.is_urgent) ||
      Number(boosted(b.j)) - Number(boosted(a.j)) ||
      created(b.j) - created(a.j) ||
      a.i - b.i)
    .slice(0, SHELL_CARD_COUNT)
    .map(({ j }) => j);
}

/** Text and attribute escaping for user-written values (a title). */
export function escapeShellText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The guest JobCard's own class strings (src/components/dashboard/JobCard.tsx, JobCategoryTab, MoneyAmount), so the
 * HTML card stands where the real one lands. The test renders the real guest JobCard and requires each of these on
 * the matching element.
 */
export const SHELL_CARD_CLASSES = {
  root: "group relative h-full rounded-2xl border border-border/60 bg-card cursor-pointer transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-0.5 active:scale-[0.99] shadow-[var(--card-shadow)] hover:shadow-[var(--card-hover-shadow)] hover:border-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
  inner: "relative h-full overflow-hidden rounded-2xl",
  catRow: "relative z-20 flex items-stretch gap-1",
  catLabel: "job-cat-label inline-flex items-center gap-1.5 min-w-0 text-ds-11 font-semibold text-muted-foreground max-w-[52%]",
  body: "w-full px-3.5 pt-2 pb-2.5",
  titleRow: "flex items-center justify-between gap-3",
  title: "job-card-title senior-clamp-2 text-headline-card flex-1 font-display font-bold text-foreground leading-tight line-clamp-2 break-words min-w-0",
  chip: "money-chip inline-flex flex-col items-center justify-center rounded-ds-md text-center px-2.5 py-1 shrink-0",
  amount: "font-sans leading-none tabular-nums text-ds-17",
  metaWrap: "mt-1.5 flex flex-col gap-0.5 text-ds-11 leading-tight text-muted-foreground",
  metaRow: "job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden",
};

function cardHtml(job) {
  const c = SHELL_CARD_CLASSES;
  const label = escapeShellText(SHELL_CATEGORY_LABELS[job.category]);
  const title = escapeShellText(String(job.title).trim());
  const town = escapeShellText(shellTown(job.location));
  const net = shellTakeHomeDollars(job).toLocaleString("en-US");
  return (
    `<div data-feed-card="" class="${c.root}"><div class="${c.inner}">` +
    `<div class="${c.catRow}"><span class="${c.catLabel}"><span aria-hidden="true" class="w-3.5 h-3.5 shrink-0"></span><span class="font-sans truncate">${label}</span></span></div>` +
    `<div class="${c.body}"><div class="${c.titleRow}">` +
    `<h2 class="${c.title}" style="color:hsl(var(--ink-deep));letter-spacing:-0.02em">${title}</h2>` +
    `<div class="${c.chip}" style="background:hsl(var(--bark) / 0.1);border:0.5px solid hsl(var(--bark) / 0.28)">` +
    `<span class="${c.amount}" style="font-weight:800;color:hsl(var(--bark));letter-spacing:-0.02em"><span style="font-size:0.82em;vertical-align:0.02em;margin-right:0.5px">$</span>${net}</span></div>` +
    `</div><div class="${c.metaWrap}"><div class="${c.metaRow}"><span class="flex items-center gap-1 min-w-[3.625rem] overflow-hidden"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-2.5 h-2.5 shrink-0" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg><span class="truncate font-sans min-w-[2.75rem]">${town}</span></span></div></div>` +
    `</div></div></div>`
  );
}

/**
 * The site Footer (src/components/Footer.tsx) as a signed-out visitor's /browse draws it, byte for byte: React's own
 * static render with the emblem's file and the year left as slots (src/test/browseShellFooter.test.tsx renders the
 * real Footer and requires this exact string). WHY (lead decision 11-01 on Builder 66's measurement): while few jobs
 * are open, the footer's H emblem is on the first screen and is the page's LCP element, and only the app drew it, at
 * ~4.0 s on Slow 4G. Drawn here at the same place, the app's own emblem lands later on the same pixels at the same
 * size, which is not a larger paint, so LCP stays at the shell's paint. Edit Footer.tsx, then paste the string the
 * test prints.
 */
export const SHELL_FOOTER_HTML =
  `<footer class="px-5 sm:px-8 lg:px-12 relative border-t border-[hsl(var(--olivewood))]/15" style="background-color:rgba(255, 255, 255, 0.08);backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%);color:hsl(var(--olivewood))"><div class="page-measure pt-6 md:pt-8 pb-2"><div class="grid grid-cols-2 min-[360px]:grid-cols-[auto_auto_auto] min-[360px]:justify-between min-[500px]:grid-cols-3 min-[500px]:justify-normal gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12"><div class="col-span-2 min-[360px]:col-span-3 min-[620px]:col-span-4 space-y-3"><a aria-label="Helpr home" class="flex items-center gap-2.5 group min-h-11" href="/" data-discover="true"><img src="__EMBLEM_SRC__" srcset="__EMBLEM_SRCSET__" sizes="40px" alt="Helpr" class="helpr-emblem h-10 w-auto select-none transition-transform duration-200 group-hover:scale-105" draggable="false"/></a><p class="text-ds-11 text-[hsl(var(--olivewood))]/80 max-w-xs leading-relaxed">Jobs, Declutter, Shops and Homes<br/>for Louisiana.</p></div><div class="col-span-2 order-1 min-[360px]:col-span-1 min-[360px]:order-none min-[620px]:col-span-3"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Explore</h2><ul class="space-y-2 text-ds-11 text-[hsl(var(--olivewood))]/85"><li><a class="link-standard" href="/browse" data-discover="true">Jobs</a></li><li><a class="link-standard" href="/help" data-discover="true">Help center</a></li><li><a class="link-standard" href="/support" data-discover="true">Contact us</a></li></ul></div><div class="order-3 min-[360px]:order-none min-[620px]:col-span-2"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Legal</h2><ul class="space-y-2 text-ds-11 text-[hsl(var(--olivewood))]/85"><li><a class="link-standard" href="/terms" data-discover="true">Terms</a></li><li><a class="link-standard" href="/rules" data-discover="true">Rules</a></li><li><a class="link-standard" href="/privacy" data-discover="true">Privacy</a></li></ul></div><div class="order-2 min-[360px]:order-none min-[620px]:col-span-3"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Follow</h2><div class="flex items-center gap-2.5"><a href="https://www.facebook.com/louisianahelpr" target="_blank" rel="noopener noreferrer" class="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--facebook))] text-white shadow-sm transition-all duration-300 ease-out hover:brightness-110" aria-label="Follow us on Facebook (opens in a new tab)" title="Follow us on Facebook"><svg viewBox="0 0 24 24" class="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" fill="currentColor" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14V7c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z"></path></svg></a><a href="https://www.instagram.com/louisianahelpr/" target="_blank" rel="noopener noreferrer" class="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-all duration-300 ease-out hover:brightness-110" style="background-image:linear-gradient(135deg, #f9ce34 0%, #ee2a7b 50%, #6228d7 100%)" aria-label="Follow us on Instagram (opens in a new tab)" title="Follow us on Instagram"><svg viewBox="0 0 24 24" class="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"></rect><circle cx="12" cy="12" r="4"></circle><circle cx="17.5" cy="6.5" r="1" fill="currentColor"></circle></svg></a></div></div></div><div class="mt-5 flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-[hsl(var(--olivewood))]/15"><p class="text-ds-11 text-[hsl(var(--olivewood))]/80 whitespace-nowrap">© __YEAR__ Louisiana Helpr · Helpr LLC</p><p class="text-ds-11 text-[hsl(var(--olivewood))]/80 flex items-center gap-1.5">Made with <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-heart w-3 h-3" aria-hidden="true" style="color:hsl(var(--bark));fill:hsl(var(--bark))"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"></path></svg> for Louisiana communities</p></div></div></footer>`;

/** The Footer copy for the shell: its emblem (the page's own file), the year as the visitor's clock shows it. */
export function shellFooterHtml(emblem, now = Date.now()) {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric" }).format(new Date(now));
  return SHELL_FOOTER_HTML
    .replace("__EMBLEM_SRC__", escapeShellText(emblem.src))
    .replace("__EMBLEM_SRCSET__", escapeShellText(emblem.srcset))
    // "© ", the year and the rest are three text nodes in the app's render (JSX `© {year} ...`); comments split
    // the HTML's text the same way, so the line is shaped identically (one run measured 31 pixels apart at 375).
    .replace("© __YEAR__ ", `© <!-- -->${year}<!-- --> `)
    // A picture only, like the shell's nav: no tab stop and nothing read twice while the overlay covers the app.
    .replace("<footer ", '<footer aria-hidden="true" inert="" ');
}

/** PublicLayout's root class for a signed-out web visitor (src/test/browseShellFooter.test.tsx holds them equal). */
export const SHELL_LAYOUT_CLASS =
  "min-h-screen page-warmth pb-[calc(var(--safe-area-bottom,0px)_+_var(--bottom-nav-h,96px))] relative flex flex-col overflow-x-clip";

/** The id main.tsx and DashboardGuest look for (src/boot/browseShellHandoff.ts holds the same string). */
export const BROWSE_SHELL_ID = "lh-browse-shell";

/**
 * The whole overlay: GuestBrowseSkeleton's web frame (nav box, its spacer, the "Browse jobs" header, the card grid)
 * with real cards in the grid. Hidden inline until the app's stylesheet (async) applies: src/index.css shows it. "" when no row may be drawn: the page is then exactly what it was.
 */
export function browseShellHtml(rows, now = Date.now(), emblem = null) {
  const jobs = selectShellJobs(rows, now);
  if (jobs.length === 0) return "";
  // The nav's H emblem (HelprMark size md, emblemOnly), the very file the page's own <img> and index.html's
  // #emblem-preload fetch, so the bar reads as the page's own from the first paint.
  const mark = emblem
    ? `<span class="flex items-center gap-2.5 group min-h-11"><img src="${escapeShellText(emblem.src)}" srcset="${escapeShellText(emblem.srcset)}" sizes="40px" alt="Helpr" class="helpr-emblem h-10 w-auto select-none transition-transform duration-200 group-hover:scale-105" draggable="false"></span>`
    : "";
  // z-index above every layer the booting app draws (its nav is z-50, card tabs z-20): in the 11-01 lab filmstrip,
  // at z-index 2 the app's skeleton tabs showed through the overlay.
  return (
    `<div id="${BROWSE_SHELL_ID}" class="min-h-screen bg-premium-page" style="position:fixed;inset:0;z-index:2147483000;overflow:hidden;visibility:hidden">` +
    // PublicLayout's own frame (its class, its mesh, the flex-1 body, then the Footer), so the footer stands where the
    // app's does: on a short list the flex column pins it to the bottom of the first screen.
    // --bottom-nav-h 0: the overlay is only ever on a signed-out web /browse, where MobileNav zeroes it
    // (html.no-bottom-nav) as soon as the app runs; unset, PublicLayout's padding falls back to 96px and the footer
    // stood 96px higher than the app's (lab 11-01: emblem at y 430 against the app's 526).
    `<div class="${SHELL_LAYOUT_CLASS}" style="--bottom-nav-h:0px"><div aria-hidden="true" class="mesh-gradient-global"></div>` +
    `<div aria-hidden="true" class="fixed top-0 left-0 right-0 z-50 glass-nav" style="padding-top:max(var(--safe-area-top, 0px), 0.25rem)"><div class="w-full flex items-center justify-between h-[var(--public-nav-h)] px-5 sm:px-8 lg:px-12">${mark}</div></div>` +
    `<div aria-hidden="true" style="height:calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))"></div>` +
    `<div class="flex-1"><div class="mx-auto page-measure px-5 sm:px-8 lg:px-12 pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6"><div class="flex items-center gap-3"><div class="shrink-0"><span aria-hidden="true" class="w-11 h-11 -ml-2 flex items-center justify-center shrink-0" style="color:hsl(var(--olivewood))"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5"><path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path></svg></span></div><div class="flex flex-col leading-none min-w-0"><h1 class="text-page-title leading-tight truncate">Browse jobs</h1></div></div></div>` +
    `<div class="px-5 sm:px-8 lg:px-12 pb-16"><div class="mx-auto page-measure"><div class="grid grid-cols-1 gap-list md:grid-cols-2 md:gap-4">` +
    jobs.map(cardHtml).join("") +
    `</div></div></div></div>` +
    (emblem ? shellFooterHtml(emblem, now) : "") +
    `</div></div>`
  );
}

/**
 * The shell document with the overlay placed first INSIDE #boot-loader. Inside it, not beside it: the inline boot
 * watchdog (index.html showFailure) replaces #boot-loader's innerHTML with its "Helpr couldn't load." screen, which
 * must never sit under a card overlay, and React's first commit removes #boot-loader, so main.tsx moves the overlay
 * to <body> first (src/boot/browseShellHandoff.ts). Unchanged when there is nothing to draw or no anchor.
 */
export function withBrowseShell(html, rows, now = Date.now()) {
  const preload = html.match(/<link\s+id="emblem-preload"[^>]*>/)?.[0] ?? "";
  const src = preload.match(/\shref="(\/assets\/[^"]+)"/)?.[1];
  const srcset = preload.match(/\simagesrcset="([^"]+)"/)?.[1];
  const shell = browseShellHtml(rows, now, src && srcset ? { src, srcset } : null);
  if (!shell) return html;
  return html.replace(/<div\s+id="boot-loader"[^>]*>/, (open) => `${open}${shell}`);
}
