/**
 * Q2705 (lead 11-09): a MEMBER's /declutter starts its first-screen read and its first card photos from the HTML.
 * Measured before (cwv-lab, prod www, helper, chromium, Slow 4G + 4x, 375x812, median of 3, 2026-11-09,
 * ~/.lh-shots/speed-declutter/before-live-member.log): LCP 7,352 ms, the first card photo, in the browser by 1.7 s
 * (api/share.ts's Link preload) but drawn only by Browse at ~6.3 s (renderDelay 5.5 s).
 *
 * index.html's inline script naming __lhMemberDeclutterEarly fires declutter_first_screen with the stored session
 * (the entry's own read), leaves the answer for the entry (declutterPrefetch.ts takeEarlyMemberRead), and, while the
 * signed-in skeleton is on screen, draws THAT answer's first four photos (the member's own listings left out, as
 * Browse leaves them out) into the skeleton's photo slots, the first row first, with the card's own URLs. The
 * skeleton's boxes are Browse's boxes (DeclutterBrowseBones: the chips' pb-2 row of 40px chips, a 110px text block),
 * so nothing moves when Browse replaces it.
 */
// @mutate index.html |             if (typeof it.id !== "string" \|\| it.seller_id === me) continue; |             if (typeof it.id !== "string") continue;
// @mutate index.html |         if (s.expires_at - Date.now() / 1000 <= 60) return; |
// @mutate index.html |         if (location.search \|\| location.hash \|\| window.innerWidth >= 900 \|\| prefs \|\| map) return; |         if (location.hash \|\| prefs) return;
// @mutate index.html |         if (document.documentElement.getAttribute("data-lh-app-shell") !== "declutter") return;\n        var root | var root
// @mutate index.html |             (at < 2 ? row : later).push({ img: img, path: first[it.id] }); |             row.push({ img: img, path: first[it.id] });
// @mutate index.html | !== "declutter") return;\n        var root = base + "/storage/v1/render/image/public/job-photos/";\n        function url(path, px) {\n          return root + path + "?width=" + px + "&height=" + px + "&resize=cover&quality=55"; | !== "declutter") return;\n        var root = base + "/storage/v1/render/image/public/job-photos/";\n        function url(path, px) {\n          return root + path + "?width=" + px + "&quality=55";
// @mutate index.html | "declutter_shipping", "ai_support_answers", "sponsor_25days"]; | "declutter_shipping", "ai_support_answers"];
// @mutate src/boot/declutterPrefetch.ts |   if (e.userId !== userId \|\| e.keys !== FIRST_SCREEN_SWITCH_KEYS.join(",")) return null; |
// @mutate src/boot/declutterPrefetch.ts |   if (!e \|\| typeof e.at !== "number" \|\| now - e.at > EARLY_MAX_AGE_MS) return null; |   if (!e \|\| typeof e.at !== "number") return null;
// @mutate src/boot/declutterPrefetch.ts |     takeEarlyMemberRead(session.userId) ?? | (null as Promise<unknown> \| null) ??
// @mutate src/boot/declutterPrefetch.ts |       if (document.getElementById("lh-declutter-shell")?.hasAttribute("data-lh-photos")) return; |
// @mutate src/components/declutter/DeclutterSkeletons.tsx |           <div className="h-[110px] space-y-1.5 px-0.5 pt-2"> |           <div className="space-y-1.5 px-0.5 pt-2">
// @mutate src/components/declutter/DeclutterSkeletons.tsx |     <div className={CHIPS_ROW_PAD} aria-hidden data-declutter-chip-bones=""> |     <div className="pb-4" aria-hidden data-declutter-chip-bones="">
// @mutate src/components/declutter/DeclutterBrowseView.tsx |  : listLoading && !items.isError ? <DeclutterChipBones /> : null, |  : null,
// @mutate src/components/declutter/DeclutterBrowseView.tsx |     if (!listLoading) releaseDeclutterShellForCards(); |
// @mutate src/components/declutter/declutterShell.ts |   if (!el.hasAttribute("data-lh-photos")) { |   if (el) {
// @mutate src/components/declutter/declutterShell.ts | removeShellOncePainted(DECLUTTER_SHELL_ID, doc), SHELL_PHOTO_HOLD_MS); | removeShellOncePainted(DECLUTTER_SHELL_ID, doc), SHELL_PHOTO_HOLD_MS * 10);
// @mutate index.html |           document.documentElement.setAttribute("data-lh-declutter-guest", ""); |
// @mutate src/index.css |   [data-lh-declutter-guest] #lh-declutter-shell [data-lh-guest-join] {\n    display: block !important; |   [data-lh-declutter-guest] #lh-declutter-shell [data-lh-guest-join] {\n    display: none;
// @mutate src/index.css | [data-lh-declutter-guest] #lh-declutter-shell [data-lh-member-tabs] {\n  display: none !important; | [data-lh-declutter-guest] #lh-declutter-shell [data-lh-member-tabs] {\n  display: block;
// @mutate src/components/declutter/DeclutterSkeletons.tsx | {(guestJoin \|\| hasPersistedAuthToken()) && <DeclutterPhoneTabBones />} | {false && <DeclutterPhoneTabBones />}
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FEATURE_SWITCH_KEYS } from "@/config/featureSwitches";
import { DECLUTTER_PREFETCH_KEY, FIRST_SCREEN_SWITCH_KEYS, MEMBER_DECLUTTER_EARLY_KEY, firstCardPhotoPreloads, startDeclutterPrefetch, takeEarlyMemberRead } from "./declutterPrefetch";
import { DECLUTTER_GUEST_JOIN_RULE, DECLUTTER_GUEST_NO_TABS_RULE, DECLUTTER_PHOTO_MARKUP, SHELLS } from "../../scripts/inline-shell-css.mjs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { SHELL_PHOTO_HOLD_MS, releaseDeclutterShell, releaseDeclutterShellForCards } from "@/components/declutter/declutterShell";

