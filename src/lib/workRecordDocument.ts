/**
 * The Employment & Earnings Record, as a DOCUMENT — the thing a helpr hands a
 * landlord, a lender or an employer.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * /work-record used to "share" by handing the OS `{ text, url: homepage }`.
 * iOS's share sheet prefers the URL when it is given both: it renders the link
 * preview for louisianahelpr.com and the carefully built text is buried or
 * dropped. The owner's report was exactly that — "just shared the website not
 * their work history." The recipient got an advert for the app.
 *
 * There is no URL that could have been right. `/work-record` is
 * ProtectedRoute-wrapped and always renders the VIEWER's own record, `/user/:id`
 * is protected too, and no share-token route or table exists. A public
 * verification link would have to be invented, and a link that 404s (or that
 * shows the recipient their own empty record) is worse than no link.
 *
 * So the record is shared as what it claims to be: a document. This module is
 * the pure content half — no React, no Capacitor, no `@/` aliases — so the
 * exact bytes that get shared can be generated and inspected outside a browser.
 * The staging + share-sheet half lives in `shareFileNative` (nativeShare.ts),
 * which follows the file-share idiom `calendarExport.ts` already established:
 * write a real file, share the `file://` URI, and pass NO sibling text/url item.
 */
import type jsPDFType from "jspdf";
import { formatPriceFloor } from "./format";
import { HELPR_MARK_PNG, HELPR_MARK_PX } from "./helprMarkPng";

export interface WorkRecordDocumentInput {
  /** `profiles.full_name`. */
  fullName: string | null;
  /** `profiles.created_at`, ISO. */
  memberSince: string;
  /**
   * `profiles.stripe_identity_verified` — Stripe Connect's own verdict, cached
   * by the account.updated webhook. NOT `idv_status` (an upload/admin state
   * nobody reviews). Nothing else may back this line on a formal record.
   */
  identityVerified: boolean;
  jobsCompleted: number;
  /** Take-home dollars, resolved per job by `sumHelperTakeHomeDollars`. */
  totalEarnings: number;
  avgRating: number | null;
  reviewCount: number;
  /**
   * The earliest / latest DAY WORKED, as a bare `YYYY-MM-DD` calendar day —
   * null only when no job has been completed. Produced by
   * `resolveWorkDayRange`; see that function for why these are calendar days
   * and not the ISO instants they used to be.
   */
  firstWorkDay: string | null;
  lastWorkDay: string | null;
  generatedAt: Date;
}

const VERIFICATION_EMAIL = "admin@louisianahelpr.com";

/**
 * EVERY DATE ON THIS RECORD IS RESOLVED IN THE PLATFORM'S ZONE.
 *
 * The instant-valued inputs are UTC ISO timestamps (`profiles.created_at`,
 * `jobs.created_at`). These formatters used to omit `timeZone`, which means the READER's zone — so
 * a job created at `2026-08-01T00:00:00Z` printed as "July 2026" everywhere in
 * the United States, and the "Active Period" on an employment record handed to
 * a landlord or a lender was off by a month at every UTC-midnight boundary.
 * Moving the formatters into this module fixed the screen and the PDF
 * DISAGREEING; it did not fix either of them being wrong, and consistently
 * wrong is the more dangerous of the two on a document that gets believed.
 *
 * America/Chicago, for the same reason `src/lib/jobDate.ts` and the
 * cancellation-fee ladder pin it: Helpr is a Louisiana marketplace, the work
 * happened in Louisiana, and a dated record issued by a Louisiana business has
 * exactly one answer to "which month was that". It also makes the document
 * REPRODUCIBLE — the helper generating it in Shreveport and the leasing office
 * opening it in Denver see the same period, and the PDF matches the screen
 * that produced it regardless of where either ran.
 *
 * ONE INPUT ON THIS RECORD IS NOT AN INSTANT, AND IT MUST NOT BE SHIFTED.
 * `jobs.date_needed` is a Postgres `date` — a bare `YYYY-MM-DD` that already
 * NAMES the calendar day, with no time and no zone. Applying an offset to it
 * is the same bug in the opposite direction: `new Date("2026-09-01")` is UTC
 * midnight, which is 7pm on 31 August in Central, so running it through
 * `formatMonthYear` prints "August 2026" for a job worked on 1 September.
 * That is not hypothetical — prod holds four live jobs dated `2026-09-01`
 * today. Calendar days go through `formatWorkDayMonthYear`, which applies no
 * offset at all; instants go through `formatMonthYear`, which pins Chicago.
 */
