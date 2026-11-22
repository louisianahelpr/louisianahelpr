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

import { jobCategoryTint } from "./jobCategoryTint.mjs";

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
  "title,category,budget,location,status,expires_at,boost_expires_at,boosted_at,created_at,is_urgent,urgent_fee,is_group_job,helpers_needed,helper_fee_flat_cents,helper_fee_percent,date_needed,date_window_end,start_time,is_flexible_schedule";

/**
 * The anon REST read api/share.ts (and the lab's dist server, scripts/perf/cwv-lab.mjs) makes: the masked
 * open_jobs_browse view with the guest feed's own filter, order and limit (src/pages/home/fetchGuestJobs.ts), only
 * the drawn columns. No status filter (Q2705): the view itself admits only open jobs and crews with spots left, the
 * same rows the guest feed reads, so an empty answer means the feed is empty too (shellFeedIsEmpty); cards are drawn
 * only for `open` rows (selectShellJobs).
 */
export function browseShellRowsUrl(supabaseUrl) {
  const u = new URL(`${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/open_jobs_browse`);
  u.searchParams.set("select", SHELL_JOB_COLUMNS);
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

/** COPY of src/lib/smartSort.ts's recency half-life (4 days); src/test/browseShellMatchesFirstRender.test.tsx pins the order equal. */
const RECENCY_HALFLIFE_MS = 4 * 24 * 60 * 60 * 1000;

/**
 * The guest feed's default "smart" score (smartScore in src/lib/smartSort.ts) for a guest: recency (4-day half-life)
 * plus log10(budget + 1). A guest has no location (no proximity bonus) and the view carries no poster tier (no
 * placement bonus), so those two terms are 0 here as they are in the app.
 */
export function shellSmartScore(job, now = Date.now()) {
  const ts = Date.parse(job.created_at);
  const recency = Number.isFinite(ts) ? Math.pow(0.5, Math.max(0, now - ts) / RECENCY_HALFLIFE_MS) : 0;
  const budget = typeof job.budget === "number" ? job.budget : Number(job.budget);
  return recency + (Number.isFinite(budget) && budget > 0 ? Math.log10(budget + 1) : 0);
}

/**
 * The rows the HTML may draw, in the feed's own first-render order, at most
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
  // The app's default sort (useDashboardFilters, "smart"): a live boost pins to the top, then the smart score, ties in
  // the read's order. Urgent is a badge, not a queue-jump (owner 2026-08-29). The shell used to lead with urgent and
  // then newest, so the cards reordered under the reader when the app took over (lead 11-14).
  const boosted = (j) => !!j.boost_expires_at && Date.parse(j.boost_expires_at) > now;
  return live
    .map((j, i) => ({ j, i, score: shellSmartScore(j, now) }))
    .sort((a, b) =>
      Number(boosted(b.j)) - Number(boosted(a.j)) ||
      b.score - a.score ||
      a.i - b.i)
    .slice(0, SHELL_CARD_COUNT)
    .map(({ j }) => j);
}

/**
 * True when the read SUCCEEDED and the guest feed will draw no job at all: every row (if any) is past its
 * expires_at, the one filter fetchGuestJobs applies to the same rows. A failed read (null) is never "empty".
 */
export function shellFeedIsEmpty(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return false;
  return !rows.some((j) => j && typeof j === "object" && (!j.expires_at || Date.parse(j.expires_at) > now));
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
  // Design audit A J2 (owner approved 11-08): the feed's cards are hairline ROWS (data-feed-row), the category on
  // the place line, at most one badge in its own line above the title (the shell draws none: an empty line is hidden).
  root: "group relative h-full cursor-pointer border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
  inner: "relative h-full",
  badgeLine: "flex pl-3 pt-3 -mb-2 empty:hidden",
  catLabel: "job-cat-label inline-flex items-center gap-1.5 min-w-0 text-ds-11 font-semibold text-muted-foreground shrink-0",
  body: "w-full pl-3 pt-3 pb-3",
  titleRow: "flex items-center justify-between gap-3",
  title: "job-card-title senior-clamp-2 text-headline-card flex-1 font-display font-bold text-foreground leading-tight line-clamp-2 break-words min-w-0",
  chip: "money-chip inline-flex flex-col items-center justify-center rounded-ds-md text-center px-2.5 py-1 shrink-0 self-start",
  amount: "font-sans leading-none tabular-nums text-ds-17",
  metaWrap: "mt-1.5 flex flex-col gap-0.5 text-ds-11 leading-tight text-muted-foreground",
  metaRow: "job-meta-row flex items-center gap-x-2 flex-nowrap max-[359px]:flex-wrap overflow-hidden",
  // Photo-first cards (Q2043 + Q2036): the picture tile beside the text and the poster-face row, same size as the app's.
  mediaRow: "flex items-stretch",
  mediaPad: "py-3",
  media: "relative shrink-0 self-start w-12 h-12 overflow-hidden rounded-xl",
  textCol: "job-card-media-col min-w-0 flex-1",
  face: "mt-1 flex h-5 items-center gap-1.5 min-w-0 text-ds-11 text-muted-foreground",
};

const CAL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-calendar w-2.5 h-2.5 shrink-0" aria-hidden="true"><path d="M8 2v3"></path><path d="M16 2v3"></path><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M3 9h18"></path></svg>';
const CLOCK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-clock w-2.5 h-2.5 shrink-0" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (ymd, opts) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
};

