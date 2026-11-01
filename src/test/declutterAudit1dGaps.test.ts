/**
 * Audit 1d gap fixes (2026-10-29, ~/.lh-shots/app-audit-1028/1d-gaps/REPORT-1d.md), B101:
 *  - D4-6: the moving sale's "Hire a Helpr for moving day" and "Haul away what's left" opened a blank Post a job
 *    (bare `/post-job`). Every Declutter link to Post a job now carries a pre-fill param.
 *  - D4-7: the haul-away link stopped at "What do you need done?" and never said it was the haul-away. It opens at
 *    Details (PREFILL_OPENS_DETAILS) with a "Haul-away for N items" line.
 *  - D4-13: Sell a bunch showed a grey "40" in an empty Price box (it read like a value) and cut the title.
 *  - D4-14: going offline mid-post said "Something went wrong. Please try again."
 *
 * @mutate src/components/declutter/DeclutterBunchMovingSale.tsx |               <Link to={movingDayPostJobPath(current ?? date)}>Hire a Helpr for moving day</Link> |               <Link to="/post-job">Hire a Helpr for moving day</Link>
 * @mutate src/components/declutter/DeclutterBunchMovingSale.tsx | <Link to={haulIds.length > 0 ? haulAwayPostJobPath(haulIds) : movingDayPostJobPath(current ?? date)}>Haul away what's left</Link> | <Link to="/post-job">Haul away what's left</Link>
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts | MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM, "rebook"] as const; | MATCHMAKER_PARAM, MOVING_DAY_PARAM, "rebook"] as const;
 * @mutate src/pages/post-job/usePrefillOpensDetails.ts | MATCHMAKER_PARAM, "haulAway", MOVING_DAY_PARAM, "rebook"] as const; | MATCHMAKER_PARAM, "haulAway", "rebook"] as const;
 * @mutate src/pages/post-job/usePostJobForm.ts | searchParams.get(MATCHMAKER_PARAM) \|\| searchParams.get(MOVING_DAY_PARAM)); | searchParams.get(MATCHMAKER_PARAM));
 * @mutate src/pages/post-job/useJobFormEffects.ts |     const p = buildMovingDayPrefill(raw, todayYmd()); |     const p = buildMovingDayPrefill(raw, todayYmd()); return;
 * @mutate src/pages/post-job/FormStep.tsx |           {form.haulAwayItemIds && form.haulAwayItemIds.length > 0 && ( |           {false && (
 * @mutate src/lib/declutter/movingDayJob.ts |   const date = YMD.test(param) && param >= today ? param : null; |   const date = YMD.test(param) ? param : null;
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | onChange={(e) => onChange({ price: e.target.value })} placeholder="Set a price" /> | onChange={(e) => onChange({ price: e.target.value })} placeholder="40" />
 * @mutate src/components/declutter/DeclutterBunchRow.tsx | <span id={nameId} className="block break-words text-ds-14 font-semibold">{name}</span> | <span id={nameId} className="block truncate text-ds-14 font-semibold">{name}</span>
 * @mutate src/lib/declutter/errors.ts |   if (deviceOffline()) return DECLUTTER_OFFLINE_COPY; |   if (false) return DECLUTTER_OFFLINE_COPY;
 * @mutate src/lib/declutter/errors.ts |   if (isNetworkFailure(err)) return CONNECTION_TROUBLE_COPY; |   if (false) return CONNECTION_TROUBLE_COPY;
 * @mutate src/components/declutter/DeclutterWantedViews.tsx | ? `${msg} We kept what you typed.` : msg); | ? msg : msg);
 */
import { readFileSync } from "node:fs";
import { setConnectivity } from "@/lib/connectivity";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { trackedFiles } from "./helpers/trackedFiles";
import { buildMovingDayPrefill, movingDayPostJobPath, MOVING_DAY_PARAM } from "@/lib/declutter/movingDayJob";
import { prefillOpensDetails } from "@/pages/post-job/usePrefillOpensDetails";
import { DECLUTTER_OFFLINE_COPY, declutterErrorMessage } from "@/lib/declutter/errors";
import { CONNECTION_TROUBLE_COPY } from "@/lib/networkFailure";

const root = process.cwd();
const code = (f: string) => blankComments(readFileSync(join(root, f), "utf8"));

