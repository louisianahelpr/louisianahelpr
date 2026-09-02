/**
 * The Home Service Record, as a DOCUMENT — the thing a homeowner hands a buyer,
 * an insurer, an appraiser or a contractor.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * /home-history bills itself, in its own empty state, as "your home's permanent
 * service history - who came out, what it cost, and when". It sits on the SAME
 * `.doc-card` document surface as /work-record, which has shipped a "Share
 * Record (PDF)" button since 2026-08-31. This screen had no export of any kind,
 * so the one thing a permanent record exists to do — leave the app — was the
 * one thing it could not do.
 *
 * WHY A PDF AND NOT `window.print()` / `<a download>` / a `blob:` LINK
 * -------------------------------------------------------------------
 * All three are inert inside the Capacitor WKWebView (CLAUDE.md). The idiom
 * that works on every surface this app ships to is the one /work-record and
 * calendarExport.ts already use: build real bytes, hand `shareFileNative` a
 * file with a real extension, and let it pick the native share sheet or the web
 * download. Nothing here knows which branch runs.
 *
 * The letterhead comes from `pdfDocument.ts`, shared with the work record, so
 * the two documents a member can produce are visibly from the same company.
 */
import { formatPriceExact } from "./format";
import {
  CONTENT_W,
  INK,
  MARGIN,
  MUTED,
  PAGE_H,
  VERIFICATION_EMAIL,
  createLetterheadPdf,
  finishPdf,
  type PdfFile,
} from "./pdfDocument";

/**
 * Every date on this record resolves in the PLATFORM's zone, not the reader's.
 *
 * Same rule (and same reason) as `workRecordDocument.ts`: a job stamped
 * `2026-08-01T00:00:00Z` prints as July everywhere in the United States if it
 * is formatted in the device's zone. The record and the on-screen card share
 * this function so they cannot print two different days for one job.
 */
const PLATFORM_TIME_ZONE = "America/Chicago";

export function formatRecordDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "Unknown date";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: PLATFORM_TIME_ZONE,
  });
}

/** The long "Generated" form on the masthead. */
function formatLongRecordDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: PLATFORM_TIME_ZONE,
  });
}

export interface HomeHistoryJobRow {
  /** The job title, verbatim. */
  title: string;
  /** Human category label ("Cleaning"), already resolved by the caller. */
  category: string;
  /** ISO instant of the day the work was DONE (not the day it was posted). */
  serviceDate: string | null;
  /** Every Helpr who did it. Empty when the roster could not be resolved. */
  helpers: string[];
  /** Dollars charged to the poster — `posterPaidDollars`, never `budget`. */
  paid: number;
  /** Parish, falling back to the free-text location. */
  where: string | null;
}

export interface HomeHistoryDocumentInput {
  /** `profiles.full_name` of the homeowner this record belongs to. */
  ownerName: string | null;
  /** Newest first — the same order the screen renders. */
  jobs: HomeHistoryJobRow[];
  generatedAt: Date;
}

/**
 * "A neighbor" is the app's fallback for a missing name, and it is wrong on a
 * document: the "Issued to" line of a record handed to a lender cannot read
 * like a placeholder. An unnamed account gets an explicit statement instead.
 */