/** jobDayLabel (src/lib/jobDateWindow.ts): "Sun, Nov 29", or "Any day Nov 4-10" for a window; "" with no usable day. */
export function shellDayLabel(job) {
  const first = typeof job.date_needed === "string" ? job.date_needed.slice(0, 10) : "";
  if (!YMD.test(first)) return "";
  const end = typeof job.date_window_end === "string" ? job.date_window_end.slice(0, 10) : "";
  if (!YMD.test(end) || end <= first) return utcDay(first, { weekday: "short", month: "short", day: "numeric" });
  const a = utcDay(first, { month: "short", day: "numeric" });
  const b = utcDay(end, { month: "short", day: "numeric" });
  return `Any day ${a}-${a.split(" ")[0] === b.split(" ")[0] ? b.split(" ")[1] : b}`;
}

/** jobStartTimeLabel (src/lib/jobDate.ts): "9:00 AM", "Flexible", "9:00 AM · Flexible", or null. */
export function shellTimeLabel(startTime, isFlexible) {
  const raw = typeof startTime === "string" ? startTime.trim() : "";
  const flexible = raw.toLowerCase() === "flexible" || !!isFlexible;
  if (!raw || raw.toLowerCase() === "flexible") return flexible ? "Flexible" : null;
  const m = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!m) return flexible ? "Flexible" : null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return flexible ? "Flexible" : null;
  const clock = `${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
  return isFlexible ? `${clock} · Flexible` : clock;
}

/**
 * The guest JobCard's "when" group (date · time, or Flexible), with the line break it takes below 360 px: without
 * it the shell's cards were a line shorter than the app's, so the list and the footer jumped when the app took over
 * (lead 11-14). src/test/browseShellMatchesFirstRender.test.tsx renders the real card for each case and requires the
 * same text and the same element classes.
 */
export function shellWhenHtml(job) {
  const day = shellDayLabel(job);
  const time = shellTimeLabel(job.start_time, job.is_flexible_schedule);
  const dayHtml = (label) => `<span class="flex items-center gap-1">${CAL_SVG}<span class="font-sans whitespace-nowrap">${escapeShellText(label)}</span></span>`;
  let inner;
  // JobCard's own test: no date_needed and no start_time (raw), whatever the Flexible tick says.
  if (!job.date_needed && !job.start_time) inner = `<span class="flex items-center gap-1">${CAL_SVG}<span class="font-sans">Flexible</span></span>`;
  else {
    inner = day ? dayHtml(day) : "";
    if (day && time) inner += '<span class="shrink-0 opacity-30">·</span>';
    if (time) inner += `<span data-meta-time="true" class="shrink-0 flex items-center gap-1">${CLOCK_SVG}<span class="font-sans whitespace-nowrap">${escapeShellText(time)}</span></span>`;
  }
  return (
    '<span aria-hidden="true" data-meta-break="true" class="hidden max-[359px]:block basis-full h-0.5"></span>' +
    '<span class="shrink-0 opacity-30 max-[359px]:hidden">·</span>' +
    `<span class="inline-flex shrink-0 items-center gap-x-2">${inner}</span>`
  );
}

function cardHtml(job) {
  const c = SHELL_CARD_CLASSES;
  const label = escapeShellText(SHELL_CATEGORY_LABELS[job.category]);
  const title = escapeShellText(String(job.title).trim());
  const town = escapeShellText(shellTown(job.location));
  const net = shellTakeHomeDollars(job).toLocaleString("en-US");
  return (
    `<div data-feed-card="" data-feed-row="" class="${c.root}"><div class="${c.inner}">` +
    `<div class="${c.mediaRow}"><div class="${c.mediaPad}"><div class="${c.media}" style="background:${jobCategoryTint(job.category).background}"></div></div><div class="${c.textCol}">` +
    `<div data-job-badge-line="" class="${c.badgeLine}"></div>` +
    `<div class="${c.body}"><div class="${c.titleRow}">` +
    `<h2 class="${c.title}" style="color:hsl(var(--ink-deep));letter-spacing:-0.02em">${title}</h2>` +
    `<div class="${c.chip}" style="background:hsl(var(--bark) / 0.1);border:0.5px solid hsl(var(--bark) / 0.28)">` +
    `<span class="${c.amount}" style="font-weight:800;color:hsl(var(--bark));letter-spacing:-0.02em"><span style="font-size:0.82em;vertical-align:0.02em;margin-right:0.5px">$</span>${net}</span></div>` +
    `</div><div class="${c.metaWrap}"><div class="${c.metaRow}"><span class="${c.catLabel}"><span class="font-sans truncate">${label}</span></span><span class="shrink-0 opacity-30">·</span><span class="flex items-center gap-1 min-w-[3.625rem] overflow-hidden"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-2.5 h-2.5 shrink-0" aria-hidden="true"><path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"></path><circle cx="12" cy="10" r="3"></circle></svg><span class="truncate font-sans min-w-[2.75rem]">${town}</span></span>${shellWhenHtml(job)}</div><div aria-hidden="true" class="${c.face}"></div></div>` +
    `</div></div></div></div></div>`
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
  `<footer class="px-5 sm:px-8 lg:px-12 relative border-t border-[hsl(var(--olivewood))]/15" style="background-color:rgba(255, 255, 255, 0.08);backdrop-filter:blur(20px) saturate(170%);-webkit-backdrop-filter:blur(20px) saturate(170%);color:hsl(var(--olivewood))"><div class="page-measure max-w-6xl pt-6 md:pt-8 pb-2"><div class="grid grid-cols-2 gap-x-4 gap-y-6 md:gap-8 min-[620px]:grid-cols-12"><div class="col-span-2 min-[620px]:col-span-3 space-y-3"><a aria-label="Helpr home" class="flex items-center gap-2.5 group min-h-11" href="/" data-discover="true"><img src="__EMBLEM_SRC__" srcset="__EMBLEM_SRCSET__" sizes="40px" alt="Helpr" class="helpr-emblem h-10 w-auto select-none transition-transform duration-200 group-hover:scale-105" draggable="false"/></a><p class="text-ds-13 text-[hsl(var(--olivewood))]/80 max-w-xs leading-relaxed">Jobs and Declutter<br/>for Louisiana.</p></div><div class="col-span-2 min-[620px]:col-span-4"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Explore</h2><ul data-footer-explore="" class="grid grid-cols-2 gap-x-3 whitespace-nowrap min-[620px]:[@media(pointer:fine)]:gap-y-2 lg:[@media(pointer:fine)]:gap-y-0 text-ds-13 text-[hsl(var(--olivewood))]/85"><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/browse" data-discover="true">Jobs</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/declutter" data-discover="true">Declutter</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/helprs" data-discover="true">Find a Helpr</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/holidays" data-discover="true">Holiday Hub</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/help" data-discover="true">Help center</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/fees" data-discover="true">Fees</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/safety" data-discover="true">Safety</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/support" data-discover="true">Contact support</a></li></ul></div><div class="min-[620px]:col-span-2"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Legal</h2><ul class="space-y-2 [@media(pointer:coarse)]:space-y-0 lg:[@media(pointer:fine)]:space-y-0 text-ds-13 text-[hsl(var(--olivewood))]/85"><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/terms" data-discover="true">Terms</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/rules" data-discover="true">Rules</a></li><li><a class="link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8" href="/privacy" data-discover="true">Privacy</a></li></ul></div><div class="min-[620px]:col-span-3"><h2 class="text-ds-11 font-semibold mb-3 uppercase tracking-[0.18em]" style="color:hsl(var(--muted-foreground))">Follow</h2><div class="flex items-center gap-2.5"><a href="https://www.facebook.com/louisianahelpr" target="_blank" rel="noopener noreferrer" class="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110" aria-label="Follow us on Facebook (opens in a new tab)" title="Follow us on Facebook"><svg viewBox="0 0 24 24" class="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" fill="currentColor" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 13.5h2.5l1-4H14V7c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5z" vector-effect="non-scaling-stroke"></path></svg></a><a href="https://www.instagram.com/louisianahelpr/" target="_blank" rel="noopener noreferrer" class="group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--olivewood))] text-[hsl(var(--parchment))] shadow-sm transition-all duration-300 ease-out hover:brightness-110" aria-label="Follow us on Instagram (opens in a new tab)" title="Follow us on Instagram"><svg viewBox="0 0 24 24" class="h-[18px] w-[18px] transition-transform duration-300 group-hover:scale-110" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" vector-effect="non-scaling-stroke"></rect><circle cx="12" cy="12" r="4" vector-effect="non-scaling-stroke"></circle><circle cx="17.5" cy="6.5" r="1" fill="currentColor" vector-effect="non-scaling-stroke"></circle></svg></a></div></div></div><div class="mt-5 flex flex-col sm:flex-row items-center justify-between gap-2 pt-3 border-t border-[hsl(var(--olivewood))]/15"><p class="text-ds-11 text-[hsl(var(--olivewood))]/80 whitespace-nowrap">© __YEAR__ Louisiana Helpr · Helpr LLC</p><p class="text-ds-11 text-[hsl(var(--olivewood))]/80">Delcambre, Louisiana</p></div></div></footer>`;

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

