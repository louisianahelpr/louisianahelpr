/**
 * Q2431: Admin "Weekly jobs flyer" (lead 2026-10-27, from the owner's own
 * hand-made flyer, ~/Downloads/"Blue Orange Retro Preppy Happy Home Poster.png").
 *
 * A 1080x1350 (Instagram portrait) PNG of this week's live open jobs, drawn on
 * a canvas in the browser: light green and cream vertical stripes, a cream
 * wavy panel, a handwritten "Open jobs this week" title, each job in condensed
 * caps (TITLE / DAY M/D · TIME · TOWN / $TAKE-HOME), "APPLY AT
 * LOUISIANAHELPR.COM" in thin caps and the H logo at the bottom.
 *
 * The price is what the Helpr takes home (the /browse card's computeNet over
 * the job's own fee stamp, floored to whole dollars like every payout), never
 * the poster's price and never a fee number (owner: members never see fee
 * numbers). The jobs are real: read from open_jobs_browse (what members can
 * apply to right now) and never a job marked is_seed (see AdminWeeklyFlyer).
 *
 * Fonts: Borel (handwritten title) and Bebas Neue (condensed caps), both SIL
 * Open Font License, bundled as hashed assets and loaded only when a flyer is
 * drawn, so no other screen pays for them. "APPLY AT" uses Montserrat, which
 * the app already serves.
 */
import { computeNet } from "@/components/dashboard/JobPrice";
import { floorPayoutDollars } from "@/lib/helperEarnings";
import { tierFeePercent } from "@/lib/subscriptionTiers";
import type { FlatFeeStamp } from "@/lib/helprFlatFee";

const FLYER_W = 1080;
const FLYER_H = 1350;

/** The owner's flyer, sampled pixel by pixel (1620x2000 original). */
const FLYER_COLORS = {
  stripeGreen: "#a9ad86",
  stripeCream: "#eae5e1",
  panel: "#f4f2ee",
  title: "#55583d",
  ink: "#2b2a26",
} as const;

/** The most jobs one flyer holds; more than this stops being readable on a phone. */
export const FLYER_MAX_JOBS = 5;

/** One open_jobs_browse row, the columns the flyer reads. */
export interface FlyerSourceJob extends FlatFeeStamp {
  id: string;
  title: string | null;
  budget: number | string | null;
  date_needed: string | null;
  start_time: string | null;
  /** The view's masked location: "Street-free City, LA" ("New Iberia, LA"). */
  location: string | null;
  pricing_mode: string | null;
  urgent_fee?: number | string | null;
  helpers_needed?: number | null;
  is_group_job?: boolean | null;
}

/**
 * Real jobs only (Q2431: "never is_seed"). Keeps a row only when the seed read
 * names it with is_seed === false: a row the read did not return, or returned
 * with a null flag, is left off, so a partial read can never print a test job.
 */
export function realJobsOnly<T extends { id: string }>(
  rows: readonly T[],
  seedFlags: ReadonlyArray<{ id: string; is_seed: boolean | null }>,
): T[] {
  const real = new Set(seedFlags.filter((s) => s.is_seed === false).map((s) => s.id));
  return rows.filter((r) => real.has(r.id));
}

/** One job as it prints. */
export interface FlyerJob {
  id: string;
  /** The heading line, as the admin edited it (printed in caps). */
  title: string;
  dateNeeded: string | null;
  startTime: string | null;
  town: string | null;
  /** Whole dollars the Helpr takes home, or null when the job takes quotes. */
  takeHome: number | null;
}

