/**
 * "What do you want to sell?" (owner 2026-10-30, via the lead): the page every Sell button opens, modelled on Post a
 * job's first step (the same big shared card, an icon and one line each). Checked here:
 *   1. Owner pick 5 (11-08; lead decision, not camera-first): a SHORT chooser of three cards (One item, Several at once,
 *      Give away free) and one small "More ways" row (Moving sale, A Helpr lists it, Post a Wanted), each to the flow
 *      that already exists; Moving sale and Post a Wanted only while their switches are on for the viewer.
 *   2. A deep link that already says what to sell (?mode=bunch, ?item=, ?free=1, none) never shows the chooser.
 *   3. Every Sell button in src/ opens the chooser: the section's "add" (top bar, empty Selling pill), the Create
 *      sheet, Browse's "Sell something", "More ways to sell". No file links the bare one-item form as "Sell" except the
 *      route itself and the no-nav list (inventory from the tracked source, so a new Sell button is caught).
 *   4. One shared card: the chooser and Post a job's first step both draw ChoiceCard, neither hand-rolls one.
 *   5. Never says "Claude" (owner: say "we"); under 18 sees the Sell flow's notice, no choices.
 *   6. "Have a Helpr list it for me" is Post a job pre-filled with the owner's words.
 *   7. POST-H17: everything reaches a 375x812 screen: the extra ways are text links in one row, never cards, and every
 *      card's line is at most 50 characters.
 *
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <Link data-sell-choice="wanted" to={WANTED_POST_PATH} className={MORE_LINK}>Post a Wanted</Link> | <ChoiceCard data-sell-choice="wanted" to={WANTED_POST_PATH} title="Post a Wanted" line="Tell sellers what you're after." />
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <button type="button" data-sell-choice="helpr" onClick={() => setExplaining(true)} className={MORE_LINK}>A Helpr lists it</button> | <ChoiceCard data-sell-choice="helpr" onClick={() => setExplaining(true)} title="Have a Helpr list it for me" line="A Helpr photographs and lists it." />
 * @mutate src/components/ui/ChoiceCard.tsx | data-compact={compact ? "" : undefined} {...rest}>\n        {body}\n      </Link> | {...rest}>\n        {body}\n      </Link>
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | line="Photos of everything; we write each one." | line="Add photos of everything, and we write each one of the listings for you."
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |             <HelprListExplainSheet open={explaining} onClose={() => setExplaining(false)} />\n |
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | <nav aria-label="More ways" data-sell-other="" | <nav aria-label="More ways" hidden data-sell-other=""
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |               {movingOut && <Link data-sell-choice="move" |               {true && <Link data-sell-choice="move"
 * @mutate src/components/declutter/DeclutterSellChooser.tsx |               {wanted && <Link data-sell-choice="wanted" |               {true && <Link data-sell-choice="wanted"
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | to={SELL_FREE_PATH} | to={SELL_ONE_PATH}
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | line="Photos first; we write the listing." | line="Photos first; Claude writes the listing."
 * @mutate src/lib/declutter/sellChooser.ts |   return mode === "bunch" \|\| mode === "moving"; |   return mode === "bunch";
 * @mutate src/pages/declutter/DeclutterMovePage.tsx |   return <Navigate to={SELL_MOVE_PATH} replace />; |   return <Navigate to="/declutter" replace />;
 * @mutate src/lib/declutter/sellChooser.ts |   return params.get("mode") === "choose"; |   return params.get("mode") !== "bunch";
 * @mutate src/components/sections/sectionsConfig.ts | add: { label: "Sell an item", path: SELL_CHOOSER_PATH } | add: { label: "Sell an item", path: "/declutter/sell" }
 * @mutate src/components/create/CreateSheet.tsx |       { label: "Sell an item", path: SELL_CHOOSER_PATH }, |       { label: "Sell an item", path: "/declutter/sell" },
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | { label: t("decl.sellSomething"), to: SELL_CHOOSER_PATH } | { label: t("decl.sellSomething"), to: "/declutter/sell" }
 * @mutate src/components/declutter/SellChooserEntry.tsx |       to={SELL_CHOOSER_PATH} |       to="/declutter/sell"
 * @mutate src/components/mobileNav/mobileNavHelpers.ts | "/post-job", "/declutter/sell"]; | "/post-job"];
 * @mutate src/pages/post-job/EntryChoice.tsx |     <ChoiceCard key={key} icon={icon} title={title} line={line} onClick={onClick} extra={extra} /> |     <button key={key} type="button" onClick={onClick}>{title}{line}</button>
 * @mutate src/components/declutter/DeclutterSellChooser.tsx | sub={continueTo ? undefined : "What would you like to do?"} | sub={continueTo ? undefined : "How many things?"}
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
// Declutter trades (20261106163703): the listing's "Open to trades" read is the trade module's; off here.
vi.mock("@/lib/declutter/trades", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/trades")>()),
  fetchAcceptsTrades: async () => false,
}));
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
  it("offers three cards and a small More ways row, in order, each to its own flow (owner pick 5, 11-08)", async () => {
    state.switches = { declutter: true, declutter_moving_out: true, declutter_wanted: true };
    at(SELL_CHOOSER_PATH);
    expect(await screen.findByRole("heading", { name: "Sell something" })).toBeTruthy();
    // Audit 11-10 F324: the question fits a giveaway too.
    expect(screen.getByText("What would you like to do?")).toBeTruthy();
    expect(screen.queryByText("How many things?")).toBeNull();
    expect(choices()).toEqual([
      ["one", "/declutter/sell"],
      ["bunch", "/declutter/sell?mode=bunch"],
      ["free", "/declutter/sell?free=1"],
      ["move", "/declutter/sell?mode=moving"],
      ["helpr", null],
      ["wanted", "/declutter?tab=wanted&post=1"],
    ]);
    // Three cards, each a title and one line (the shared card's two text rows); the rest are links in one row.
    const cards = Array.from(document.querySelectorAll("[data-sell-choice]")).filter((a) => a.querySelectorAll("span.block").length === 2);
    expect(cards.map((c) => (c as HTMLElement).dataset.sellChoice)).toEqual(["one", "bunch", "free"]);
    const more = document.querySelector("[data-sell-other]")!;
    expect(Array.from(more.querySelectorAll("[data-sell-choice]")).map((a) => (a as HTMLElement).dataset.sellChoice)).toEqual(["move", "helpr", "wanted"]);
  });

  it("drops Moving sale and Post a Wanted while their switches are off for the viewer", async () => {
    state.switches = { declutter: true };
    at(SELL_CHOOSER_PATH);
    await screen.findByRole("heading", { name: "Sell something" });
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
    await screen.findByRole("heading", { name: "Sell something" });
    // Q2576 (audit 1102a): Post a Wanted is no way to sell, so the row is "More ways", never "More ways to sell".
    // @mutate src/components/declutter/DeclutterSellChooser.tsx | <span className="w-full font-semibold">More ways:</span> | <span className="w-full font-semibold">More ways to sell:</span>
    expect(document.querySelector("[data-sell-other]")!.textContent).toMatch(/^More ways:/);
    expect(document.querySelector('[data-sell-choice="wanted"]')!.textContent).toContain("Post a Wanted");
    fireEvent.click(document.querySelector('[data-sell-choice="helpr"]')!);
    const sheet = await screen.findByRole("dialog");
    for (const t of ["What the Helpr does", "What you do", "What you pay", "Who keeps the sale money", "What doesn't sell"]) expect(within(sheet).getByText(t)).toBeTruthy();
    expect(sheet.textContent).not.toContain("Claude");
    fireEvent.click(within(sheet).getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("job form")).toBeTruthy();
  });

  // POST-H17 (b18 10-31): Wanted was below a 375x812 screen.
  it("the extra ways are links (never cards) and the card lines are short, so everything fits a phone", async () => {
    state.switches = { declutter: true, declutter_moving_out: true, declutter_wanted: true };
    at(SELL_CHOOSER_PATH);
    await screen.findByRole("heading", { name: "Sell something" });
    const all = Array.from(document.querySelectorAll<HTMLElement>("[data-sell-choice]"));
    expect(all.length).toBeGreaterThan(5);
    const cards = all.filter((c) => c.querySelectorAll("span.block").length === 2);
    expect(cards).toHaveLength(3);
    for (const c of cards) {
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
    // DeclutterHomeView's Sell buttons moved into SellChooserEntry (the phone card) and TabletSellRow (B77, tab code split).
    for (const f of ["src/components/create/CreateSheet.tsx", "src/components/declutter/DeclutterBrowseView.tsx", "src/components/declutter/SellChooserEntry.tsx", "src/components/declutter/TabletSellRow.tsx", "src/components/sections/sectionsConfig.ts"]) {
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
    // Owner pick 5 (11-08): the only hand-written controls are the "More ways" text links, each in the one tertiary
    // link style (MORE_LINK), never a hand-drawn card.
    const plain = [...chooser.matchAll(/<(button|Link)\b/g)].map((m) => chooser.slice(m.index, m.index! + 220));
    expect(plain.length).toBeGreaterThan(2);
    for (const tag of plain) expect(tag).toMatch(/className=\{MORE_LINK\}/);
    expect(entry).toMatch(/const startCard = [^\n]*\n\s*<ChoiceCard\b/);
    // The card's own look lives in ChoiceCard only: the 104px olive-circle row is not drawn by hand in either flow.
    for (const src of [chooser, entry]) expect(src).not.toMatch(/inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-\[hsl\(var\(--bark\)\/0\.12\)\]/);
  });
});
