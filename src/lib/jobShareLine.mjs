/**
 * ONE SHARE LINE FOR A JOB (owner 11-11, F269a): "Cleaning · Iberia Parish · Sun, Nov 29 · $116".
 *
 * A shared job link used to carry two descriptions: api/share.ts wrote "Cleaning job in New Iberia · needed Sun,
 * Nov 29 · $130. Payment is held..." (the poster's budget) into the served HTML, and the page's usePageMeta then wrote
 * "Cleaning · Iberia Parish · $116" (the guest's take-home, no date) over og:* once JS ran. So iMessage, Facebook and
 * X each showed a different card for the same job. Both now call this one function on the same open_jobs_browse row.
 *
 * Only public-safe facts (the view a signed-out guest already reads): category, parish (else town), the day, and the
 * price the public job page shows a guest, "You'd earn after fees" (shellTakeHomeDollars, which
 * src/test/browseShellCards.test.tsx holds equal to GuestJobPreview's guestTakeHome). Never the description (free
 * text can carry an address or a phone number), the poster, the address or coordinates.
 *
 * Guard: src/test/jobShareLine.test.ts.
 */
import { SHELL_CATEGORY_LABELS, shellTakeHomeDollars, shellTown } from "./browseShellCards.mjs";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** A bare YYYY-MM-DD read as a calendar day (UTC-pinned, so no server or browser zone slides it). */
function utcDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * jobDayLabel's words (src/lib/jobDateWindow.ts): "Sun, Nov 29" for one day, "Any day Nov 4-10" for a window,
 * "Any day Oct 30-Nov 5" across a month. Empty with no valid day.
 */
export function jobShareDay(dateNeeded, dateWindowEnd) {
  if (!dateNeeded || !YMD.test(dateNeeded)) return "";
  const first = utcDay(dateNeeded);
  if (Number.isNaN(first.getTime())) return "";
  if (dateWindowEnd && YMD.test(dateWindowEnd) && dateWindowEnd > dateNeeded) {
    const md = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const a = md(first);
    const b = md(utcDay(dateWindowEnd));
    const sameMonth = a.split(" ")[0] === b.split(" ")[0];
    return `Any day ${a}-${sameMonth ? b.split(" ")[1] : b}`;
  }
  return first.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "yard_work" -> the app's label, else "Yard work". */
function categoryLabel(category) {
  if (!category) return "";
  const known = SHELL_CATEGORY_LABELS[category];
  if (known) return known;
  const raw = String(category).replace(/_/g, " ").trim().toLowerCase();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
}

/** "Iberia Parish" from the view's parish stem, else the town; empty with neither. */
function areaLabel(parish, location) {
  const stem = typeof parish === "string" ? parish.trim() : "";
  if (stem) return /\bparish$/i.test(stem) ? stem : `${stem} Parish`;
  return shellTown(location);
}

/** The one description a shared job carries everywhere (name=description, og:description, twitter:description). */
export function jobShareDescription(job) {
  const parts = [categoryLabel(job.category), areaLabel(job.parish, job.location), jobShareDay(job.date_needed, job.date_window_end)];
  const net = shellTakeHomeDollars(job);
  if (net != null) parts.push(`$${net.toLocaleString("en-US")}`);
  return parts.filter(Boolean).join(" · ");
}