const PLATFORM_TIME_ZONE = "America/Chicago";

/** An ISO calendar day with no time and no zone — `jobs.date_needed`'s wire form. */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Month + year for an INSTANT (`profiles.created_at`), resolved in Chicago.
 * Not for `date_needed` — see `formatWorkDayMonthYear`.
 */
export function formatMonthYear(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: PLATFORM_TIME_ZONE,
  });
}

/**
 * Month + year for a CALENDAR DAY (`YYYY-MM-DD`), shifted by nothing.
 *
 * The day is rebuilt at UTC noon and formatted in UTC: no zone on earth is
 * twelve hours from UTC, and the formatter is pinned anyway, so the month this
 * returns is a pure function of the three numbers in the string. That is the
 * requirement — every reader of this document must see the same period, and a
 * `date` column has no instant for a timezone to legitimately move.
 *
 * Returns "" for anything that is not a well-formed day, so a bad value shows
 * up as a missing period rather than as `Invalid Date` on a document a
 * landlord is reading.
 */
export function formatWorkDayMonthYear(day: string): string {
  const m = ISO_DAY.exec(day);
  if (!m) return "";
  const noonUtc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return noonUtc.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: PLATFORM_TIME_ZONE,
  });
}

function displayName(input: Pick<WorkRecordDocumentInput, "fullName">): string {
  return input.fullName ?? "Helpr Member";
}

/** The two date columns `resolveWorkDayRange` reads off a completed job row. */
export interface WorkRecordJobDates {
  /**
   * `jobs.date_needed` — the day the work was scheduled to happen. A Postgres
   * `date`, so the wire value is a bare `YYYY-MM-DD`.
   *
   * NOT NULL on the `jobs` TABLE (verified against prod 2026-08-31: the column
   * is in PostgREST's `required` list and zero rows are null). Typed nullable
   * here anyway because the two views over this table — `jobs_helper_safe` and
   * `open_jobs_browse` — surface it as `string | null`, since a Postgres view
   * loses the base column's NOT NULL. If this record is ever re-pointed at a
   * view, the fallback below is already correct rather than newly required.
   */
  date_needed: string | null;
  /** `jobs.created_at` — when the job was POSTED. NOT NULL, always. */
  created_at: string;
}

/**
 * THE ACTIVE PERIOD IS WHEN THE WORK HAPPENED, NOT WHEN IT WAS POSTED.
 *
 * This range used to be min/max of `jobs.created_at`. That is the day the
 * CUSTOMER wrote the listing, which is not what this document claims. The
 * sheet says "Active Period" on a page headed "Employment & Earnings Record",
 * next to a footer stating it was generated from a job history, and the
 * landlord or lender reading it takes it literally as the span the helper
 * worked. `date_needed` is that span. In prod right now 18 of 64 jobs (28%)
 * are posted in a different month from the one they are worked in, so this is
 * not a rounding difference — it is a different claim about the same person.
 *
 * WHAT A NULL `date_needed` DOES: IT FALLS BACK TO `created_at` FOR THAT ROW.
 * It is not excluded. Excluding it is the tempting choice and it is the wrong
 * one, because it fails silently in the direction that hurts: the row is still
 * counted in "Jobs Completed" and still counted in "Total Earnings", so
 * dropping it from the period alone produces a sheet whose own numbers
 * contradict each other — N jobs and a dollar total spanning a period that
 * demonstrably cannot contain them. Worse, if the undated row is the OLDEST
 * one, the record silently reports a shorter career than the helper has, and
 * nothing on the page tells the reader a job was left out. `created_at` is
 * never null and a job is posted at or shortly before the work, so the
 * fallback is the closest evidence the row carries about when it happened: the
 * period may be a few days wide at that edge, but it never omits work that the
 * rest of the document is counting.
 *
 * The fallback is normalised to the CHICAGO calendar day first, so both
 * branches yield the same kind of value — a bare `YYYY-MM-DD` — and the
 * min/max below is a plain lexicographic string compare. Zero-padded ISO days
 * sort correctly as strings, so the range needs no date parsing at all and
 * therefore cannot drift with the reader's zone. A row that yields neither a
 * usable day nor a parseable `created_at` is skipped rather than allowed to
 * poison the range with `Invalid Date`; with no usable row at all the caller
 * gets null and the period prints "-", exactly as zero completed jobs does.
 */