const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function calendarDate(d: string | null | undefined): Date | null {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** "SUN 11/1", read as a calendar date (no timezone shift). */
export function flyerDayDate(d: string | null | undefined): string | null {
  const date = calendarDate(d);
  if (!date) return null;
  return `${DAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;
}

/** "9 AM", "6:30 PM"; null without a start time. */
export function flyerTime(t: string | null | undefined): string | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h24 = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h24) || h24 > 23 || min > 59) return null;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return min === 0 ? `${h12} ${suffix}` : `${h12}:${String(min).padStart(2, "0")} ${suffix}`;
}

/**
 * The town from the view's masked location ("New Iberia, LA" -> "New Iberia").
 * A full address ("4804 Dolphin St, New Iberia, LA 70560") gives the same
 * answer: the segment before the state.
 */
export function flyerTown(location: string | null | undefined): string | null {
  const parts = (location ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return /^\s*LA\b/i.test(parts[0]) || /\d/.test(parts[0]) ? null : parts[0];
  const town = parts[parts.length - 2];
  return /\d/.test(town) ? null : town;
}

/**
 * What one Helpr takes home on this job, in whole dollars: the /browse card's
 * computeNet over the job's fee stamp, split across a crew, floored like the
 * payout. A job without a stamp (funded before the flat model) prices at the
 * standard rate, as a member with no membership sees it. Null for a quotes
 * job or a job with no price.
 */
export function flyerTakeHome(job: FlyerSourceJob): number | null {
  if (job.pricing_mode === "quotes") return null;
  const budget = Number(job.budget);
  if (job.budget === null || !Number.isFinite(budget) || budget <= 0) return null;
  const helpers = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const net = computeNet(budget, tierFeePercent(null), Number(job.urgent_fee ?? 0), helpers, 0, job).netEarnings;
  if (!Number.isFinite(net) || net <= 0) return null;
  return floorPayoutDollars(net);
}

/** "Mow and Weed Eat" -> "MOW & WEED EAT"; trims shouting punctuation ("GIVE AWAY!!" -> "GIVE AWAY"). */
export function flyerTitle(title: string | null | undefined): string {
  return (title ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+and\s+/gi, " & ")
    .replace(/\s*[!?.]+$/g, "")
    .toUpperCase();
}

export function toFlyerJob(job: FlyerSourceJob): FlyerJob {
  return {
    id: job.id,
    title: flyerTitle(job.title),
    dateNeeded: job.date_needed,
    startTime: job.start_time,
    town: flyerTown(job.location),
    takeHome: flyerTakeHome(job),
  };
}

/** The three printed lines of one job: TITLE / SUN 11/1 · 9 AM · NEW IBERIA / $89. */
export function flyerJobLines(job: FlyerJob): [string, string, string] {
  const when = [flyerDayDate(job.dateNeeded), flyerTime(job.startTime), job.town?.toUpperCase() ?? null]
    .filter(Boolean)
    .join(" · ");
  const price = job.takeHome === null ? "GET QUOTES" : `$${job.takeHome}`;
  return [job.title.toUpperCase(), when, price];
}

/**
 * The jobs a weekly flyer starts with: a date from today through the next six
 * days (a job with no date is flexible and counts too), soonest first.
 */
export function thisWeeksJobs<T extends { date_needed: string | null }>(jobs: readonly T[], today: Date): T[] {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const inWeek = jobs.filter((j) => {
    if (!j.date_needed) return true;
    const d = calendarDate(j.date_needed);
    return d !== null && d >= start && d < end;
  });
  return [...inWeek].sort((a, b) => {
    const da = calendarDate(a.date_needed)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const db = calendarDate(b.date_needed)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return da - db;
  });
}

/** The ready-to-paste post caption. Take-home figures only, never a fee. */
export function flyerCaption(jobs: readonly FlyerJob[]): string {
  const lines = jobs.map((j) => {
    const day = flyerDayDate(j.dateNeeded);
    const when = [day ? titleCase(day) : null, flyerTime(j.startTime)].filter(Boolean).join(", ");
    const where = j.town ? ` in ${j.town}` : "";
    const pay = j.takeHome === null ? "get quotes" : `$${j.takeHome}`;
    return `- ${titleCase(j.title)}${where}${when ? `, ${when}` : ""}: ${pay}`;
  });
  return [
    "Open jobs this week on Louisiana Helpr.",
    "",
    ...lines,
    "",
    "The price shown is what the Helpr takes home. Apply at louisianahelpr.com",
    "",
    "#Louisiana #Acadiana #LocalJobs #LouisianaHelpr",
  ].join("\n");
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase());
}

/* ------------------------------------------------------------------ */
/* Drawing (browser only)                                              */
/* ------------------------------------------------------------------ */

const SCRIPT = "LHFlyerScript";
const CONDENSED = "LHFlyerCondensed";
const SANS = `Montserrat, "Montserrat Fallback", system-ui, sans-serif`;

let fontsReady: Promise<void> | null = null;

/** Load the two flyer fonts once. A font that fails to load leaves the system fallback, never a blank flyer. */
function loadFlyerFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof FontFace === "undefined" || typeof document === "undefined") return;
    const [{ default: scriptUrl }, { default: condensedUrl }] = await Promise.all([
      import("@/assets/fonts/borel-latin.woff2"),
      import("@/assets/fonts/bebas-neue-latin.woff2"),
    ]);
    const faces = [new FontFace(SCRIPT, `url(${scriptUrl})`), new FontFace(CONDENSED, `url(${condensedUrl})`)];
    const loaded = await Promise.allSettled(faces.map((f) => f.load()));
    for (const r of loaded) if (r.status === "fulfilled") document.fonts.add(r.value);
    // Montserrat is the app's own face; ask for the weight the footer uses.
    await document.fonts.load(`400 40px Montserrat`).catch(() => undefined /* the system sans prints instead */);
  })();
  return fontsReady;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A logo that will not load only leaves the flyer without it.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The wavy panel: a rounded rectangle whose edge is pushed in and out along
 * its normal by a cosine, with a whole number of waves round the perimeter so
 * the path closes smoothly (the owner's panel: ~37px deep, ~360px apart).
 */
export function wavyPanelPoints(
  box: { x: number; y: number; w: number; h: number; r: number },
  amplitude: number,
  waves: number,
  steps = 720,
): Array<[number, number]> {
  const { x, y, w, h, r } = box;
  const straightW = w - 2 * r;
  const straightH = h - 2 * r;
  const arc = (Math.PI / 2) * r;
  const perimeter = 2 * straightW + 2 * straightH + 4 * arc;
  const pointAt = (s: number): { px: number; py: number; nx: number; ny: number } => {
    let d = ((s % perimeter) + perimeter) % perimeter;
    // top edge, left to right
    if (d < straightW) return { px: x + r + d, py: y, nx: 0, ny: -1 };
    d -= straightW;
    if (d < arc) {
      const a = -Math.PI / 2 + d / r;
      return { px: x + w - r + r * Math.cos(a), py: y + r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arc;
    if (d < straightH) return { px: x + w, py: y + r + d, nx: 1, ny: 0 };
    d -= straightH;
    if (d < arc) {
      const a = d / r;
      return { px: x + w - r + r * Math.cos(a), py: y + h - r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arc;
    if (d < straightW) return { px: x + w - r - d, py: y + h, nx: 0, ny: 1 };
    d -= straightW;
    if (d < arc) {
      const a = Math.PI / 2 + d / r;
      return { px: x + r + r * Math.cos(a), py: y + h - r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arc;
    if (d < straightH) return { px: x, py: y + h - r - d, nx: -1, ny: 0 };
    d -= straightH;
    const a = Math.PI + d / r;
    return { px: x + r + r * Math.cos(a), py: y + r + r * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
  };
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * perimeter;
    const { px, py, nx, ny } = pointAt(s);
    const off = amplitude * Math.cos((2 * Math.PI * waves * s) / perimeter);
    pts.push([px + nx * off, py + ny * off]);
  }
  return pts;
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, family: string, size: number, maxWidth: number, weight = "400"): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 18 && ctx.measureText(text).width > maxWidth) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

/** Draw the flyer and return it as a PNG blob. */
export async function drawWeeklyJobsFlyer(jobs: readonly FlyerJob[], logoSrc: string): Promise<Blob> {
  await loadFlyerFonts();
  const canvas = document.createElement("canvas");
  canvas.width = FLYER_W;
  canvas.height = FLYER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas_unavailable");

  // Stripes: 50px bands, green first (the owner's 75px bands at 1620 wide).
  const band = 50;
  for (let x = 0, i = 0; x < FLYER_W; x += band, i++) {
    ctx.fillStyle = i % 2 === 0 ? FLYER_COLORS.stripeGreen : FLYER_COLORS.stripeCream;
    ctx.fillRect(x, 0, band, FLYER_H);
  }

  // The cream wavy panel.
  const pts = wavyPanelPoints({ x: 160, y: 150, w: 760, h: 1080, r: 150 }, 30, 12);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [px, py] of pts.slice(1)) ctx.lineTo(px, py);
  ctx.closePath();
  ctx.fillStyle = FLYER_COLORS.panel;
  ctx.fill();

  const cx = FLYER_W / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // Handwritten title, two lines, thickened with a same-colour stroke like the owner's.
  ctx.fillStyle = FLYER_COLORS.title;
  ctx.strokeStyle = FLYER_COLORS.title;
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  const titleSize = fitFont(ctx, "this week", `${SCRIPT}, cursive`, 104, 560);
  ctx.font = `400 ${titleSize}px ${SCRIPT}, cursive`;
  for (const [line, y] of [["Open jobs", 330], ["this week", 460]] as const) {
    ctx.fillText(line, cx, y);
    ctx.strokeText(line, cx, y);
  }

  // Jobs, centred in the space between the title and the footer.
  const shown = jobs.slice(0, FLYER_MAX_JOBS);
  const top = 560;
  const bottom = 960;
  const lineGap = shown.length <= 2 ? 1.0 : 0.96;
  const jobGap = shown.length <= 2 ? 0.95 : shown.length === 3 ? 0.6 : 0.4;
  // 3 lines per job + a gap between jobs, measured in "line heights".
  const units = shown.length * 3 * lineGap + Math.max(0, shown.length - 1) * jobGap;
  const lineH = Math.min(50, (bottom - top) / Math.max(units, 1));
  const size = Math.round(lineH * 0.98);
  const blockH = units * lineH;
  let y = top + (bottom - top - blockH) / 2 + lineH * 0.8;
  ctx.fillStyle = FLYER_COLORS.ink;
  for (const job of shown) {
    for (const line of flyerJobLines(job)) {
      fitFont(ctx, line, `${CONDENSED}, "Arial Narrow", sans-serif`, size, 640);
      ctx.fillText(line, cx, y);
      y += lineH * lineGap;
    }
    y += lineH * jobGap;
  }
  if (shown.length === 0) {
    ctx.font = `400 44px ${CONDENSED}, "Arial Narrow", sans-serif`;
    ctx.fillText("NEW JOBS ARE POSTED EVERY DAY", cx, (top + bottom) / 2);
  }

  // Footer: thin caps, then the H.
  ctx.fillStyle = FLYER_COLORS.ink;
  fitFont(ctx, "APPLY AT LOUISIANAHELPR.COM", SANS, 40, 650, "400");
  ctx.fillText("APPLY AT LOUISIANAHELPR.COM", cx, 1035);

  const logo = await loadImage(logoSrc);
  if (logo) {
    const h = 92;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, cx - w / 2, 1085, w, h);
  }

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("flyer_not_drawn"))), "image/png"),
  );
}