/**
 * The guest feed's unfiltered empty state (DashboardGuest's web empty wrapper around EmptyState and
 * GuestEmptyStateActions), byte for byte as React renders it (src/test/browseShellEmptyState.test.tsx renders the
 * real components and requires this exact string), made a picture only (aria-hidden + inert: its buttons are the
 * app's to press). WHY (Q2705, measured 2026-11-06): with no guest-visible job open, the shell drew nothing and the page's
 * LCP was this empty state's sentence at ~4.6 s live on Slow 4G, painted only by the app. Drawn here at the same
 * place, the app's own copy later lands on the same pixels at the same size, which is not a larger paint.
 * Edit the empty state, then paste the string the test prints.
 */
export const SHELL_EMPTY_HTML =
  `<div aria-hidden="true" inert="" class="flex"><div class="empty-state-dock flex-1 min-w-0 max-w-full flex flex-col items-center text-center justify-center gap-5 px-5 sm:px-8 py-10" style="border-top-left-radius:0;border-top-right-radius:0;border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom:none;padding-bottom:calc(var(--safe-area-bottom, 0px) + var(--bottom-nav-h, 96px) + 2rem)" data-empty-state="dock"><div class="w-[88px] h-[88px] rounded-full flex items-center justify-center" style="background-color:var(--empty-bubble-bg);backdrop-filter:blur(20px) saturate(160%);-webkit-backdrop-filter:blur(20px) saturate(160%);border:1px solid hsl(var(--olivewood) / 0.09);box-shadow:inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.75), inset 0 -1px 1px 0 hsl(var(--bark) / 0.06), 0 1px 3px hsl(var(--olivewood) / 0.06), 0 6px 18px -4px hsl(var(--olivewood) / 0.10)" aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search w-9 h-9" aria-hidden="true" style="color:hsl(var(--bark))"><path vector-effect="non-scaling-stroke" d="m21 21-4.34-4.34"></path><circle vector-effect="non-scaling-stroke" cx="11" cy="11" r="8"></circle></svg></div><div class="w-full min-w-0 flex flex-col items-center gap-3"><div class="w-full min-w-0 space-y-2"><p data-empty-title="" class="font-sans font-bold leading-tight break-words [text-wrap:balance] text-headline-section" style="color:hsl(var(--ink-deep));letter-spacing:-0.015em">Nothing today, neighbor.</p><p class="font-sans text-ds-13 leading-relaxed max-w-[26rem] mx-auto break-words [text-wrap:balance]" style="color:hsl(var(--olivewood) / 0.8)">New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon.</p></div><div class="flex flex-col items-center gap-2.5"><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full tracking-[-0.01em] ring-offset-background transition-[transform,box-shadow,filter,background-color] duration-[150ms] ease-ds-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-[18px] [&amp;_svg]:shrink-0 ctl-tint border-[1.5px] border-foreground/70 bg-background/70 backdrop-blur-md shadow-none active:scale-[0.97] h-11 px-5 text-ds-16 font-semibold">Notify me when work lands</button><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold tracking-[-0.01em] ring-offset-background transition-[transform,box-shadow,filter,background-color] duration-[150ms] ease-ds-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-[18px] [&amp;_svg]:shrink-0 link-standard shadow-none h-11 px-4 text-ds-14 text-muted-foreground" type="button">Or hire someone for a job</button><button class="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-bold tracking-[-0.01em] ring-offset-background transition-[transform,box-shadow,filter,background-color] duration-[150ms] ease-ds-spring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 [&amp;_svg]:pointer-events-none [&amp;_svg]:size-[18px] [&amp;_svg]:shrink-0 link-standard shadow-none h-11 px-4 text-ds-14 text-muted-foreground" type="button">Browse Declutter while you wait</button></div></div></div></div>`;