export function resolveWorkDayRange(
  jobs: readonly WorkRecordJobDates[],
): { first: string; last: string } | null {
  let first: string | null = null;
  let last: string | null = null;
  for (const job of jobs) {
    const day = workDayOf(job);
    if (day === null) continue;
    if (first === null || day < first) first = day;
    if (last === null || day > last) last = day;
  }
  return first !== null && last !== null ? { first, last } : null;
}

/** One job's day worked, as `YYYY-MM-DD`, or null if the row carries neither. */
function workDayOf(job: WorkRecordJobDates): string | null {
  // `slice(0, 10)` is insurance only: a `date` column arrives as "2026-08-07",
  // but a future view or RPC that widens it to a timestamp would otherwise
  // fail the regex and drop the row to the fallback for no reason.
  const needed = job.date_needed?.slice(0, 10);
  if (needed && ISO_DAY.test(needed)) return needed;
  const posted = new Date(job.created_at);
  if (Number.isNaN(posted.getTime())) return null;
  // `en-CA` formats as YYYY-MM-DD; the zone is pinned for the same reason
  // every other date here is.
  return posted.toLocaleDateString("en-CA", { timeZone: PLATFORM_TIME_ZONE });
}

/** `November 2025 - March 2026`, or "-" when no job has been completed. */
function activePeriod(
  input: Pick<WorkRecordDocumentInput, "firstWorkDay" | "lastWorkDay">,
  dash = "-",
): string {
  if (!input.firstWorkDay || !input.lastWorkDay) return "-";
  const from = formatWorkDayMonthYear(input.firstWorkDay);
  const to = formatWorkDayMonthYear(input.lastWorkDay);
  // A malformed day formats to "" — print "-" rather than " - March 2026".
  if (!from || !to) return "-";
  return `${from} ${dash} ${to}`;
}