const INDEX = readFileSync("index.html", "utf8");
const BASE = "https://x.supabase.co";
const KEY = "anon.key";
const ME = "me-uuid";

/** The one bare inline script naming the member slot (HTML comments are not part of any script). */
function memberScript(html: string): string {
  let bare = html;
  for (let at = bare.indexOf("<!--"); at !== -1; at = bare.indexOf("<!--")) {
    const close = bare.indexOf("-->", at + 4);
    bare = bare.slice(0, at) + (close === -1 ? "" : bare.slice(close + 3));
  }
  const scripts: string[] = [];
  for (let at = bare.indexOf("<script>"); at !== -1; at = bare.indexOf("<script>", at + 1)) {
    const close = bare.indexOf("</script>", at);
    if (close !== -1) scripts.push(bare.slice(at + "<script>".length, close));
  }
  const hits = scripts.filter((s) => s.includes(MEMBER_DECLUTTER_EARLY_KEY));
  expect(hits).toHaveLength(1);
  return hits[0];
}

function shellMarkup(html: string): string {
  const start = html.indexOf('<div id="lh-declutter-shell"');
  const endTag = '<span data-lh-shell="end" hidden></span></div>';
  const end = html.indexOf(endTag, start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + endTag.length);
}

// The member's OWN listing is second in the answer (the server leaves them out today; Browse leaves them out too, so
// a slot never shows one), and item "c" has no photo.
const ANSWER = {
  switches: { declutter: true },
  items: [
    { id: "a", seller_id: "s1" },
    { id: "mine", seller_id: ME },
    { id: "b", seller_id: "s2" },
    { id: "c", seller_id: "s3" },
    { id: "d", seller_id: "s4" },
    { id: "e", seller_id: "s5" },
  ],
  photos: [
    { item_id: "a", storage_path: "s1/declutter/a/1.jpg", position: 0 },
    { item_id: "a", storage_path: "s1/declutter/a/2.jpg", position: 1 },
    { item_id: "mine", storage_path: "me/declutter/mine/1.jpg", position: 0 },
    { item_id: "b", storage_path: "s2/declutter/b/1.jpg", position: 0 },
    { item_id: "d", storage_path: "s4/declutter/d/1.jpg", position: 0 },
    { item_id: "e", storage_path: "s5/declutter/e/1.jpg", position: 0 },
  ],
  more: true,
  near: null,
};

type Run = { session?: unknown; extraKeys?: string[]; items?: Record<string, string>; search?: string; width?: number; path?: string; shown?: string | null; answer?: unknown; status?: number; capacitor?: boolean };

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};
const sessionFor = (expiresInS: number, userId: string = ME) => JSON.stringify({ access_token: "tok", expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: userId } });