/** PublicLayout's root class for a signed-out web visitor (src/test/browseShellFooter.test.tsx holds them equal). */
export const SHELL_LAYOUT_CLASS =
  "min-h-screen page-warmth pb-[calc(var(--safe-area-bottom,0px)_+_var(--bottom-nav-h,96px))] relative flex flex-col overflow-x-clip";

/** F017: src/lib/publicContainer.ts's PUBLIC_CONTAINER, spelled here (this file is plain .mjs for the edge); the guard
 * src/test/publicPagesShareOneContainer.test.ts holds the two equal. */
export const SHELL_PUBLIC_CONTAINER = "max-w-[78rem] mx-auto";

/**
 * Owner 11-21: the page's back arrow (PageHeader's BackButton, left of "Jobs"), drawn inert in the same 44px box
 * (BackButton's BACK_BUTTON_BOX_CLASS) so the title sits where the app puts it and the arrow does not pop in.
 */
const SHELL_BACK_HTML =
  `<div class="shrink-0" aria-hidden="true"><span class="w-11 h-11 -ml-2 flex items-center justify-center" style="color:hsl(var(--olivewood))">` +
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-left w-5 h-5" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="m12 19-7-7 7-7"></path><path vector-effect="non-scaling-stroke" d="M19 12H5"></path></svg>` +
  `</span></div>`;