function ownerLine(input: HomeHistoryDocumentInput): string {
  const trimmed = (input.ownerName ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Name not on file";
}

/** `home-service-record-jane-doe-2026-09-01.pdf` — searchable in Downloads. */
export function homeHistoryFileName(input: HomeHistoryDocumentInput): string {
  const slug = ownerLine(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const day = input.generatedAt.toISOString().slice(0, 10);
  return `home-service-record-${slug || "helpr"}-${day}.pdf`;
}

/** The service window: first job worked -> last job worked. */
export function resolveServiceSpan(jobs: HomeHistoryJobRow[]): string {
  const days = jobs
    .map((j) => j.serviceDate)
    .filter((d): d is string => !!d && !Number.isNaN(new Date(d).getTime()))
    .sort();
  if (days.length === 0) return "-";
  const first = formatRecordDate(days[0]);
  const last = formatRecordDate(days[days.length - 1]);
  // A hyphen, not an en dash: jsPDF's built-in faces are Latin-1 and U+2013
  // has no slot there, so an en dash renders as a wrong glyph, silently.
  return first === last ? first : `${first} - ${last}`;
}

export function totalPaid(jobs: HomeHistoryJobRow[]): number {
  return jobs.reduce((acc, j) => acc + (Number.isFinite(j.paid) ? j.paid : 0), 0);
}

/**
 * "Marcus Thibodeaux", "Marcus and Renee", "Marcus, Renee and Dee".
 *
 * NOT `Intl.ListFormat`, which this project's `lib: ES2020` target does not
 * declare (it is ES2021) — and widening the whole app's lib for one comma is
 * the wrong trade. The Oxford comma is deliberately omitted to match the app's
 * existing list copy.
 */
export function formatHelperList(helpers: string[]): string {
  const named = helpers.map((h) => h.trim()).filter(Boolean);
  if (named.length === 0) return "Not recorded";
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The plain-text fallback, for when the PDF itself cannot be built (offline, a
 * chunk-load failure). Deliberately carries NO url — there is no public route
 * that shows someone's home history, and a filler link is what made
 * /work-record share the marketing homepage (see nativeShare.ts).
 */
export function buildHomeHistorySummaryLines(input: HomeHistoryDocumentInput): string[] {
  const jobs = input.jobs;
  return [
    "HOME SERVICE RECORD",
    `Property owner: ${ownerLine(input)}`,
    `Jobs on record: ${jobs.length}`,
    `Total paid: $${formatPriceExact(totalPaid(jobs))}`,
    `Service period: ${resolveServiceSpan(jobs)}`,
    "",
    ...jobs.map(
      (j) =>
        `${formatRecordDate(j.serviceDate)} - ${j.title} (${j.category}) - ${formatHelperList(
          j.helpers,
        )} - $${formatPriceExact(j.paid)}`,
    ),
    "",
    `Generated from Helpr on ${formatLongRecordDate(input.generatedAt)}.`,
    `Verify this record: ${VERIFICATION_EMAIL}`,
  ];
}

/* ── The PDF ───────────────────────────────────────────────────────────────
   ASCII (Latin-1) only below this line — see the note in pdfDocument.ts. */

/** Column geometry for the job table, as fractions of the content column. */
const COL = {
  date: 0,
  service: 0.2,
  helpr: 0.62,
  paid: 1, // right-aligned to the content edge
} as const;

const ROW_TOP_PAD = 16;
const FOOTER_RESERVE = 92;

export async function buildHomeHistoryPdf(
  input: HomeHistoryDocumentInput,
): Promise<PdfFile> {
  const { doc, ink, rule, label, band, fitLines } = await createLetterheadPdf(
    "Home Service Record",
    `Generated ${formatLongRecordDate(input.generatedAt)}`,
  );

  const x = (frac: number) => MARGIN + CONTENT_W * frac;

  // Identity row - three even columns, mirroring the work record's.
  const colW = CONTENT_W / 3;
  const cols: [string, string][] = [
    ["Property owner", ownerLine(input)],
    ["Jobs on record", String(input.jobs.length)],
    ["Service period", resolveServiceSpan(input.jobs)],
  ];
  cols.forEach(([l, v], i) => {
    label(l, MARGIN + colW * i, 172);
    // Shrink, then wrap: a long legal name must never run into the column
    // beside it. `fitLines` leaves the font at the size it chose, so the draw
    // below happens at exactly the size that was measured.
    const { lines } = fitLines(v, colW - 14, 11, 8);
    ink(INK);
    doc.text(lines, MARGIN + colW * i, 189, { lineHeightFactor: 1.2 });
  });

  rule(214);
  band("Completed jobs", 214);

  const drawColumnHeads = (y: number) => {
    label("Date", x(COL.date), y);
    label("Service", x(COL.service), y);
    label("Helpr", x(COL.helpr), y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    ink(MUTED);
    doc.text("PAID", x(COL.paid), y, { align: "right", charSpace: 0.6 });
    return y + 6;
  };

  let y = drawColumnHeads(252);
  rule(y);
  y += ROW_TOP_PAD;

  const serviceW = CONTENT_W * (COL.helpr - COL.service) - 12;
  const helprW = CONTENT_W * (COL.paid - COL.helpr) - 58;

  for (const job of input.jobs) {
    // Wrap FIRST, so the row's real height is known before anything is drawn
    // and a two-line title can't be split across a page break.
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const titleLines = doc.splitTextToSize(job.title, serviceW) as string[];
    const helprLines = doc.splitTextToSize(formatHelperList(job.helpers), helprW) as string[];
    const bodyLines = Math.max(titleLines.length, helprLines.length);
    const rowH = bodyLines * 12 + 12; // + the category sub-line

    if (y + rowH > PAGE_H - FOOTER_RESERVE) {
      doc.addPage();
      y = drawColumnHeads(72);
      rule(y);
      y += ROW_TOP_PAD;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    ink(INK);
    doc.text(formatRecordDate(job.serviceDate), x(COL.date), y);
    doc.text(titleLines, x(COL.service), y, { lineHeightFactor: 1.25 });
    doc.text(helprLines, x(COL.helpr), y, { lineHeightFactor: 1.25 });
    doc.text(`$${formatPriceExact(job.paid)}`, x(COL.paid), y, { align: "right" });

    doc.setFontSize(8);
    ink(MUTED);
    const where = job.where ? ` - ${job.where}` : "";
    doc.text(`${job.category}${where}`, x(COL.service), y + bodyLines * 12);

    y += rowH;
  }

  rule(y - 4);
  y += 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  ink(INK);
  doc.text("Total paid", x(COL.date), y);
  doc.text(`$${formatPriceExact(totalPaid(input.jobs))}`, x(COL.paid), y, { align: "right" });

  y += 22;
  rule(y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  ink(MUTED);
  // Says exactly what the figures ARE, because the whole defect this document
  // was built alongside is a "what it cost" heading over a budget column.
  const footer =
    `This record was generated from the completed jobs on this Helpr account on ` +
    `${formatLongRecordDate(input.generatedAt)}. Amounts are the total charged to the ` +
    `property owner for each job, including the platform service fee, any urgent tip and ` +
    `Louisiana sales tax. Helpr is a Louisiana-based labor marketplace. ` +
    `For verification inquiries: ${VERIFICATION_EMAIL}`;
  doc.text(doc.splitTextToSize(footer, CONTENT_W) as string[], MARGIN, y + 20);

  return finishPdf(doc, homeHistoryFileName(input));
}
