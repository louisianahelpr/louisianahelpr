/**
 * NO GREETING ON A PHONE'S HOME (owner 11-14, Depop/Vinted audit item 6: "Home: drop logo row and greeting"). The page
 * opens on Next up straight under the search bar; its name is a visually hidden h1, "Home". Q1158 (11-06) had
 * index.html draw the phone greeting into #lh-home-shell so it painted with the HTML; that script, its markup
 * constants and the shell's greeting slot are gone, so nothing is drawn first and then taken away. The desktop website
 * keeps its greeting in the bar, with the hours rule and the first name this device kept for the signed-in account
 * (cleared on every sign-out and on an account switch), which this file still holds.
 *
 * Measured (local dev, 390x844, ~/.lh-shots/scroll-chips-1114/): before, "Good afternoon, Hallie" at y 58-83 above
 * Next up; after, no greeting and Next up starts under the search bar.
 *
 * @mutate src/pages/home/HomeDashboard.tsx |           phone={<h1 className="sr-only">{t("home.h1")}</h1>} |           phone={<div><h1 className="sr-only">{t("home.h1")}</h1><p data-home-greeting="">{greeting()}</p></div>}
 * @mutate src/lib/i18n/enHome.ts |   "home.h1": "Home", |   "home.h1": "Dashboard",
 * @mutate src/components/DashboardRouteSkeleton.tsx |               {desktop && ( |               {true && (
 * @mutate src/lib/authSignOut.ts |   clearGreetingName();\n |\n
 * @mutate src/main.tsx |           if (event === "SIGNED_OUT") clearGreetingName(); |           if (event === "SIGNED_OUT") void 0;
 * @mutate src/main.tsx |           else if (event === "SIGNED_IN" && session?.user) clearGreetingName(session.user.id); |
 * @mutate src/pages/home/HomeDashboard.tsx |     if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst); |
 * @mutate src/lib/homeGreetingShell.mjs |     return v && v.u === userId && typeof v.n === "string" ? v.n : ""; |     return v && typeof v.n === "string" ? v.n : "";
 * @mutate src/lib/homeGreetingShell.mjs |       if (v && v.u === keepUserId) return; |       if (v) return;
 * @mutate src/lib/homeGreetingShell.mjs |   if (lang === "es") return | if (lang === "xx") return
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blankComments } from "./helpers/blankNonCode";
import { SHELLS } from "../../scripts/inline-shell-css.mjs";
import { enHome } from "@/lib/i18n/enHome";
import { GREETING_NAME_KEY, clearGreetingName, greetingFor, readGreetingName, saveGreetingName } from "@/lib/homeGreetingShell.mjs";
import * as greetingModule from "@/lib/homeGreetingShell.mjs";

const ROOT = join(__dirname, "..", "..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const INDEX = read("index.html");
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const scripts = [...INDEX.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)].map((m) => m[1]);
const HOME_AT = INDEX.indexOf('<div id="lh-home-shell"');
const homeShell = HOME_AT < 0 ? "" : INDEX.slice(HOME_AT, INDEX.indexOf('data-lh-shell="end"', HOME_AT));

describe("a phone's Home draws no greeting, in the app or in the HTML (owner 11-14)", () => {
  afterEach(() => localStorage.clear());

  it("HomeDashboard's phone row is only the hidden h1, and its name is Home", () => {
    const home = blankComments(read("src/pages/home/HomeDashboard.tsx"));
    expect(home).toContain('phone={<h1 className="sr-only">{t("home.h1")}</h1>}');
    expect(home).not.toContain("data-home-greeting");
    expect(enHome["home.h1"]).toBe("Home");
    // The desktop website keeps its greeting as the bar's title.
    expect(home).toContain("title={first ? `${greeting()}, ${first}` : greeting()}");
  });

  it("index.html carries no greeting script, and its copy of Home has no greeting slot", () => {
    expect(scripts.length).toBeGreaterThan(10);
    expect(homeShell.length).toBeGreaterThan(1000);
    for (const b of scripts) {
      expect(b).not.toContain('data-skeleton-part="greeting"');
      expect(b).not.toMatch(/Good (morning|afternoon|evening)|Buenas tardes|helpr_greeting_name/);
    }
    expect(homeShell).not.toContain('data-skeleton-part="greeting"');
    expect(homeShell).toContain('data-skeleton-part="next-up"');
  });

  it("the route skeleton draws the greeting bone on the desktop website only", () => {
    const sk = blankComments(read("src/components/DashboardRouteSkeleton.tsx"));
    expect(sk).toMatch(/\{desktop && \(\s*<div data-skeleton-part="greeting">/);
  });

  it("the HTML's greeting helpers are gone: no markup constants, no extra markup for the CSS inliner", () => {
    expect(Object.keys(greetingModule).sort()).toEqual(["GREETING_NAME_KEY", "OWN_HANDLE_KEY", "clearGreetingName", "greetingDate", "greetingFor", "readGreetingName", "saveGreetingName"]);
    const home = SHELLS.find((s: { id: string }) => s.id === "lh-home-shell") as { extra?: string } | undefined;
    expect(home).toBeTruthy();
    expect(home?.extra).toBeUndefined();
  });

  it("the desktop greeting follows the hours rule, in English and Spanish", () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) seen.add(greetingFor(new Date(2026, 10, 6, h, 5)));
    expect([...seen].sort()).toEqual(["Good afternoon", "Good evening", "Good morning"]);
    expect(greetingFor(new Date(2026, 10, 6, 11, 59))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 10, 6, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 6, 16, 59))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 10, 6, 17, 0))).toBe("Good evening");
    expect(greetingFor(new Date(2026, 10, 6, 9, 0), "es")).toBe("Buenos días");
    expect(greetingFor(new Date(2026, 10, 6, 15, 0), "es")).toBe("Buenas tardes");
  });

  it("the device cache is per account: read for its own id only, cleared on sign-out, an account switch keeps only the new one's", () => {
    saveGreetingName(ME, "Hallie");
    expect(readGreetingName(ME)).toBe("Hallie");
    expect(readGreetingName(OTHER)).toBe("");
    expect(readGreetingName(null)).toBe("");
    clearGreetingName(ME);
    expect(readGreetingName(ME), "signing in as the same account keeps it").toBe("Hallie");
    clearGreetingName(OTHER);
    expect(localStorage.getItem(GREETING_NAME_KEY), "signing in as another account removes it").toBeNull();
    saveGreetingName(ME, "Hallie");
    clearGreetingName();
    expect(localStorage.getItem(GREETING_NAME_KEY), "sign-out removes it").toBeNull();
    saveGreetingName(ME, "Hallie");
    saveGreetingName(ME, "");
    expect(localStorage.getItem(GREETING_NAME_KEY), "a profile with no name removes it").toBeNull();
    localStorage.setItem(GREETING_NAME_KEY, "{bad");
    expect(readGreetingName(ME)).toBe("");
    clearGreetingName(ME);
    expect(localStorage.getItem(GREETING_NAME_KEY), "a corrupt entry is removed").toBeNull();
  });

  it("every sign-out path clears it, a sign-in as another account clears it, and HomeDashboard keeps and reads it", () => {
    const signOut = blankComments(readFileSync(join(ROOT, "src/lib/authSignOut.ts"), "utf8"));
    expect(signOut).toMatch(/clearRememberedRoute\(\);\s*clearGreetingName\(\);/);
    const main = blankComments(readFileSync(join(ROOT, "src/main.tsx"), "utf8"));
    expect(main).toContain('if (event === "SIGNED_OUT") clearGreetingName();');
    expect(main).toContain('else if (event === "SIGNED_IN" && session?.user) clearGreetingName(session.user.id);');
    const home = blankComments(readFileSync(join(ROOT, "src/pages/home/HomeDashboard.tsx"), "utf8"));
    expect(home).toContain("if (user?.id && profileFirst !== null) saveGreetingName(user.id, profileFirst);");
    expect(home).toContain("const first = profileFirst ?? readGreetingName(user?.id);");
  });
});