function setup(o: Run = {}) {
  document.head.innerHTML = `<meta name="lh-supabase-url" content="${BASE}"><meta name="lh-supabase-key" content="${KEY}">`;
  document.body.innerHTML = shellMarkup(INDEX);
  if (o.shown === null) document.documentElement.removeAttribute("data-lh-app-shell");
  else document.documentElement.setAttribute("data-lh-app-shell", o.shown ?? "declutter");
  const items: Record<string, string | null> = { ...(o.items ?? {}) };
  const keys = [...(o.extraKeys ?? [])];
  if (o.session !== null) {
    keys.unshift("sb-proj-auth-token");
    items["sb-proj-auth-token"] = typeof o.session === "string" ? o.session : sessionFor(3600);
  }
  const store = { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => items[k] ?? null };
  const win: Record<string, unknown> = { innerWidth: o.width ?? 375, ...(o.capacitor ? { Capacitor: {} } : {}) };
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchStub = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(o.answer ?? ANSWER), { status: o.status ?? 200 }));
  });
  const timers: number[] = [];
  new Function("document", "location", "localStorage", "window", "navigator", "fetch", "setTimeout", memberScript(INDEX))(
    document,
    { pathname: o.path ?? "/declutter", search: o.search ?? "", hash: "", protocol: "https:" },
    store,
    win,
    { language: "en-US" },
    fetchStub,
    (fn: () => void, ms: number) => { timers.push(ms); },
  );
  const imgs = () => [...document.querySelectorAll<HTMLImageElement>("#lh-declutter-shell ul img")];
  const tiles = () => [...document.querySelectorAll("#lh-declutter-shell ul > li")].map((li) => li.firstElementChild!);
  return { win, calls, imgs, tiles, timers };
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-lh-app-shell");
  localStorage.clear();
  for (const k of [MEMBER_DECLUTTER_EARLY_KEY, DECLUTTER_PREFETCH_KEY]) delete (window as unknown as Record<string, unknown>)[k];
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("index.html's member /declutter script (Q2705, 11-09)", () => {
  it("asks the entry's own read with the stored session and every switch key, and leaves it for the entry", async () => {
    const r = setup();
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe(`${BASE}/rest/v1/rpc/declutter_first_screen`);
    expect(r.calls[0].init?.method).toBe("POST");
    expect(r.calls[0].init?.headers).toEqual({ apikey: KEY, Authorization: "Bearer tok", "Content-Type": "application/json" });
    expect(JSON.parse(String(r.calls[0].init?.body))).toEqual({ p_switch_keys: FIRST_SCREEN_SWITCH_KEYS });
    const slot = r.win[MEMBER_DECLUTTER_EARLY_KEY] as { at: number; userId: string; keys: string; answer: Promise<unknown> };
    expect(slot.userId).toBe(ME);
    expect(slot.keys).toBe(FIRST_SCREEN_SWITCH_KEYS.join(","));
    expect(await slot.answer).toEqual(ANSWER);
  });

  it("its switch keys are FEATURE_SWITCH_KEYS exactly (so the entry's hand-over check holds)", () => {
    const list = /var keys = (\[[^\]]*\]);/.exec(memberScript(INDEX))?.[1];
    expect(JSON.parse(list ?? "null")).toEqual([...FEATURE_SWITCH_KEYS]);
    expect(FIRST_SCREEN_SWITCH_KEYS).toEqual([...FEATURE_SWITCH_KEYS]);
    expect(FEATURE_SWITCH_KEYS.length).toBeGreaterThan(20);
  });

  it("reads nothing as a guest, near expiry, with a malformed session, on another route or in the native app", () => {
    expect(setup({ session: null }).calls).toHaveLength(0);
    expect(setup({ session: sessionFor(30) }).calls).toHaveLength(0);
    expect(setup({ session: "{not json" }).calls).toHaveLength(0);
    expect(setup({ session: JSON.stringify({ access_token: "tok", expires_at: 9e9 }) }).calls).toHaveLength(0);
    expect(setup({ path: "/declutter/item/x" }).calls).toHaveLength(0);
    expect(setup({ capacitor: true }).calls).toHaveLength(0);
  });

  it("draws the answer's first four photos, never the member's own, the first row first, with the card's own URLs", async () => {
    const r = setup();
    await flush();
    const imgs = r.imgs();
    // Slots: a, b, c (no photo: keeps its bone), d. The member's own listing takes no slot.
    expect(imgs).toHaveLength(3);
    expect(imgs.some((i) => (i.getAttribute("src") ?? "").includes("/mine/"))).toBe(false);
    expect(r.tiles()[2].hasAttribute("data-skeleton")).toBe(true);
    expect(r.tiles()[0].hasAttribute("data-skeleton")).toBe(false);
    const want = firstCardPhotoPreloads(BASE, ANSWER, ME, { width: 375, height: 812 });
    expect(imgs.slice(0, 2).map((i) => [i.getAttribute("src"), i.getAttribute("srcset")])).toEqual(want.slice(0, 2).map((p) => [p.href, p.srcset]));
    expect(imgs.slice(0, 2).map((i) => i.getAttribute("fetchpriority"))).toEqual(["high", "high"]);
    // The second row waits for the first (or 3 s).
    expect(imgs[2].getAttribute("src")).toBeNull();
    expect(r.timers).toContain(3000);
    imgs[0].dispatchEvent(new Event("load"));
    expect(imgs[2].getAttribute("src")).toBeNull();
    imgs[1].dispatchEvent(new Event("error"));
    expect(imgs[2].getAttribute("src")).toBe(want.find((p) => p.href.includes("/d/"))!.href);
    expect(imgs[2].getAttribute("fetchpriority")).toBeNull();
    expect(document.getElementById("lh-declutter-shell")!.hasAttribute("data-lh-photos")).toBe(true);
  });

  it("draws nothing (but still reads) without the skeleton, off a phone, with a query, on the map, in Spanish or with a saved order", async () => {
    const cases: Run[] = [
      { shown: null },
      { shown: "home" },
      { width: 1024 },
      { search: "?tab=mine" },
      { items: { "helpr.declutterPhoneView": "map" } },
      { items: { helpr_lang: "es" } },
      { extraKeys: ["helpr_section_prefs:u"] },
    ];
    for (const o of cases) {
      const r = setup(o);
      expect(r.calls, JSON.stringify(o)).toHaveLength(1);
      await flush();
      expect(r.imgs(), JSON.stringify(o)).toHaveLength(0);
    }
  });

  it("a refused or broken answer, or a skeleton the app already removed, draws nothing", async () => {
    for (const o of [{ status: 401 }, { answer: { nope: 1 } }, { answer: { items: ANSWER.items } }] as Run[]) {
      const r = setup(o);
      await flush();
      expect(r.imgs(), JSON.stringify(o)).toHaveLength(0);
      expect(document.getElementById("lh-declutter-shell")!.hasAttribute("data-lh-photos")).toBe(false);
    }
    const gone = setup();
    document.getElementById("lh-declutter-shell")!.remove();
    await flush();
    expect(gone.imgs()).toHaveLength(0);
  });

  it("the inlined first-frame CSS covers the photos it draws", () => {
    const tmp = document.createElement("div");
    tmp.innerHTML = DECLUTTER_PHOTO_MARKUP;
    const src = memberScript(INDEX);
    expect(src).toContain(`img.className = "${tmp.querySelector("img")!.className}";`);
    expect(src).toContain(`tile.className = "${tmp.firstElementChild!.className}";`);
  });
});