/** The id main.tsx and DashboardGuest look for (src/boot/browseShellHandoff.ts holds the same string). */
export const BROWSE_SHELL_ID = "lh-browse-shell";

/**
 * The whole overlay: GuestBrowseSkeleton's web frame (nav box, its spacer, the "Jobs" header, the card grid)
 * with real cards in the grid, or the feed's empty state when the read succeeded with no live row (Q2705). Hidden inline
 * until the app's stylesheet (async) applies: src/index.css shows it. "" when no row may be drawn and the feed is not
 * known empty: the page is then exactly what it was.
 */
export function browseShellHtml(rows, now = Date.now(), emblem = null) {
  const jobs = selectShellJobs(rows, now);
  const empty = shellFeedIsEmpty(rows, now);
  if (jobs.length === 0 && !empty) return "";
  // The nav's H emblem (HelprMark size md, emblemOnly), the very file the page's own <img> and index.html's
  // #emblem-preload fetch, so the bar reads as the page's own from the first paint.
  const mark = emblem
    ? `<span class="flex items-center gap-2.5 group min-h-11"><img src="${escapeShellText(emblem.src)}" srcset="${escapeShellText(emblem.srcset)}" sizes="40px" alt="Helpr" class="helpr-emblem h-10 w-auto select-none transition-transform duration-200 group-hover:scale-105" draggable="false"></span>`
    : "";
  // z-index above every layer the booting app draws (its nav is z-50, card tabs z-20): in the 11-01 lab filmstrip,
  // at z-index 2 the app's skeleton tabs showed through the overlay.
  return (
    `<div id="${BROWSE_SHELL_ID}"${empty ? ' data-shell-empty=""' : ""} class="min-h-screen bg-premium-page" style="position:fixed;inset:0;z-index:2147483000;overflow:hidden;visibility:hidden">` +
    // PublicLayout's own frame (its class, its mesh, the flex-1 body, then the Footer), so the footer stands where the
    // app's does: on a short list the flex column pins it to the bottom of the first screen.
    // --bottom-nav-h 0: the overlay is only ever on a signed-out web /browse, where MobileNav zeroes it
    // (html.no-bottom-nav) as soon as the app runs; unset, PublicLayout's padding falls back to 96px and the footer
    // stood 96px higher than the app's (lab 11-01: emblem at y 430 against the app's 526).
    `<div class="${SHELL_LAYOUT_CLASS}" style="--bottom-nav-h:0px"><div aria-hidden="true" class="mesh-gradient-global"></div>` +
    `<div aria-hidden="true" class="fixed top-0 left-0 right-0 z-50 glass-nav" style="padding-top:max(var(--safe-area-top, 0px), 0.25rem)"><div class="w-full flex items-center justify-between h-[var(--public-nav-h)] px-5 sm:px-8 lg:px-12 ${SHELL_PUBLIC_CONTAINER}">${mark}</div></div>` +
    `<div aria-hidden="true" style="height:calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))"></div>` +
    `<div class="flex-1"><div class="${SHELL_PUBLIC_CONTAINER}"><div class="mx-auto page-measure px-5 sm:px-8 lg:px-12 pt-[var(--shell-gap)] pb-[var(--shell-gap)] sm:pt-6 sm:pb-6"><div class="flex items-center gap-3">${SHELL_BACK_HTML}<div class="flex flex-col leading-none min-w-0"><h1 class="text-page-title leading-tight truncate">Jobs</h1></div></div></div>` +
    `<div class="px-5 sm:px-8 lg:px-12 pb-4"><div class="mx-auto page-measure">` +
    (empty ? SHELL_EMPTY_HTML : `<div class="grid grid-cols-1 gap-list md:grid-cols-2 md:gap-4">${jobs.map(cardHtml).join("")}</div>`) +
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
export function withBrowseShell(html, rows, now = Date.now(), criticalCss = null) {
  const preload = html.match(/<link\s+id="emblem-preload"[^>]*>/)?.[0] ?? "";
  const src = preload.match(/\shref="(\/assets\/[^"]+)"/)?.[1];
  const srcset = preload.match(/\simagesrcset="([^"]+)"/)?.[1];
  const shell = browseShellHtml(rows, now, src && srcset ? { src, srcset } : null);
  if (!shell) return html;
  const page = html.replace(/<div\s+id="boot-loader"[^>]*>/, (open) => `${open}${shell}`);
  return withBrowseShellCss(page, criticalCss);
}