function workRecordFileName(input: WorkRecordDocumentInput): string {
  const slug = displayName(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Platform zone, like every other date on the record — `getFullYear()` and
  // friends read the READER's zone, so the filename could name a different day
  // from the "Generated <date>" line printed inside the file it names.
  // `en-CA` formats as YYYY-MM-DD.
  const iso = input.generatedAt.toLocaleDateString("en-CA", { timeZone: PLATFORM_TIME_ZONE });
  return `helpr-work-record-${slug || "helpr-member"}-${iso}.pdf`;
}

/**
 * Plain-text summary. This is the FALLBACK only — used when the PDF can't be
 * built (offline, chunk load failure) — and it is deliberately what it always
 * was minus the URL.
 *
 * The dollar figure stays out of it, on purpose: a text share renders as a
 * message preview and can land anywhere with one tap, and the original text
 * disclosed only a job count. The amount lives inside the attachment, which is
 * a deliberate hand-off, and in Print -> Save as PDF, which already carries it.
 */
export function buildWorkRecordSummaryLines(input: WorkRecordDocumentInput): string[] {
  const jobs = input.jobsCompleted;
  // Derived from the SAME `activePeriod` the tiles use, and suppressed on its
  // own "-" sentinel rather than on a second, hand-rolled null check — a
  // duplicated guard is how the summary line and the tile drift apart.
  const span = activePeriod(input, "–");
  const period = span === "-" ? "" : ` (${span})`;
  return [
    `Helpr Work Record — ${displayName(input)}`,
    `${jobs} job${jobs === 1 ? "" : "s"} completed on Helpr${period}`,
    input.avgRating !== null
      ? `${input.avgRating.toFixed(1)}★ average across ${input.reviewCount} review${input.reviewCount === 1 ? "" : "s"}`
      : null,
    input.identityVerified ? "Identity verified by Stripe" : null,
    `Verify this record: ${VERIFICATION_EMAIL}`,
  ].filter((l): l is string => !!l);
}

/**
 * The four WORK SUMMARY facts, in the on-screen document's order, so the page
 * and the PDF can never drift into showing different NUMBERS.
 *
 * The Total Earnings tile used to carry a small "after platform fee"
 * sub-label. The owner had it removed from the PDF on 2026-08-31 and from the
 * SCREEN on the same day, so the two surfaces match again and this list is
 * once more label-for-label identical to `WorkRecord.tsx`. The figure never
 * changed — still take-home, still floored, still what was actually
 * transferred, which is the only defensible number on an employment record.
 * Only the caption is gone. Do not reinstate it on one surface alone.
 */
function workRecordStats(
  input: WorkRecordDocumentInput,
): { label: string; value: string }[] {
  return [
    { label: "Jobs Completed", value: String(input.jobsCompleted) },
    {
      label: "Total Earnings",
      // Floored, exactly as the on-screen tile is: this is the one number that
      // must never read a cent above what was actually transferred.
      value: `$${formatPriceFloor(input.totalEarnings)}`,
    },
    { label: "Active Period", value: activePeriod(input) },
    {
      label: "Avg Rating",
      value:
        input.avgRating !== null
          ? `${input.avgRating.toFixed(1)} (${input.reviewCount})`
          : "No reviews yet",
    },
  ];
}

/**
 * The footer sentence. Two branches, and the unverified one states plainly that
 * identity has NOT been verified rather than staying silent — this sheet is
 * read by people deciding whether to rent to someone.
 */
function workRecordFooterText(input: WorkRecordDocumentInput): string {
  const today = formatLongDate(input.generatedAt);
  const identity = input.identityVerified
    ? `This record was generated from Helpr's job history on ${today}. This member's identity was verified by Stripe.`
    : `This record was generated from this member's completed job history on Helpr on ${today}. This member's identity has not been verified by Stripe.`;
  return `${identity} Helpr is a Louisiana-based labor marketplace. For verification inquiries: ${VERIFICATION_EMAIL}`;
}

export interface WorkRecordFile {
  fileName: string;
  /** Base64 WITHOUT a `data:` prefix — what Filesystem.writeFile wants. */
  base64: string;
  /** The same bytes, for the web `<a download>` branch. */
  blob: Blob;
}

/** ASCII only below this line. jsPDF's built-in Helvetica is Latin-1, so a
 *  smart quote, an en dash or a star glyph renders as mojibake on the one
 *  document that has to look official. */

/**
 * THE DOCUMENT'S PALETTE — the app's tokens, resolved to RGB.
 *
 * These were `INK = 26` / `MUTED = 110` / `RULE = 205`: three neutral greys,
 * no logo, and a Helvetica "Helpr" typed as literal text. Owner, 2026-08-31:
 * "work record pdf is missing branding." A helper was handing a landlord a
 * plain grey office printout of a page that, in the app, is the most branded
 * surface they own.
 *
 * jsPDF has no CSS, so the tokens are inlined here with the token they came
 * from named beside them. All four are the LIGHT-mode values on purpose: a PDF
 * has one appearance, and it is printed on white paper.
 */
const INK: RGB = [35, 35, 26]; // --ink-deep   hsl(64 16% 12%)
const MUTED: RGB = [100, 102, 84]; // --olivewood, lightened to ~5.9:1 on white
const RULE: RGB = [214, 211, 200]; // warm hairline, not a neutral grey
const BARK: RGB = [94, 101, 68]; // --bark       #5E6544
const SIENNA: RGB = [152, 66, 22]; // --burnt-sienna #984216
const BAND: RGB = [240, 241, 235]; // --bark at ~8% over white

type RGB = readonly [number, number, number];

const PAGE_W = 612;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Render the record as a real PDF.
 *
 * jsPDF is ~450KB and is already a dependency (the tax export uses it); the
 * dynamic import keeps it off this page's critical path. It is imported inside
 * this function rather than at module scope so opening /work-record does not
 * pay for a document nobody has asked to share yet.
 */
export async function buildWorkRecordPdf(input: WorkRecordDocumentInput): Promise<WorkRecordFile> {
  const { default: jsPDF } = await import("jspdf");
  const doc: jsPDFType = new jsPDF({ orientation: "portrait", unit: "pt", format: "letter" });

  /** `setTextColor` and friends take three channels; the palette is tuples. */
  const ink = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);

  const rule = (y: number) => {
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.75);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  };
  const label = (text: string, x: number, y: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    ink(MUTED);
    doc.text(text.toUpperCase(), x, y, { charSpace: 0.6 });
  };
  /**
   * Fit `text` into `maxW`: shrink from `start` to `min`, then wrap.
   *
   * The measuring MUST happen with the font already set. jsPDF's
   * `getTextWidth`/`splitTextToSize` read the document's CURRENT font state,
   * and an earlier draft split at the 7.5pt label size and then drew at 11pt —
   * so "Maximiliana Guillory-Thibodeaux III" was measured as fitting and
   * rendered straight through the "ID verified by Stripe" column next to it.
   * Caught by rendering the PDF, not by reading the code.
   */
  const fitLines = (text: string, maxW: number, start: number, min: number) => {
    doc.setFont("helvetica", "bold");
    for (let size = start; size >= min; size -= 0.5) {
      doc.setFontSize(size);
      if (doc.getTextWidth(text) <= maxW) return { lines: [text], size };
    }
    doc.setFontSize(min);
    return { lines: doc.splitTextToSize(text, maxW) as string[], size: min };
  };

  // ==========================================================================
  // LETTERHEAD — the crest, the wordmark, the title.
  //
  // This was `setFont("helvetica","bold")` + `text("Helpr")`: the brand name
  // as literal type, in the same face as the field labels, on a page with no
  // logo and no colour anywhere. Owner: "work record pdf is missing branding."
  //
  // Three changes, in the order they matter:
  //
  //  1. THE CREST IS THE MARK. `HELPR_MARK_PNG` is the wrought-iron H — the
  //     one the owner has twice asked for by name ("Emails should use the h
  //     logo") and the one on the app-lock screen. Drawn at its true aspect
  //     ratio from `HELPR_MARK_PX`, never a guessed box, so it cannot squash.
  //  2. THE WORDMARK IS SET IN A SERIF ITALIC. In the app "Helpr" is italic EB
  //     Garamond with a Burnt-Sienna "- LA" tail (see HelprMark.tsx). jsPDF
  //     ships only the standard 14 faces, and embedding EB Garamond would mean
  //     `addFileToVFS` + `addFont` and a ~200KB base64 font subset in the
  //     chunk, for one export, on a path that must also work offline. Times
  //     BoldItalic is a real serif italic, costs ZERO bytes because every PDF
  //     reader has it, and cannot fall back to tofu in whatever ancient
  //     Acrobat a leasing office runs. So the masthead is branded and the body
  //     stays in a neutral face — which is what a financial document should
  //     look like anyway. Deliberate trade, not an oversight.
  //  3. COLOUR. Bark on the section band, Burnt Sienna on the LA tail, warm
  //     hairlines. Enough to read as Helpr, not so much that a landlord thinks
  //     he is holding an advert.
  // ==========================================================================
  const MARK_H = 30;
  const MARK_W = (HELPR_MARK_PX.width / HELPR_MARK_PX.height) * MARK_H;
  doc.addImage(HELPR_MARK_PNG, "PNG", MARGIN, 52, MARK_W, MARK_H);

  const wordmarkX = MARGIN + MARK_W + 10;
  doc.setFont("times", "bolditalic");
  doc.setFontSize(25);
  ink(INK);
  doc.text("Helpr", wordmarkX, 78);
  // MEASURE WHILE THE WORDMARK'S FONT IS STILL SET. `getTextWidth` reads the
  // document's CURRENT font and size — the same trap `fitLines` below
  // documents — so measuring after the switch to 12pt italic would place the
  // tail on top of the "r".
  const wordmarkW = doc.getTextWidth("Helpr");

  // The "\u00B7 LA" tail, on the wordmark's baseline — the same Burnt-Sienna
  // suffix HelprMark.tsx renders in the app.
  //
  // The interpunct is the ONE non-ASCII character on this page, and it is safe
  // where a smart quote or an en dash is not: jsPDF's built-in faces encode
  // through WinAnsi/Latin-1, which has U+00B7 at 0xB7. An en dash (U+2013) has
  // no Latin-1 slot at all, which is why `activePeriod` prints a hyphen. If a
  // future edit adds another non-ASCII glyph here, RENDER THE PDF and look —
  // the failure is a silently wrong glyph, not an exception.
  doc.setFont("times", "italic");
  doc.setFontSize(12);
  ink(SIENNA);
  doc.text("\u00B7 LA", wordmarkX + wordmarkW + 7, 78, { charSpace: 1.6 });

  doc.setFont("times", "bolditalic");
  doc.setFontSize(18);
  ink(INK);
  doc.text("Employment & Earnings Record", MARGIN, 112);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  ink(MUTED);
  doc.text(`Generated ${formatLongDate(input.generatedAt)}`, MARGIN, 128);

  rule(146);

  // Identity row - three even columns, same three facts as the sheet.
  const colW = CONTENT_W / 3;
  // "MEMBER SINCE" KEEPS `profiles.created_at`, RE-CONFIRMED 2026-08-31 when
  // Active Period moved off `jobs.created_at`. They are two different facts and
  // only one of them moved: this is TIME ON THE PLATFORM — the day the account
  // was opened — which `profiles.created_at` is the literal record of and which
  // no job date could answer (a helper can join in March and work first in
  // August). Active Period below is TIME WORKED. They also cannot be read as
  // the same line: they sit in different sections of the sheet, under
  // different headings, and one is a single month where the other is a span.
  const cols: [string, string][] = [
    ["Issued to", displayName(input)],
    ["ID verified by Stripe", input.identityVerified ? "Verified" : "Not verified"],
    ["Member since", formatMonthYear(input.memberSince)],
  ];
  cols.forEach(([l, v], i) => {
    const x = MARGIN + colW * i;
    label(l, x, 172);
    // A long legal name shrinks, then wraps — it never runs into the column
    // beside it, because on a record handed to a landlord the neighbouring
    // field is "ID verified by Stripe".
    // `fitLines` leaves the font set at the size it chose, so `doc.text`
    // below draws at exactly the size the measurement was made at.
    const { lines } = fitLines(v, colW - 14, 11, 8);
    ink(INK);
    doc.text(lines, x, 189, { lineHeightFactor: 1.2 });
  });

  rule(214);

  // Work summary band - the section header, in bark on a bark tint rather
  // than grey type on a neutral wash.
  doc.setFillColor(BAND[0], BAND[1], BAND[2]);
  doc.rect(MARGIN, 214, CONTENT_W, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  ink(BARK);
  doc.text("WORK SUMMARY", MARGIN + 10, 229, { charSpace: 1.2 });
  rule(236);

  /**
   * Row pitch for the 2x2 stat grid.
   *
   * It was 62, sized for a THREE-part cell: label, value, and a small
   * "after platform fee" sub-label under the money figure. The owner removed
   * that sub-label from the PDF on 2026-08-31, so 62 left a ~14pt hole under
   * every value — the tile stopped deciding its own height and just kept the
   * space its deleted content used to occupy.
   *
   * 48 is label (7.5pt cap) + 20pt to the value baseline + air. Headroom is
   * deliberate rather than tight: `fitLines` shrinks a long value to 9pt
   * before it wraps, and a wrapped second line adds ~10pt, so even the worst
   * case lands ~8pt clear of the next row's label.
   */
  const ROW_PITCH = 48;
  const stats = workRecordStats(input);
  const cellW = CONTENT_W / 2;
  stats.forEach((s, i) => {
    const x = MARGIN + (i % 2) * cellW;
    const y = 268 + Math.floor(i / 2) * ROW_PITCH;
    label(s.label, x, y);
    const { lines } = fitLines(s.value, cellW - 18, 15, 9);
    ink(INK);
    doc.text(lines, x, y + 20, { lineHeightFactor: 1.15 });
  });

  const footerTop = 268 + Math.ceil(stats.length / 2) * ROW_PITCH - 12;
  rule(footerTop);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  ink(MUTED);
  const footerLines = doc.splitTextToSize(workRecordFooterText(input), CONTENT_W) as string[];
  doc.text(footerLines, MARGIN, footerTop + 20);

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  return {
    fileName: workRecordFileName(input),
    base64: toBase64(bytes),
    blob: new Blob([bytes], { type: "application/pdf" }),
  };
}
