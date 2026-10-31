/**
 * "What do you want to sell?" (owner 2026-10-30, via the lead): the page every Sell button opens, modelled on Post a
 * job's first step (the same big shared card, an icon and one line each). Checked here:
 *   1. The six choices, in order, each to the flow that already exists; Moving out sale and Post a Wanted only while
 *      their switches are on for the viewer.
 *   2. A deep link that already says what to sell (?mode=bunch, ?item=, ?free=1, none) never shows the chooser.
 *   3. Every Sell button in src/ opens the chooser: the section's "add" (top bar, empty Selling pill), the Create
 *      sheet, Browse's "Sell something", "More ways to sell". No file links the bare one-item form as "Sell" except the
 *      route itself and the no-nav list (inventory from the tracked source, so a new Sell button is caught).
 *   4. One shared card: the chooser and Post a job's first step both draw ChoiceCard, neither hand-rolls one.
 *   5. Never says "Claude" (owner: say "we"); under 18 sees the Sell flow's notice, no choices.
 *   6. "Have a Helpr list it for me" is Post a job pre-filled with the owner's words.
 *   7. POST-H17: the two "Other ways" cards are compact rows and every main card's line is at most 50 characters, so all
 *      six reach a 375x812 screen (measured b18 10-31 in headless Chromium: Wanted's bottom 865px before, 807px after).
 *
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <ChoiceCard compact data-sell-choice="wanted" | <ChoiceCard data-sell-choice="wanted"
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <ChoiceCard compact data-sell-choice="helpr" | <ChoiceCard data-sell-choice="helpr"
 * @mutate src/components/ui/ChoiceCard.tsx | data-compact={compact ? "" : undefined} {...rest}>\n        {body}\n      </Link> | {...rest}>\n        {body}\n      </Link>
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | line="Your move date groups everything as one sale." | line="Add photos of everything, and your move date groups them as one sale."
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |             <HelprListExplainSheet open={explaining} onClose={() => setExplaining(false)} />\n |
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <h3 className="pt-1 text-ds-13 font-semibold text-muted-foreground" data-sell-other="">Other ways</h3> |
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |             {movingOut && ( |             {true && (
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |             {wanted && ( |             {true && (
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | to={SELL_FREE_PATH} | to={SELL_ONE_PATH}
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | line="Add photos and we write the listing for you." | line="Add photos and Claude writes the listing for you."
 * @mutate src/lib/declutter/sellChooser.ts |   return mode === "bunch" \|\| mode === "moving"; |   return mode === "bunch";
 * @mutate src/pages/declutter/DeclutterMovePage.tsx |   return <Navigate to={SELL_MOVE_PATH} replace />; |   return <Navigate to="/declutter" replace />;
 * @mutate src/lib/declutter/sellChooser.ts |   return params.get("mode") === "choose"; |   return params.get("mode") !== "bunch";
 * @mutate src/components/sections/sectionsConfig.ts | add: { label: "Sell an item", path: SELL_CHOOSER_PATH } | add: { label: "Sell an item", path: "/declutter/sell" }
 * @mutate src/components/create/CreateSheet.tsx | declutter: [{ label: "Sell an item", path: SELL_CHOOSER_PATH } | declutter: [{ label: "Sell an item", path: "/declutter/sell" }
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | <Link to={SELL_CHOOSER_PATH}>Sell something</Link> | <Link to="/declutter/sell">Sell something</Link>
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | "/post-job", "/declutter/sell"]; | "/post-job"];
 * @mutate src/pages/post-job/EntryChoice.tsx |     <ChoiceCard key={key} icon={icon} title={title} line={line} onClick={onClick} extra={extra} /> |     <button key={key} type="button" onClick={onClick}>{title}{line}</button>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";
import { trackedFiles } from "@/test/helpers/trackedFiles";

const state = vi.hoisted(() => ({ switches: {} as Record<string, boolean>, underAge: false }));

// The one-time setup in front of posting is proved in sellerSetup.test.tsx; here, the form behind it.
vi.mock("@/hooks/useMapKitJs", () => ({ useMapKitJs: () => "missing-token" }));
vi.mock("@/components/declutter/SellerSetup", () => ({ SellerSetupGate: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/hooks/useFeature", () => ({
  useFeature: (k: string) => state.switches[k] ?? false,
  useFeatureStatus: (k: string) => ({ on: state.switches[k] ?? false, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: state.underAge, explain: () => {}, gatedProps: () => ({}) }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (<main><h1>{title}</h1>{children}</main>),
}));
vi.mock("@/components/declutter/DeclutterSellView", () => ({ default: () => <p>one item form</p> }));
vi.mock("@/components/declutter/DeclutterBunchView", () => ({ default: () => <p>bunch form</p> }));

import DeclutterSellPage from "@/pages/declutter/DeclutterSellPage";
import DeclutterMovePage from "@/pages/declutter/DeclutterMovePage";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { buildSellForMePrefill, sellForMePostJobPath } from "@/lib/declutter/sellForMe";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

afterEach(() => {
  cleanup();
  state.switches = {};
  state.underAge = false;
});

function at(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes><Route path="/declutter/sell" element={<DeclutterSellPage />} /><Route path="/post-job" element={<p>job form</p>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const choices = () =>
  Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-sell-choice]")).map((a) => [a.dataset.sellChoice, a.getAttribute("href")]);

describe("What do you want to sell?", () => {
  it("offers the six ways, in order, each to its own flow", async () => {
    state.switches = { declutter: true, declutter_moving_out: true, declutter_wanted: true };
    at(SELL_CHOOSER_PATH);
    expect(await screen.findByRole("heading", { name: "What would you like to do?" })).toBeTruthy();
    expect(choices()).toEqual([
      ["one", "/declutter/sell"],
      ["bunch", "/declutter/sell?mode=bunch"],
      ["move", "/declutter/sell?mode=moving"],
      ["free", "/declutter/sell?free=1"],
      ["helpr", null],
      ["wanted", "/declutter?tab=wanted&post=1"],
    ]);
    // Each card says what it is and one line under it (the shared card's two text rows).
    for (const a of Array.from(document.querySelectorAll("[data-sell-choice]"))) expect(a.querySelectorAll("span.block").length).toBe(2);
  });

  it("drops Moving out sale and Post a Wanted while their switches are off for the viewer", async () => {
    state.switches = { declutter: true };
    at(SELL_CHOOSER_PATH);
    await screen.findByRole("heading", { name: "What would you like to do?" });
    expect(choices().map(([k]) => k)).toEqual(["one", "bunch", "free", "helpr"]);
  });

  it.each(["/declutter/sell", "/declutter/sell?item=d1", "/declutter/sell?free=1"])("a deep link (%s) opens the one-item flow, never the chooser", async (url) => {
    state.switches = { declutter: true };
    at(url);
    expect(await screen.findByText("one item form")).toBeTruthy();
    expect(document.querySelector("[data-sell-chooser]")).toBeNull();
  });

  it("?mode=bunch opens Sell a bunch, never the chooser", async () => {
    state.switches = { declutter: true };
    at("/declutter/sell?mode=bunch");
    expect(await screen.findByText("bunch form")).toBeTruthy();
    expect(document.querySelector("[data-sell-chooser]")).toBeNull();
  });

  it("?mode=moving opens the same bunch form, and /declutter/move sends old links there", async () => {
    state.switches = { declutter: true };
    at("/declutter/sell?mode=moving");
    expect(await screen.findByText("bunch form")).toBeTruthy();
    cleanup();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(featureSwitchBatchKey("u1"), { declutter: true });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/declutter/move"]}>
          <Routes>
            <Route path="/declutter/move" element={<DeclutterMovePage />} />
            <Route path="/declutter/sell" element={<DeclutterSellPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("bunch form")).toBeTruthy();
  });

  it("under 18 sees the Sell flow's notice and no choices", async () => {
    state.switches = { declutter: true, declutter_moving_out: true, declutter_wanted: true };
    state.underAge = true;
    at(SELL_CHOOSER_PATH);
    expect(await screen.findByText("You must be 18 or older to sell on Declutter.")).toBeTruthy();
    expect(choices()).toEqual([]);
  });

  // Audit 10-30 #1, #17.
  it("'Have a Helpr list it for me' says what it means first, then goes on to the job", async () => {
    state.switches = { declutter: true, declutter_wanted: true };
    at(SELL_CHOOSER_PATH);
    await screen.findByRole("heading", { name: "What would you like to do?" });
    expect(document.querySelector("[data-sell-other]")!.textContent).toBe("Other ways");
    expect(document.querySelector('[data-sell-choice="wanted"]')!.textContent).toContain("Post a Wanted");
    fireEvent.click(document.querySelector('[data-sell-choice="helpr"]')!);
    const sheet = await screen.findByRole("dialog");
    for (const t of ["What the Helpr does", "What you do", "What you pay", "Who keeps the sale money", "What doesn't sell"]) expect(within(sheet).getByText(t)).toBeTruthy();
    expect(sheet.textContent).not.toContain("Claude");
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("job form")).toBeTruthy();
  });

  // POST-H17 (b18 10-31): Wanted was below a 375x812 screen.
  it("the two Other ways cards are compact and the main lines are short, so all six fit a phone", async () => {
    state.switches = { declutter: true, declutter_moving_out: true, declutter_wanted: true };
    at(SELL_CHOOSER_PATH);
    await screen.findByRole("heading", { name: "What would you like to do?" });
    const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-sell-choice]"));
    expect(cards.length).toBeGreaterThan(5);
    const compact = cards.filter((c) => c.hasAttribute("data-compact")).map((c) => c.dataset.sellChoice);
    expect(compact).toEqual(["helpr", "wanted"]);
    for (const c of cards.filter((x) => !x.hasAttribute("data-compact"))) {
      const line = c.querySelectorAll("span.block")[1]!.textContent!;
      expect(line.length, `${c.dataset.sellChoice}: ${line}`).toBeLessThanOrEqual(50);
    }
  });

  it("'Have a Helpr list it for me' is Post a job pre-filled with the owner's words", () => {
    expect(sellForMePostJobPath()).toBe("/post-job?sellForMe=1");
    expect(buildSellForMePrefill().title).toBe("Help me list my things to sell");
  });

  it("never says Claude (the owner: say \"we\")", () => {
    const src = blankComments(readFileSync(join(process.cwd(), "src/components/declutter/DeclutterSellChooser.tsx"), "utf8"));
    expect(src).toMatch(/we write/);
    expect(src).not.toMatch(/Claude/);
  });
});

describe("every Sell button opens the chooser", () => {
  it("the section's add (top bar and the empty Selling pill) is the chooser", () => {
    expect(sectionByKey("declutter").add.path).toBe(SELL_CHOOSER_PATH);
  });

  it("no source file sends a Sell button to the bare one-item form (inventory of tracked src/)", () => {
    const files = trackedFiles("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && !f.startsWith("src/test/"));
    expect(files.length).toBeGreaterThan(500);
    // A quoted "/declutter/sell" with nothing after it: the one-item form's own address.
    const BARE = /["'`]\/declutter\/sell["'`]/;
    // The route itself and the no-nav list name the path, they are not buttons; the chooser's "One item" names it
    // through SELL_ONE_PATH, in the one module that holds the paths.
    // @two-way src/components/declutter/declutterSellChooser.test.tsx:stale baseline entry in the bare-path list
    const ALLOWED = new Set(["src/App.tsx", "src/components/mobileNav/mobileNavHelpers.ts", "src/lib/declutter/sellChooser.ts"]);
    const namesBarePath = (f: string) => BARE.test(blankComments(readFileSync(join(process.cwd(), f), "utf8")));
    const offenders = files.filter((f) => !ALLOWED.has(f) && namesBarePath(f));
    expect(offenders).toEqual([]);
    const stale = [...ALLOWED].filter((f) => !files.includes(f) || !namesBarePath(f));
    expect(stale, "stale baseline entry in the bare-path list: remove it").toEqual([]);
    // The Sell buttons this guard was built for each name the chooser.
    for (const f of ["src/components/create/CreateSheet.tsx", "src/components/declutter/DeclutterBrowseView.tsx", "src/components/declutter/DeclutterHomeView.tsx", "src/components/sections/sectionsConfig.ts"]) {
      expect(blankComments(readFileSync(join(process.cwd(), f), "utf8")), f).toMatch(/SELL_CHOOSER_PATH/);
    }
  });
});

describe("one shared first-step card", () => {
  const code = (f: string) => blankComments(readFileSync(join(process.cwd(), f), "utf8"));
  it("the chooser and Post a job's first step both draw ChoiceCard, and neither hand-rolls its own", () => {
    const chooser = code("src/components/declutter/DeclutterSellChooser.tsx");
    const entry = code("src/pages/post-job/EntryChoice.tsx");
    expect(chooser.match(/<ChoiceCard\b/g)?.length ?? 0).toBeGreaterThan(5);
    expect(chooser).not.toMatch(/<(button|Link)\b/);
    expect(entry).toMatch(/const startCard = [^\n]*\n\s*<ChoiceCard\b/);
    // The card's own look lives in ChoiceCard only: the 104px olive-circle row is not drawn by hand in either flow.
    for (const src of [chooser, entry]) expect(src).not.toMatch(/inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-\[hsl\(var\(--bark\)\/0\.12\)\]/);
  });
});