/** The show rule the inlined block carries for the overlay (src/index.css repeats it for the app sheet). */
export const BROWSE_SHELL_SHOW_RULE = `#${BROWSE_SHELL_ID}{visibility:visible!important}`;

/**
 * prod-audit 43650083979 (11-14): mobile /browse LCP 3492 ms against its 1966 ceiling. Measured live (cwv-lab, www,
 * guest, Slow 4G + 4x, 375): the cards were in the HTML but the overlay stayed `visibility:hidden` until the app's
 * async stylesheet arrived (~4 s, sharing the link with the boot JavaScript), so the first screen was the boot loader
 * and the LCP the app's own footer emblem at 3.97 s. The overlay's own rules (its subset of the app sheet, built by
 * scripts/inline-shell-css.mjs into dist/lh-browse-shell-css.txt with BROWSE_SHELL_SHOW_RULE) now go into THIS page's
 * inlined block (<style id="lh-shell-css">), in place of the other HTML-drawn screens' rules: none of those is drawn
 * on /browse (each is keyed to its own path), and the block stays before the app sheet, which repeats every rule.
 * Every other page's head, and the cap on it, are unchanged. No CSS, or no block: the page as it was.
 */
export function withBrowseShellCss(page, criticalCss) {
  if (typeof criticalCss !== "string" || !criticalCss.includes(BROWSE_SHELL_SHOW_RULE)) return page;
  return page.replace(/<style id="lh-shell-css">[\s\S]*?<\/style>/, () => `<style id="lh-shell-css">${criticalCss}</style>`);
}
