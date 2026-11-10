// @mutate supabase/functions/_shared/sponsorSignup.ts |   if (raw.agree !== true) errors.agree = "agree"; |   if (raw.agree === false) errors.agree = "agree";
// @mutate supabase/functions/_shared/sponsorSignup.ts |   else if (!anyDay && days.length === 0) errors.days = "days"; |   else if (false) errors.days = "days";
// @mutate src/lib/sponsor/placeholders.ts |   return PLACEHOLDER_RE.test(text); |   return false;
// @mutate src/components/sponsor/ClaimSection.tsx |   if (maxPerDay !== null && count >= maxPerDay) return { label: C.claim.full, full: true }; |   if (maxPerDay !== null && count > maxPerDay) return { label: C.claim.full, full: true };
// @mutate src/components/sponsor/Sections.tsx |         {greetingBrand ? ( |         {true ? (
// @mutate api/share.ts |   sponsor: SPONSOR_CARD, |   sponsorX: SPONSOR_CARD,
// @mutate supabase/functions/_shared/sponsorSignup.ts |   return nowMs < closesAt; |   return true;
// @mutate src/components/sponsor/ClaimSection.tsx |   shipTo: "helpr", notes: "", |   shipTo: "", notes: "",
// @mutate supabase/functions/_shared/sponsorSignup.ts |     // Not given: stays null (sponsor_signups.prize_value is nullable since 20261110171648). |     errors.prizeValue = "required";
// @mutate supabase/functions/_shared/email-templates/sponsor-25days.tsx |       <Detail label="Your prize">{s.prizeDescription}</Detail> |       <Detail label="Your prize">{s.prizeDescription} (about ${s.prizeValue})</Detail>
// @mutate supabase/functions/_shared/email-templates/sponsor-25days.tsx |       {s.prizeValue != null ? <Detail label="Prize value">${s.prizeValue}</Detail> : null} |       <Detail label="Prize value">${s.prizeValue}</Detail>
// @mutate src/pages/admin/sponsors/AdminSponsorsPage.tsx | (v == null ? "—" : `$${v}`) | `$${v}`
/**
 * 25 Days of Louisiana Giveaways (owner spec 2026-11-09): the page-side rules.
 *  - the sign-up validator the page AND the sponsor-25days function run;
 *  - "hidden until filled": nothing holding a [placeholder] reaches a visitor;
 *  - the ref greeting comes only from the server's match, never from the URL text;
 *  - the per-day cap shows "Full" and the tile cannot be picked;
 *  - feature cards link only to routes that exist and are open to everyone;
 *  - the rules page is a DRAFT until approved with no placeholder left;
 *  - CSV export cannot smuggle a spreadsheet formula; the calendar file holds one event per day.
 * The server half (cap under a lock, anon cannot read sign-ups, the switch) is
 * src/test/pglite/sponsor25days.pglite.mjs.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { sponsorPage } from "@/content/sponsorPage";
import { SPONSOR_SIGNUP_DEADLINE, checkLogo, cleanDays, normalizeRef, slugifyBrand, sniffLogoType, sponsorSignupsOpen, validateSponsorSignup } from "../../supabase/functions/_shared/sponsorSignup";
import { filledUrl, hasPlaceholder, onlyFilled, statNumber } from "@/lib/sponsor/placeholders";
import { buildIcs, countdown, dayStartUtc, daysLabel } from "@/lib/sponsor/dates";
import { About, BrandGets, Faq, Footer, Founder, Hero, Reach, filledStats } from "@/components/sponsor/Sections";
import { ClaimSection, EMPTY as EMPTY_SIGNUP, dayTileLabel, errorMessage } from "@/components/sponsor/ClaimSection";
import { rulesAreDraft } from "@/pages/sponsor/SponsorRulesPage";
import { prizeValueLabel, signupsCsv } from "@/pages/admin/sponsors/AdminSponsorsPage";
import type { SponsorAdminSignup, SponsorPublicState } from "@/lib/sponsor/types";

const ROOT = path.resolve(__dirname, "../..");
const good = {
  brandName: "Cajun Candle Co", contactName: "Ann", email: "Ann@Example.com", prizeDescription: "Candle trio",
  prizeValue: "$60", days: [12, 3, 3], anyDay: false, agree: true, showOnWall: true, ref: "Cajun-Candle-Co",
};

describe("sign-up validator (page and server)", () => {
  it("accepts a good sign-up and cleans it", () => {
    const v = validateSponsorSignup(good);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.email).toBe("ann@example.com");
    expect(v.value.days).toEqual([3, 12]);
    expect(v.value.prizeValue).toBe(60);
    expect(v.value.ref).toBe("cajun-candle-co");
  });
  it("requires brand, contact, email, prize, a day and the agreement (not a value: owner 11-10)", () => {
    const v = validateSponsorSignup({});
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toMatchObject({ brandName: "required", contactName: "required", email: "required", prizeDescription: "required", days: "days", agree: "agree" });
    expect(v.errors.prizeValue).toBeUndefined();
  });
  it("the prize value is optional: absent or blank is null; a value given is still checked", () => {
    const noValue: Record<string, unknown> = { ...good };
    delete noValue.prizeValue;
    const absent = validateSponsorSignup(noValue);
    expect(absent.ok && absent.value.prizeValue).toBeNull();
    const blank = validateSponsorSignup({ ...good, prizeValue: "  " });
    expect(blank.ok && blank.value.prizeValue).toBeNull();
    const zero = validateSponsorSignup({ ...good, prizeValue: "0" });
    expect(!zero.ok && zero.errors.prizeValue).toBe("prizeValue");
  });
  it("refuses a bad email, a non-number value, days outside 1-25 and an unchecked agreement", () => {
    const v = validateSponsorSignup({ ...good, email: "not an email", prizeValue: "lots", days: [26], agree: false });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.errors).toMatchObject({ email: "email", prizeValue: "prizeValue", days: "days", agree: "agree" });
  });
  it("'Any day is fine' with no day picked is valid; with days picked the days win", () => {
    const any = validateSponsorSignup({ ...good, days: [], anyDay: true });
    expect(any.ok && any.value.anyDay).toBe(true);
    const both = validateSponsorSignup({ ...good, days: [5], anyDay: true });
    expect(both.ok && both.value.anyDay).toBe(false);
  });
  it("normalises a website and refuses a non-web one", () => {
    const v = validateSponsorSignup({ ...good, website: "cajuncandle.com" });
    expect(v.ok && v.value.website).toBe("https://cajuncandle.com/");
    const bad = validateSponsorSignup({ ...good, website: "javascript:alert(1)" });
    expect(bad.ok).toBe(false);
  });
  it("strips newlines from one-line fields (no header injection)", () => {
    const v = validateSponsorSignup({ ...good, brandName: "Evil\r\nBcc: x@y.z" });
    expect(v.ok && v.value.brandName).toBe("Evil Bcc: x@y.z");
  });
  it("ref codes, days and slugs", () => {
    expect(normalizeRef("<script>")).toBeNull();
    expect(normalizeRef(" Cajun-Candle-Co ")).toBe("cajun-candle-co");
    expect(cleanDays(["3", 3, 7])).toEqual([3, 7]);
    expect(cleanDays([0])).toBeNull();
    expect(slugifyBrand("Café & Co.")).toBe("cafe-and-co");
  });
  it("logos: PNG/JPG/SVG up to 5 MB, decided by the bytes", () => {
    expect(checkLogo("image/png", 1000)).toBeNull();
    expect(checkLogo("image/gif", 1000)).toBe("logoType");
    expect(checkLogo("image/png", 5 * 1024 * 1024 + 1)).toBe("logoSize");
    expect(sniffLogoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffLogoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffLogoType(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("image/svg+xml");
    expect(sniffLogoType(new TextEncoder().encode("<html><script>alert(1)</script>"))).toBeNull();
    // Comments and a doctype before <svg> (Illustrator exports), and the CodeQL js/redos input answered fast and null.
    expect(sniffLogoType(new TextEncoder().encode('<?xml version="1.0"?>\n<!-- Generator: Illustrator --> <!--x--><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"><svg viewBox="0 0 1 1"></svg>'))).toBe("image/svg+xml");
    expect(sniffLogoType(new TextEncoder().encode("<!--x--><html><svg></svg>"))).toBeNull();
    const t0 = Date.now();
    expect(sniffLogoType(new TextEncoder().encode("<!--" + "--><!--".repeat(140)))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(500); // the old regex took ~114 ms at 24 repeats and hangs at 140
  });
  it("every validator code has a message", () => {
    for (const c of ["required", "email", "days", "agree", "url", "logoType", "logoSize", "tooLong"]) {
      expect(errorMessage(c)).toBeTruthy();
    }
  });
});

describe("hidden until filled", () => {
  it("placeholder helpers", () => {
    expect(hasPlaceholder("[X]")).toBe(true);
    expect(hasPlaceholder("Real text")).toBe(false);
    expect(hasPlaceholder("")).toBe(true);
    expect(filledUrl(sponsorPage.links.facebookGroup)).toBeNull();
    expect(filledUrl("https://www.facebook.com/groups/123")).toBe("https://www.facebook.com/groups/123");
    expect(statNumber(null, "[X]")).toBeNull();
    expect(statNumber(null, "1,234")).toBe(1234);
    expect(statNumber(500, "[X]")).toBe(500);
    expect(onlyFilled([{ t: "[a]" }, { t: "b" }], (i) => [i.t])).toEqual([{ t: "b" }]);
  });

  it("the content file still has the owner's open placeholders (inventory)", () => {
    const text = JSON.stringify(sponsorPage);
    const found = text.match(/\[[^\]]*\]/g) ?? [];
    expect(found.length).toBeGreaterThan(5);
  });

  it("no rendered section shows a [placeholder] to a visitor", () => {
    const { container } = render(
      <MemoryRouter>
        <About />
        <Founder photoUrl={null} />
        <BrandGets />
        <Reach stats={{}} />
        <Faq />
        <Footer />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\[[^\]]*\]/);
    // The Facebook GROUP url is unknown: its button and footer link are hidden, the PAGE link shows.
    expect(screen.queryByText(sponsorPage.about.groupButton)).toBeNull();
    expect(screen.getByText(sponsorPage.about.pageButton)).toBeTruthy();
    // Founder: the bracketed sentences are hidden, the filled ones show; no empty photo frame.
    expect(text).toContain("I live right here in Delcambre");
    expect(text).not.toContain("I started Louisiana Helpr because");
    expect(container.querySelector(".lh25-founder-photo")).toBeNull();
    // FAQ: the eligibility answer is a placeholder, so its question is hidden.
    expect(text).not.toContain("Who can enter the giveaways?");
    expect(text).toContain("Is this really free?");
    // Reach: no stats filled -> no section.
    expect(text).not.toContain(sponsorPage.reach.title);
  });

  it("stats: the admin's number wins, a blank stat is hidden", () => {
    expect(filledStats({ group_members: 1200, page_followers: null })).toEqual([{ key: "group_members", value: 1200, label: "group members" }]);
  });
});

describe("ref greeting", () => {
  it("greets by the brand name the server matched", () => {
    render(<MemoryRouter><Hero greetingBrand="Cajun Candle Co" /></MemoryRouter>);
    expect(screen.getByTestId("sponsor-greeting").textContent).toBe("Hey Cajun Candle Co! 🎄 We'd love to have you.");
  });
  it("no match -> no greeting (the URL's ref text is never shown)", () => {
    render(<MemoryRouter><Hero greetingBrand={null} /></MemoryRouter>);
    expect(screen.queryByTestId("sponsor-greeting")).toBeNull();
  });
  it("pre-fills the form's brand name from the match only", () => {
    const st: SponsorPublicState = { on: true, greetingBrand: "Cajun Candle Co", dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    render(<ClaimSection state={st} greetingBrand="Cajun Candle Co" refCode="cajun-candle-co" onSubmit={async () => ({ ok: false, kind: "error" })} />);
    expect((screen.getByLabelText(sponsorPage.claim.form.brandName) as HTMLInputElement).value).toBe("Cajun Candle Co");
  });
});

describe("prizes ship to Louisiana Helpr (owner 11-09)", () => {
  it("the form shows the shipping address, asks no ship-to question, and sends ship_to helpr", async () => {
    const st: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    render(<ClaimSection state={st} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    expect(screen.getByTestId("sponsor-ship-address").textContent).toContain("314 Lynn Street, Delcambre, LA 70528");
    expect(document.querySelector('input[name="shipTo"]')).toBeNull();
    expect(screen.queryByText("The winner directly")).toBeNull();
    expect(EMPTY_SIGNUP.shipTo).toBe("helpr");
  });
  it("the confirmation email says where to ship", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/_shared/email-templates/sponsor-25days.tsx"), "utf8");
    const conf = src.slice(src.indexOf("export const SponsorConfirmationEmail"), src.indexOf("export const SponsorAdminEmail"));
    expect(conf).toContain("Ship your prize to");
    expect(conf).toContain("{SHIP_ADDRESS}");
    expect(src).toContain("314 Lynn Street, Delcambre, LA 70528");
  });
});

describe("no prize value question (owner 11-10: \"I don't like asking the approximate value of the gift\")", () => {
  it("the form has no prize value field and the blank form sends none", () => {
    const st: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    render(<ClaimSection state={st} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    expect(document.querySelector('input[name="brandName"]')).not.toBeNull(); // the form did render
    expect(document.querySelector('input[name="prizeValue"]')).toBeNull();
    expect(screen.queryByText(/prize value/i)).toBeNull();
    expect("prizeValue" in EMPTY_SIGNUP).toBe(false);
    expect(JSON.stringify(sponsorPage)).not.toMatch(/prize value|dollar amount/i);
  });
  it("the confirmation email names the prize without a value; the admin email shows one only when given", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../supabase/functions/_shared/email-templates/sponsor-25days.tsx"), "utf8");
    const conf = src.slice(src.indexOf("export const SponsorConfirmationEmail"), src.indexOf("export const SponsorAdminEmail"));
    expect(conf).toContain('<Detail label="Your prize">{s.prizeDescription}</Detail>');
    expect(conf).not.toContain("prizeValue");
    const adm = src.slice(src.indexOf("export const SponsorAdminEmail"));
    expect(adm).toMatch(/\{s\.prizeValue != null \? <Detail label="Prize value">/);
  });
  it("the admin page shows a dash for no value, and the CSV leaves the cell blank", () => {
    expect(prizeValueLabel(null)).toBe("—");
    expect(prizeValueLabel(60)).toBe("$60");
    const row = {
      id: "1", created_at: "2026-11-10", brand_name: "B", contact_name: "C", email: "a@b.co", phone: null, website: null,
      instagram: null, facebook: null, tiktok: null, prize_description: "P", prize_value: null, ship_to: "helpr", notes: null,
      any_day: true, status: "pending", show_on_wall: false, wall_ok: false, logo_path: null, ref_code: null, source: "form", days: [],
    } satisfies SponsorAdminSignup;
    const [head, line] = signupsCsv([row]).split("\r\n");
    const col = head.split(",").indexOf("Prize value ($)");
    expect(col).toBeGreaterThan(0);
    expect(line.split(",")[col]).toBe("");
  });
});

describe("per-day cap", () => {
  it("labels", () => {
    expect(dayTileLabel(0, null).label).toBe("Open");
    expect(dayTileLabel(1, null).label).toBe("1 brand joined");
    expect(dayTileLabel(3, null).label).toBe("3 brands joined");
    expect(dayTileLabel(1, 1)).toEqual({ label: "Full", full: true });
    expect(dayTileLabel(0, 1).full).toBe(false);
  });
  it("a full day's tile is disabled and says Full; counts never name a brand", () => {
    const st: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: { 3: 1, 7: 2 }, maxPerDay: 1, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    render(<ClaimSection state={st} greetingBrand={null} refCode={null} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    const day3 = screen.getByRole("button", { name: /^December 3,/ }) as HTMLButtonElement;
    expect(day3.disabled).toBe(true);
    expect(day3.textContent).toContain("Full");
    const day4 = screen.getByRole("button", { name: /^December 4,/ }) as HTMLButtonElement;
    expect(day4.disabled).toBe(false);
  });
});

describe("links and rules", () => {
  it("feature cards link only to routes that exist and are public; the rest say Coming soon", () => {
    const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
    for (const f of sponsorPage.about.features) {
      if (f.href) {
        expect(app).toContain(`path="${f.href}"`);
        expect(["/jobs", "/declutter"]).toContain(f.href);
      } else {
        expect(f.soonLabel).toBe("Coming soon");
      }
    }
  });
  it("the rules page stays a DRAFT until approved with no placeholder left", () => {
    expect(rulesAreDraft(sponsorPage.rules)).toBe(true);
    expect(rulesAreDraft({ approved: true, sections: [{ heading: "A", body: "Open to [state] residents" }] })).toBe(true);
    expect(rulesAreDraft({ approved: true, sections: [{ heading: "A", body: "Open to Louisiana residents" }] })).toBe(false);
    // The content file may only be approved once every placeholder in the rules is filled.
    if (sponsorPage.rules.approved) {
      expect(sponsorPage.rules.sections.some((s) => hasPlaceholder(s.body))).toBe(false);
    }
  });
});

describe("dates, calendar file and CSV", () => {
  it("countdown runs to midnight Dec 1 Louisiana time, then counts the day", () => {
    expect(new Date(dayStartUtc(1)).toISOString()).toBe("2026-12-01T06:00:00.000Z");
    const c = countdown(Date.UTC(2026, 10, 30, 6, 0, 0));
    expect(c).toMatchObject({ phase: "before", days: 1, hours: 0, minutes: 0, seconds: 0 });
    expect(countdown(Date.UTC(2026, 11, 3, 12)).liveDay).toBe(3);
    expect(countdown(Date.UTC(2026, 11, 26, 7)).phase).toBe("over");
  });
  it("the .ics has one all-day event per picked day", () => {
    const ics = buildIcs({ brand: "Cajun, Co", days: [12, 3], anyDay: false, nowMs: 0 });
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261203");
    expect(ics).toContain("DTEND;VALUE=DATE:20261213");
    expect(ics).toContain("Cajun\\, Co");
    expect(daysLabel([12, 3, 7])).toBe("December 3, 7 and 12");
  });
  it("CSV export escapes quotes and blocks spreadsheet formulas", () => {
    const row = {
      id: "1", created_at: "2026-11-09", brand_name: '=HYPERLINK("x")', contact_name: "A, B", email: "a@b.co", phone: null, website: null,
      instagram: null, facebook: null, tiktok: null, prize_description: 'Say "hi"', prize_value: 5, ship_to: "helpr", notes: "+1",
      any_day: false, status: "confirmed", show_on_wall: true, wall_ok: true, logo_path: null, ref_code: null, source: "form", days: [3, 12],
    } satisfies SponsorAdminSignup;
    const csv = signupsCsv([row]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"A, B"');
    expect(csv).toContain("'+1");
    expect(csv).toContain("3 12");
    expect(csv.split("\r\n")[0]).toContain("Prize value ($)");
  });
});

describe("sign-up deadline (owner 2026-11-09: claim your day by Nov 30)", () => {
  it("the content file and the server agree on the date", () => {
    expect(sponsorPage.event.signup_deadline).toBe(SPONSOR_SIGNUP_DEADLINE);
  });
  it("open through Nov 30 in Louisiana, closed from midnight Dec 1 (06:00 UTC)", () => {
    expect(sponsorSignupsOpen(Date.UTC(2026, 11, 1, 5, 59, 59))).toBe(true);
    expect(sponsorSignupsOpen(Date.UTC(2026, 11, 1, 6, 0, 0))).toBe(false);
    expect(sponsorSignupsOpen(Date.UTC(2026, 10, 9))).toBe(true);
    expect(sponsorSignupsOpen(0, "not a date")).toBe(false);
  });
  it("after the deadline the form is gone and says sign-ups are closed; before it, the deadline line shows", () => {
    const st: SponsorPublicState = { on: true, greetingBrand: null, dayCounts: {}, maxPerDay: null, wall: [], testimonials: [], stats: {}, hasFounderPhoto: false };
    const closed = render(<ClaimSection state={st} greetingBrand={null} refCode={null} nowMs={Date.UTC(2026, 11, 2)} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    expect(closed.getByTestId("sponsor-closed").textContent).toContain(sponsorPage.claim.closedTitle);
    expect(closed.container.querySelector("form")).toBeNull();
    closed.unmount();
    const open = render(<ClaimSection state={st} greetingBrand={null} refCode={null} nowMs={Date.UTC(2026, 10, 20)} onSubmit={async () => ({ ok: false, kind: "error" })} />);
    expect(open.container.querySelector("form")).not.toBeNull();
    expect(open.container.textContent).toContain(sponsorPage.claim.deadline);
  });
});

describe("link preview (api/share.ts, before JavaScript runs)", () => {
  it.each(["sponsor", "25days", "25days/rules"])("%s: its own 1200x630 card, its own title, not indexed", async (id) => {
    const { ensureOgShellSnapshot } = await import("./helpers/ogShellSnapshot");
    ensureOgShellSnapshot(path.resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
    const html = await (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=noindex&_id=${id}`))).text();
    const first = html.indexOf('<meta property="og:image" ');
    const block = html.slice(first, html.indexOf('<meta property="og:image" ', first + 1));
    expect(block).toContain('<meta property="og:image" content="https://www.louisianahelpr.com/og-25days.png?v=1"');
    expect(block).toContain('<meta property="og:image:width" content="1200"');
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    expect(html).toContain("25 Days of Louisiana Giveaways");
    const png = fs.readFileSync(path.join(ROOT, "public/og-25days.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
  it("vercel.json routes the three paths through the preview function", () => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")) as { rewrites: Array<{ source: string; destination: string }> };
    for (const [src, id] of [["/sponsor", "sponsor"], ["/25days", "25days"], ["/25days/rules", "25days/rules"]]) {
      expect(v.rewrites.find((r) => r.source === src)?.destination).toBe(`/api/share?_og=noindex&_id=${id}`);
    }
  });
});

// The admin logo download and founder photo upload call the sponsor-25days function with the admin's own token.
// ed23308500 dropped the helper they import (a missing named import is undefined at runtime, so both buttons threw).
// @mutate src/pages/admin/sponsors/sponsorAdminApi.ts | headers: await authHeaders() }); | headers: {} });
describe("25 Days admin: function calls carry the admin token", () => {
  it("logo download sends Authorization: Bearer <session token>", async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { sponsorAdminBackend } = await import("@/pages/admin/sponsors/sponsorAdminApi");
    const sessionSpy = vi.spyOn(supabase.auth, "getSession").mockResolvedValue({ data: { session: { access_token: "admin-tok" } }, error: null } as never);
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response("x", { status: 200 }); // a string body: jsdom's Blob has no .stream() for Node's Response (CI)
    });
    const urlSpy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:logo");
    try {
      const b = await sponsorAdminBackend();
      expect(await b.logoDownloadUrl("sig-1")).toBe("blob:logo");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toContain("/functions/v1/sponsor-25days?logo=sig-1&admin=1");
      expect(calls[0].headers.Authorization).toBe("Bearer admin-tok");
    } finally {
      sessionSpy.mockRestore();
      fetchSpy.mockRestore();
      urlSpy.mockRestore();
    }
  });
});