describe("D4-6: every Declutter link to Post a job is pre-filled", () => {
  const dir = "src/components/declutter";
  const files = trackedFiles(dir).filter((f) => f.endsWith(".tsx") && !f.includes(".test."));

  it("no Declutter screen links to a bare /post-job", () => {
    expect(files.length).toBeGreaterThan(80);
    const bare = files.filter((f) => /["'`]\/post-job["'`]/.test(code(f)));
    expect(bare).toEqual([]);
  });

  it("the moving sale's two links: moving day carries the move-out date, haul-away the listed items", () => {
    const src = code(`${dir}/DeclutterBunchMovingSale.tsx`);
    expect(src).toContain("<Link to={movingDayPostJobPath(current ?? date)}>Hire a Helpr for moving day</Link>");
    expect(src).toContain("haulAwayPostJobPath(haulIds)");
    expect(movingDayPostJobPath("2026-11-15")).toBe(`/post-job?${MOVING_DAY_PARAM}=2026-11-15`);
    expect(movingDayPostJobPath(null)).toBe(`/post-job?${MOVING_DAY_PARAM}=1`);
    expect(movingDayPostJobPath("next week")).toBe(`/post-job?${MOVING_DAY_PARAM}=1`);
  });

  it("the moving-day pre-fill: Moving help, a title under the 32-character cap, the date only when still ahead", () => {
    const p = buildMovingDayPrefill("2026-11-15", "2026-10-30");
    expect(p.category).toBe("moving");
    expect(p.title.length).toBeGreaterThan(0);
    expect(p.title.length).toBeLessThanOrEqual(32);
    expect(p.description.length).toBeLessThanOrEqual(1000);
    expect(p.dateNeeded).toBe("2026-11-15");
    expect(buildMovingDayPrefill("2026-10-30", "2026-10-30").dateNeeded).toBe("2026-10-30");
    expect(buildMovingDayPrefill("2026-10-01", "2026-10-30").dateNeeded).toBeNull();
    expect(buildMovingDayPrefill("1", "2026-10-30").dateNeeded).toBeNull();
  });

  it("Post a job reads the param: skips the start screen and fills the job", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toContain("searchParams.get(MATCHMAKER_PARAM) || searchParams.get(MOVING_DAY_PARAM));");
    const fx = code("src/pages/post-job/useJobFormEffects.ts");
    expect(fx).toMatch(/const raw = searchParams\.get\(MOVING_DAY_PARAM\);\s*if \(!raw\) return;\s*const p = buildMovingDayPrefill\(raw, todayYmd\(\)\);\s*setCategory\(p\.category\);\s*setTitle\(p\.title\);\s*setDescription\(p\.description\);\s*if \(p\.dateNeeded\) setDateNeeded\?\.\(p\.dateNeeded\);/);
  });
});

describe("D4-7: the haul-away and moving-day links open at Details and say what they are", () => {
  it("both links skip the category groups once their category lands; an ordinary post never does", () => {
    expect(prefillOpensDetails(new URLSearchParams("haulAway=a,b"))).toBe(true);
    expect(prefillOpensDetails(new URLSearchParams(`${MOVING_DAY_PARAM}=1`))).toBe(true);
    expect(prefillOpensDetails(new URLSearchParams(""))).toBe(false);
  });

  it("Details shows the haul-away line with the item count once the pre-fill loaded", () => {
    expect(code("src/pages/post-job/usePostJobForm.ts")).toMatch(/prefillOpensDetails: prefillOpensDetails\(searchParams\),\s*haulAwayItemIds,/);
    const step = code("src/pages/post-job/FormStep.tsx");
    const details = step.slice(step.indexOf('data-form-page="2"'));
    expect(details.indexOf("data-testid=\"haul-away-line\"")).toBeGreaterThan(0);
    expect(details.indexOf("data-testid=\"haul-away-line\"")).toBeLessThan(details.indexOf("<DetailsSection"));
    expect(step).toContain("{form.haulAwayItemIds && form.haulAwayItemIds.length > 0 && (");
    expect(step).toMatch(/Haul-away for \{form\.haulAwayItemIds\.length\} \{form\.haulAwayItemIds\.length === 1 \? "item" : "items"\}/);
  });
});

describe("D4-13: Sell a bunch never shows a number where no price was set, and the title wraps", () => {
  it("the price box's placeholder holds no digit; the item name is not cut", () => {
    const src = code("src/components/declutter/DeclutterBunchCard.tsx");
    const price = src.split("\n").find((l) => l.includes("<input id={`price-${id}`}")) ?? "";
    expect(price).not.toBe("");
    const ph = price.match(/placeholder="([^"]*)"/)?.[1];
    expect(ph).toBeDefined();
    expect(ph).not.toMatch(/\d/);
    // The row is what says the name now.
    const name = code("src/components/declutter/DeclutterBunchRow.tsx").match(/<span id=\{nameId\} className="[^"]*">\{name\}<\/span>/)?.[0] ?? "";
    expect(name).not.toBe("");
    expect(name).not.toContain("truncate");
    expect(name).toContain("break-words");
  });
});

describe("D4-14: a Declutter call that never reached the server says so", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("offline: the offline words; a dropped connection: the shared connection words; a real refusal: its own words", () => {
    // Offline CONFIRMED (src/lib/connectivity.ts): the offline words.
    setConnectivity(false);
    expect(declutterErrorMessage(new Error("TypeError: Failed to fetch"))).toBe(DECLUTTER_OFFLINE_COPY);
    setConnectivity(true);
    // navigator.onLine=false alone is only a hint (owner 10-31): not "You're offline".
    vi.stubGlobal("navigator", { ...navigator, onLine: false });
    expect(declutterErrorMessage(new Error("TypeError: Failed to fetch"))).toBe(CONNECTION_TROUBLE_COPY);
    vi.stubGlobal("navigator", { ...navigator, onLine: true });
    expect(declutterErrorMessage(new Error("TypeError: Failed to fetch"))).toBe(CONNECTION_TROUBLE_COPY);
    expect(declutterErrorMessage(new Error("Load failed"))).toBe(CONNECTION_TROUBLE_COPY);
    expect(declutterErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
    expect(declutterErrorMessage(Object.assign(new Error("x"), { userMessage: "Its own words." }))).toBe("Its own words.");
  });

  it("the Wanted form adds that what was typed is kept", () => {
    const src = code("src/components/declutter/DeclutterWantedViews.tsx");
    expect(src).toContain("msg === DECLUTTER_OFFLINE_COPY || msg === CONNECTION_TROUBLE_COPY ? `${msg} We kept what you typed.` : msg);");
  });
});
