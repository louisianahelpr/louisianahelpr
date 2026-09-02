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
import { formatPriceFloor } from "./format";
// The letterhead, palette and page geometry are SHARED with every other Helpr
// document (see pdfDocument.ts). They used to be locals in this file; /home-history
// needed the same masthead, and a second copy is how two records end up with
// two letterheads.
import {
  CONTENT_W,
  INK,
  MARGIN,
  MUTED,
  VERIFICATION_EMAIL,
  createLetterheadPdf,
  finishPdf,
  type PdfFile,
} from "./pdfDocument";

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

/** Kept as a named export because /work-record imports it; the shape is the
 *  shared {@link PdfFile}, so a second document cannot drift from it. */
export type WorkRecordFile = PdfFile;

/** ASCII only below this line — see the note in pdfDocument.ts. */

/**
 * Render the record as a real PDF.
 *
 * The letterhead, palette and page geometry come from `createLetterheadPdf`
 * (pdfDocument.ts) so this record and /home-history's cannot drift into two
 * house styles. Everything below the masthead rule is this document's own.
 */
export async function buildWorkRecordPdf(input: WorkRecordDocumentInput): Promise<WorkRecordFile> {
  const { doc, ink, rule, label, band, fitLines } = await createLetterheadPdf(
    "Employment & Earnings Record",
    `Generated ${formatLongDate(input.generatedAt)}`,
  );

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
  // than grey type on a neutral wash. Same primitive /home-history's sections
  // use, so the two documents band identically.
  band("Work summary", 214);

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

  return finishPdf(doc, workRecordFileName(input));
}