describe("the entry takes the HTML's answer (declutterPrefetch.ts)", () => {
  const stub = () => {
    const f = vi.fn(() => Promise.resolve(new Response(JSON.stringify(ANSWER), { status: 200 })));
    vi.stubGlobal("fetch", f);
    vi.stubEnv("VITE_SUPABASE_URL", BASE);
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "k");
    localStorage.setItem("sb-x-auth-token", sessionFor(3600));
    return f;
  };
  const early = (o: { at?: number; userId?: string; keys?: string } = {}) => {
    (window as unknown as Record<string, unknown>)[MEMBER_DECLUTTER_EARLY_KEY] = {
      at: o.at ?? Date.now(), userId: o.userId ?? ME, keys: o.keys ?? FIRST_SCREEN_SWITCH_KEYS.join(","), answer: Promise.resolve(ANSWER),
    };
  };

  it("does not ask again while the early answer is this member's, with these keys, and fresh", async () => {
    const f = stub();
    early();
    startDeclutterPrefetch("/declutter");
    const calls = f.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(calls.filter((u) => u.includes("declutter_first_screen"))).toEqual([]);
    const slot = (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] as { answer: Promise<unknown>; userId: string };
    expect(slot.userId).toBe(ME);
    expect(await slot.answer).toEqual(ANSWER);
    expect((window as unknown as Record<string, unknown>)[MEMBER_DECLUTTER_EARLY_KEY], "taken once").toBeUndefined();
  });

  it("asks for itself when the early answer is another member's, asked with other keys, old, or absent", () => {
    for (const o of [{ userId: "someone-else" }, { keys: "declutter" }, { at: Date.now() - 60_000 }, null]) {
      const f = stub();
      if (o) early(o);
      startDeclutterPrefetch("/declutter");
      const calls = f.mock.calls.map((c) => String((c as unknown[])[0]));
      expect(calls.filter((u) => u.includes("declutter_first_screen")), JSON.stringify(o)).toHaveLength(1);
      vi.unstubAllGlobals();
    }
    expect(takeEarlyMemberRead(ME)).toBeNull();
  });

  it("does not preload the card photos again when the HTML drew them into the skeleton", async () => {
    const links = () => document.head.querySelectorAll('link[rel="preload"][as="image"]').length;
    stub();
    // Count what THIS test adds: an earlier test in the worker may have left its own preload links in <head> (#4279
    // shard 5 read eight that this test never made, 2026-11-09).
    const before = links();
    document.body.innerHTML = '<div id="lh-declutter-shell" data-lh-photos=""></div>';
    early();
    startDeclutterPrefetch("/declutter");
    await flush();
    expect(links()).toBe(before);
    document.body.innerHTML = "";
    early();
    startDeclutterPrefetch("/declutter");
    await flush();
    expect(links()).toBeGreaterThan(before);
  });
});

