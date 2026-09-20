/**
 * THE UNREAD SIGNAL IS THE ONLY ONE LEFT, SO IT HAS TO BE LEGIBLE.
 *
 * The Unread TAB was removed on 2026-09-19. From that commit, everything the
 * app says about "you have not read this" is said by one inbox row. A
 * verification pass that seeded the states and looked at them on prod measured
 * what that row was actually saying:
 *
 *   - the 8px dot resolved to rgb(156,65,22) — the EXACT ink of the
 *     `IN PROGRESS` chip 91px to its left, because the dot used
 *     --burnt-sienna and the chip uses --sienna-ink, which are byte-identical
 *     in light mode. It read as a bullet between the chip and the date;
 *   - it sat at x=187 of a 231px row, i.e. the TRAILING edge, while the only
 *     other cue (a bolder preview) starts at the LEADING edge;
 *   - the NAME was font-weight 600 whether or not anything was unread.
 *
 * ── WHY THIS GUARD IS SHAPED THE WAY IT IS ────────────────────────────────
 * "An unread row has a dot" would have been GREEN on every one of those
 * findings — the dot was there the whole time. So this asserts the properties
 * that make the mark legible rather than present:
 *
 *   1. RESOLVED COLOUR, not token names. Both the mark and the row's own
 *      status chip are resolved through src/index.css — every `hsl(var(--x))`
 *      chased to its `H S% L%`, alpha composited over the surface — and the
 *      two must be far apart in RGB. Comparing the STRINGS
 *      "hsl(var(--burnt-sienna))" and "hsl(var(--sienna-ink))" would have
 *      called the shipped bug a pass.
 *   2. MORE THAN ONE CHANNEL. Read and unread rows must differ in at least
 *      two of {mark, name weight, preview weight, preview ink}, so the signal
 *      cannot collapse back onto a single cue.
 *   3. THE NAME'S WEIGHT ACTUALLY DIFFERS. Stated separately because it was
 *      the specific thing carrying nothing.
 *   4. THE MARK LEADS. It precedes the name in document order, lives inside
 *      the avatar's box, and is inset from the LEFT — not parked beside the
 *      timestamp at the far end of the row.
 *   5. The screen-reader contract (`role="status"` + a counted aria-label)
 *      survives all of it.
 *
 * INVENTORY. The statuses are parsed out of ConversationRow's own `allowed`
 * map, so a status added there is covered here without anybody remembering to
 * come back. The audit refuses an inventory with no unread rows in it — a
 * fixture set where nothing is unread must FAIL, not vacuously pass.
 *
 * @mutate src/components/messages/ConversationRow.tsx | background: "hsl(var(--info-tint))", | background: "hsl(var(--burnt-sienna))",
 * @mutate src/components/messages/ConversationRow.tsx | const NAME_WEIGHT_UNREAD = 700; | const NAME_WEIGHT_UNREAD = 600;
 * @mutate src/components/messages/ConversationRow.tsx | className="absolute -top-0.5 -left-0.5 w-2.5 h-2.5 rounded-full" | className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full"
 * @mutate src/components/messages/ConversationRow.tsx | role="status"\n            data-testid="unread-mark" | data-testid="unread-mark"
 */