describe("the skeleton's boxes are Browse's (no jump when Browse replaces the drawn photos)", () => {
  it("the chips row and the card text block match Browse's measured geometry at 375", () => {
    const sk = blankComments(readFileSync("src/components/declutter/DeclutterSkeletons.tsx", "utf8"));
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    // Browse wraps its chips in a CHIPS_ROW_PAD row (owner 11-12: pb-0, was pb-2) (DeclutterCategoryChips: a pb-1 row of 40px chips); measured 11-09 at
    // 375: the explore header is 120px and the first photo row starts at 124px, the second at 420px (li 276px:
    // a 166px photo and a 110px text block).
    expect(sk).toMatch(/<div className=\{CHIPS_ROW_PAD\} aria-hidden data-declutter-chip-bones="">\s*<div className="flex gap-2 overflow-hidden pb-1">\s*(<Skeleton className="h-10 w-\d+ shrink-0 rounded-full" \/>\s*){3}<\/div>/);
    expect(sk).toContain('<div className="h-[110px] space-y-1.5 px-0.5 pt-2">');
    // The skeleton's phone tabs slot and Browse's loading chips are the same bones (the header never grows).
    // F153: a member's tab bones (SectionTabs' 44px row over its 1px rule) come first, hidden for a guest.
    expect(sk).toMatch(/\{\(guestJoin \|\| hasPersistedAuthToken\(\)\) && <DeclutterPhoneTabBones \/>\}\s*<DeclutterChipBones \/>/);
    expect(sk).toMatch(/<div className="flex items-end gap-1 border-b border-border\/60" aria-hidden data-lh-member-tabs="">\s*<div className="flex h-11 items-center/);
    expect(browse).toContain("chips: chipRow ? <div data-declutter-chips-row=\"\" className={CHIPS_ROW_PAD}>{chipRow}</div> : listLoading && !items.isError ? <DeclutterChipBones /> : null,");
    // index.html's shell is rendered from this skeleton (messagesDeclutterShellsMatchSkeletons holds it byte-equal).
    expect(INDEX).toContain('class="h-[110px] space-y-1.5 px-0.5 pt-2"');
  });

  it("a guest's copy carries Browse's sign-up line above the bones, shown only for a guest (no jump on the swap)", () => {
    const shell = shellMarkup(INDEX);
    const join = shell.indexOf('<div data-lh-guest-join="" style="display:none"><section data-guest-join="browse"');
    expect(join).toBeGreaterThan(0);
    expect(join, "above the cards").toBeLessThan(shell.indexOf('aria-label="Loading items"'));
    // The rule that shows it: inlined into the HTML by the build, and the same rule in the app's sheet.
    expect(DECLUTTER_GUEST_JOIN_RULE).toBe("@media (max-width:899px){[data-lh-declutter-guest] #lh-declutter-shell [data-lh-guest-join]{display:block!important}}");
    const decl = SHELLS.find((s: { id: string }) => s.id === "lh-declutter-shell") as { show: string };
    expect(decl.show).toContain(DECLUTTER_GUEST_JOIN_RULE);
    const sheet = readFileSync("src/index.css", "utf8");
    expect(sheet).toMatch(/@media \(max-width: 899px\) \{\s*\[data-lh-declutter-guest\] #lh-declutter-shell \[data-lh-guest-join\] \{\s*display: block !important;\s*\}/);
    // The guest script marks <html> when it shows the skeleton, and unmarks it when it takes it away.
    const guest = INDEX.slice(INDEX.indexOf("window.__lhGuestDeclutterEarly"), INDEX.indexOf("window.__lhMemberDeclutterEarly"));
    expect(guest).toContain('document.documentElement.setAttribute("data-lh-declutter-guest", "");');
    expect(guest).toContain('document.documentElement.removeAttribute("data-lh-declutter-guest");');
    expect(guest).toContain('if (slots.length) shell.setAttribute("data-lh-photos", "");');
  });

  // F153 (owner UI audit 11-09): a member's phone shows the section tabs under the search, a guest's none. The shell
  // draws the member's tab bones above the chip bones; the guest mark hides them (inlined rule + the app's sheet).
  it("a member's copy carries the tab row's bones under the search; a guest's hides them", () => {
    const shell = shellMarkup(INDEX);
    const tabs = shell.indexOf('data-lh-member-tabs=""');
    expect(tabs).toBeGreaterThan(shell.indexOf('data-testid="app-top-bar-search"'));
    expect(tabs).toBeLessThan(shell.indexOf("data-declutter-chip-bones"));
    expect(DECLUTTER_GUEST_NO_TABS_RULE).toBe("[data-lh-declutter-guest] #lh-declutter-shell [data-lh-member-tabs]{display:none!important}");
    const decl = SHELLS.find((s: { id: string }) => s.id === "lh-declutter-shell") as { show: string };
    expect(decl.show).toContain(DECLUTTER_GUEST_NO_TABS_RULE);
    const sheet = readFileSync("src/index.css", "utf8");
    expect(sheet).toMatch(/\[data-lh-declutter-guest\] #lh-declutter-shell \[data-lh-member-tabs\] \{\s*display: none !important;\s*\}/);
  });
});

describe("the skeleton with drawn photos stays until Browse's cards are painted (declutterShell.ts)", () => {
  // Every clock is fake (timers AND animation frames), so no step waits on the wall clock: a real 40 ms wait for two
  // real frames failed once under CI load (lander, l137). Two frames are well inside FRAMES.
  const FRAMES = 100;
  it("goes at once without photos; with photos it waits for the cards, at most SHELL_PHOTO_HOLD_MS", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    try {
      document.body.innerHTML = '<div id="lh-declutter-shell"></div>';
      releaseDeclutterShell();
      vi.advanceTimersByTime(FRAMES);
      expect(document.getElementById("lh-declutter-shell"), "no photos: removed once painted").toBeNull();
      document.body.innerHTML = '<div id="lh-declutter-shell" data-lh-photos=""></div>';
      releaseDeclutterShell();
      vi.advanceTimersByTime(SHELL_PHOTO_HOLD_MS - FRAMES);
      expect(document.getElementById("lh-declutter-shell"), "photos: still up before the cap").not.toBeNull();
      releaseDeclutterShellForCards();
      vi.advanceTimersByTime(FRAMES);
      expect(document.getElementById("lh-declutter-shell"), "cards painted: removed").toBeNull();
      document.body.innerHTML = '<div id="lh-declutter-shell" data-lh-photos=""></div>';
      releaseDeclutterShell();
      vi.advanceTimersByTime(SHELL_PHOTO_HOLD_MS + FRAMES);
      expect(document.getElementById("lh-declutter-shell"), "no cards: removed at the cap").toBeNull();
    } finally {
      vi.useRealTimers();
    }
    expect(SHELL_PHOTO_HOLD_MS).toBe(3000);
    const page = blankComments(readFileSync("src/pages/declutter/DeclutterPage.tsx", "utf8"));
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    expect(page).toContain("useEffect(() => releaseDeclutterShell(), []);");
    expect(browse).toMatch(/useEffect\(\(\) => \{\s*if \(!listLoading\) releaseDeclutterShellForCards\(\);\s*\}, \[listLoading\]\);/);
  });
});