import { describe, expect, it, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { ConversationRow } from "@/components/messages/ConversationRow";
import type { Conversation } from "@/components/messages/types";

const ROOT = path.resolve(__dirname, "../..");
const ROW_SRC = fs.readFileSync(
  path.join(ROOT, "src/components/messages/ConversationRow.tsx"),
  "utf8",
);
const CSS = fs.readFileSync(path.join(ROOT, "src/index.css"), "utf8");

/* ── TOKEN RESOLUTION ──────────────────────────────────────────────────────
   index.css is the world; this reads it rather than restating it. `:root`
   carries the light theme and `[data-theme="dark"]` overrides it, exactly as
   the browser applies them. A token may point at another token
   (`--accent: var(--burnt-sienna)`), so lookup is recursive with a depth cap
   rather than a single hop. */
function tokenTable(block: RegExp): Map<string, string> {
  const body = CSS.match(block)?.[1] ?? "";
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}
const LIGHT = tokenTable(/:root\s*\{([\s\S]*?)\n\}/);
const DARK = tokenTable(/\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);

type Rgb = [number, number, number];

function hslToRgb(triplet: string): Rgb | null {
  const m = triplet.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const h = parseFloat(m[1]), S = parseFloat(m[2]) / 100, L = parseFloat(m[3]) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Chase `--name` through the theme's table (and the light fallback) to a triplet. */
function tokenTriplet(name: string, dark: boolean): string | null {
  let value: string | undefined = (dark ? DARK.get(name) : undefined) ?? LIGHT.get(name);
  for (let hop = 0; hop < 6 && value; hop++) {
    const indirect = value.match(/^var\((--[\w-]+)\)$/);
    if (!indirect) return value;
    value = (dark ? DARK.get(indirect[1]) : undefined) ?? LIGHT.get(indirect[1]);
  }
  return null;
}

/**
 * Resolve an `hsl(var(--x) [/ a])` declaration to the RGB a viewer sees,
 * compositing any alpha over the inbox's own surface (--ivory-sand, the
 * panel these rows sit on). An unresolved declaration returns null and the
 * caller fails loudly — a silent null would make every comparison pass.
 */
function resolveColour(decl: string, dark: boolean): Rgb | null {
  const m = decl.match(/hsl\(\s*var\((--[\w-]+)\)\s*(?:\/\s*([\d.]+)\s*)?\)/);
  if (!m) return null;
  const triplet = tokenTriplet(m[1], dark);
  if (!triplet) return null;
  const rgb = hslToRgb(triplet);
  if (!rgb) return null;
  const alpha = m[2] ? parseFloat(m[2]) : 1;
  if (alpha >= 1) return rgb;
  const surface = hslToRgb(tokenTriplet("--ivory-sand", dark) ?? "");
  if (!surface) return null;
  return rgb.map((c, i) => Math.round(c * alpha + surface[i] * (1 - alpha))) as Rgb;
}

const distance = (a: Rgb, b: Rgb) =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

/** Two inks this close are the same ink to a reader. Identical is 0, which is
 *  what the shipped dot measured against the IN PROGRESS chip. */
const SAME_INK = 60;

/* ── THE INVENTORY, READ OFF THE COMPONENT ─────────────────────────────── */
function statusesTheRowChips(): string[] {
  const block = ROW_SRC.match(/const allowed: Record<string, true> = \{([\s\S]*?)\n\s*\};/);
  if (!block) return [];
  // Several keys share a line and the block carries `//` comments, so strip
  // the comments first and then take every `<key>: true` in what is left.
  const body = block[1].replace(/\/\/[^\n]*/g, "");
  return [...body.matchAll(/([a-z_]+)\s*:\s*true/g)].map((m) => m[1]);
}
const STATUSES = statusesTheRowChips();

function convo(over: Partial<Conversation> & { jobId: string }): Conversation {
  return {
    otherUserId: `u-${over.jobId}`,
    otherUserName: "Hallie Hebert",
    jobTitle: "Trim crepe myrtles and haul the limbs",
    lastMessage: "Can you come Tuesday?",
    lastAt: new Date().toISOString(),
    unread: 0,
    ...over,
  } as Conversation;
}

interface RowSignals {
  markDecl: string | null;
  markClass: string;
  markRole: string | null;
  markLabel: string | null;
  markLeadsName: boolean;
  markInsideAvatarBox: boolean;
  chipDecl: string | null;
  nameWeight: string;
  previewWeight: string;
  previewColour: string;
}

function readRow(c: Conversation): RowSignals {
  const { container } = render(
    <ConversationRow convo={c} currentUserId="me" openConvo={() => {}} />,
  );
  const mark = screen.queryByTestId("unread-mark");
  const chip = screen.queryByTestId("row-status-chip");
  const name = screen.getByTestId("row-name");
  const preview = screen.getByTestId("row-preview");
  const avatarBox = container.querySelector(".relative.shrink-0.self-center");
  return {
    markDecl: mark?.style.background || null,
    markClass: mark?.className ?? "",
    markRole: mark?.getAttribute("role") ?? null,
    markLabel: mark?.getAttribute("aria-label") ?? null,
    // DOCUMENT_POSITION_FOLLOWING (4) — the name comes after the mark.
    markLeadsName: !!mark && (mark.compareDocumentPosition(name) & 4) !== 0,
    markInsideAvatarBox: !!mark && !!avatarBox && avatarBox.contains(mark),
    chipDecl: chip?.style.color || null,
    nameWeight: name.style.fontWeight,
    previewWeight: preview.style.fontWeight,
    previewColour: preview.style.color,
  };
}

/**
 * The audit itself. Returns the violations it found — and, crucially, it
 * treats an inventory with nothing unread in it as a violation rather than as
 * a clean run, which is the difference between a guard and a formality.
 */
function auditInbox(statuses: string[], dark: boolean, unreadCount = 3): string[] {
  const bad: string[] = [];
  let unreadRowsSeen = 0;

  for (const status of statuses) {
    const unread = readRow(convo({ jobId: `${status}-u`, jobStatus: status, unread: unreadCount }));
    cleanup();
    const read = readRow(convo({ jobId: `${status}-r`, jobStatus: status, unread: 0 }));
    cleanup();

    if (!unread.markDecl) {
      bad.push(`${status}: an unread row paints no mark at all`);
      continue;
    }
    unreadRowsSeen++;

    // 1. Resolved colour, against the chip standing beside it.
    const markRgb = resolveColour(unread.markDecl, dark);
    const chipRgb = unread.chipDecl ? resolveColour(unread.chipDecl, dark) : null;
    if (!markRgb) bad.push(`${status}: the mark's colour "${unread.markDecl}" does not resolve`);
    if (unread.chipDecl && !chipRgb)
      bad.push(`${status}: the chip's ink "${unread.chipDecl}" does not resolve`);
    if (markRgb && chipRgb && distance(markRgb, chipRgb) < SAME_INK) {
      bad.push(
        `${status}: the unread mark rgb(${markRgb}) is the same ink as the status chip ` +
          `rgb(${chipRgb}) beside it (distance ${distance(markRgb, chipRgb).toFixed(1)} < ${SAME_INK})`,
      );
    }

    // 2. More than one channel separates read from unread.
    const channels = [
      unread.markDecl !== read.markDecl,
      unread.nameWeight !== read.nameWeight,
      unread.previewWeight !== read.previewWeight,
      unread.previewColour !== read.previewColour,
    ].filter(Boolean).length;
    if (channels < 2)
      bad.push(`${status}: read and unread rows differ in only ${channels} channel(s)`);

    // 3. The name's weight is one of them.
    if (unread.nameWeight === read.nameWeight)
      bad.push(`${status}: the name is weight ${read.nameWeight || "(unset)"} on read AND unread`);

    // 4. The mark leads.
    if (!unread.markLeadsName) bad.push(`${status}: the mark does not precede the name`);
    if (!unread.markInsideAvatarBox) bad.push(`${status}: the mark is not on the avatar`);
    if (!/-left-/.test(unread.markClass) || /-right-/.test(unread.markClass))
      bad.push(`${status}: the mark is not inset from the leading edge (${unread.markClass})`);

    // 5. The screen-reader contract.
    if (unread.markRole !== "status") bad.push(`${status}: the mark lost role="status"`);
    if (unread.markLabel !== `${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`)
      bad.push(`${status}: the mark's aria-label is "${unread.markLabel}"`);
  }

  if (unreadRowsSeen === 0)
    bad.push("NO UNREAD ROWS IN THE INVENTORY — every assertion above was vacuous");
  return bad;
}

afterEach(cleanup);

describe("the inbox row's unread signal", () => {
  it("covers every status the row is willing to chip", () => {
    // Floor: the row chips at least the seven job_status values plus the
    // legacy `assigned` alias. An empty parse would make the audit vacuous.
    expect(STATUSES.length).toBeGreaterThan(7);
    expect(STATUSES).toContain("in_progress");
    expect(STATUSES).toContain("open");
  });

  it("resolves the palette out of index.css, not out of token names", () => {
    expect(LIGHT.size).toBeGreaterThan(50);
    expect(DARK.size).toBeGreaterThan(20);
    // The two the shipped bug conflated: identical in light, which is exactly
    // why a name-comparison could never have caught it.
    expect(resolveColour("hsl(var(--burnt-sienna))", false)).toEqual(
      resolveColour("hsl(var(--sienna-ink))", false),
    );
  });

  it.each<[string, boolean]>([["light", false], ["dark", true]])(
    "%s: the mark is legible, leading, and not a status chip's ink",
    (_theme, dark) => {
      expect(auditInbox(STATUSES, dark)).toEqual([]);
    },
  );

  const VACUOUS = "NO UNREAD ROWS IN THE INVENTORY — every assertion above was vacuous";

  it("an inventory with nothing unread FAILS — a floor, not a formality", () => {
    // (a) no statuses at all: every per-row assertion is skipped.
    expect(auditInbox([], false)).toContain(VACUOUS);
    // (b) real rows, but every one of them already read — the case that would
    //     otherwise let this whole file pass while proving nothing about the
    //     signal it exists to protect.
    expect(auditInbox(STATUSES, false, 0)).toContain(VACUOUS);
    // And it is a real floor, not a string that happens to be returned: the
    // populated run does NOT report it.
    expect(auditInbox(STATUSES, false)).not.toContain(VACUOUS);
  });
});
