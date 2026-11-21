/**
 * Design audit areas 11-18, Area 01 (landing and guest pages), ~/.lh-shots/design-audit-areas/01-landing/FINDINGS.md.
 * One guard per finding fixed here; #2-#4, #13, #14 are on fix/sponsor-r2-followup-1118 and #15 is the owner's call.
 *
 * #1  guest pages in Spanish: Not found, the job's not-found cards, the guest job facts, the password meter, Log in's
 *     notices, Find a Helpr, the town page heading, Contact support's picker, the public header's Jobs.
 * #5  "New Orleans" is Orleans Parish on the guest job sheet; a town with no single parish is labelled "Area".
 * #6  the landing search pill and its Jobs / Declutter switch have a 1px edge.
 * #7  the landing job card's date never breaks inside itself.
 * #8  the Spanish How it works tabs are short enough for 390px.
 * #9  /fees names Declutter's buyer's fee from money.ts; /safety has a Declutter line.
 * #10 Help's Common problems has a Declutter tile and a selected look.
 * #11 a signed-out visitor on a dead shop link is not sent to the login-walled Browse shops (shopUnavailable.test.tsx).
 * #12 the desktop footer's link rows are 32px with a mouse.
 * #16 Log in's "New here? Create an account" line is 14px.
 * #17 the one-reminder line sits under Email (uiAudit1109WebLows.test.ts F026).
 * #18 Reset password's no-link sentence has no em dash.
 * #19 the job's not-found card is the 404's card.
 * #20 every not-found says "Go home" and its tab says "Not found — Helpr".
 * #21 Help's empty search has curly quotes; the "Still stuck?" footer is a light tint with a hairline.
 * #22 Contact support: olive topic highlight, no repeated intro, a plain placeholder.
 * #23 legal tab labels and the Updated date are 13px; the privacy shield is a plain icon.
 * #25 the landing close's four links sit 2 x 2 on a phone (no orphan "Sell something").
 * #26 the header H has no drop-shadow halo in light mode.
 *
 * Red before (2026-11-18, origin/main ba8f615db9): every case below failed except the inventories.
 *
 * @mutate src/pages/info/NotFound.tsx |     title: w("pub.nf.title", "Page not found"), |     title: "Page not found",
 * @mutate src/pages/auth/loginNotice.ts |   for (const [english, key] of NOTICE_KEYS) if (out.includes(english)) out = out.replace(english, wordInLang(key, english)); |   void NOTICE_KEYS;
 * @mutate src/components/auth/PasswordStrengthMeter.tsx |         {score > 0 ? wordInLang(`pub.pw.${score}`, label) : label} |         {label}
 * @mutate src/components/dashboard/GuestJobPreview.tsx |               <dt className="text-muted-foreground">{guestFactLabel(f.label)}</dt> |               <dt className="text-muted-foreground">{f.label}</dt>
 * @mutate src/lib/parishes.ts |   return parishForCity(town) ?? BY_PRIMARY_CITY_LOWER.get(town.trim().toLowerCase()) ?? null; |   return parishForCity(town);
 * @mutate src/index.css |   border: 1px solid hsl(var(--input));\n} |   border: 0;\n}
 * @mutate src/index.css | .helpr-emblem {\n  filter: none;\n} | .helpr-emblem {\n  filter: drop-shadow(0 1px 1px rgba(46, 47, 34, 0.18));\n}
 * @mutate src/components/landing/LiveJobsSection.tsx | {date && <span className="whitespace-nowrap" data-live-job-date="">{date}</span>} | {date}
 * @mutate src/lib/i18n/esLanding.ts |   "landing.how.side.sell": "Compra y venta", |   "landing.how.side.sell": "Comprar o vender",
 * @mutate src/pages/info/Fees.tsx |           {t("fees.declutter", { pct: DECLUTTER_BUYER_FEE_PERCENT, cents: DECLUTTER_BUYER_FEE_FIXED_CENTS })} |           {null}
 * @mutate src/pages/info/Safety.tsx |         <li className={INFO_CARD_ROW} data-safety-declutter="">{t("safety.declutter")}</li> |
 * @mutate src/pages/info/HelpCenter.tsx | ${open ? "border-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.08)]" : "border-border bg-card"} | ${open ? "border-[hsl(var(--bark)/0.45)] bg-card" : "border-border bg-card"}
 * @mutate src/components/Footer.tsx | const FOOTER_LINK = "link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8"; | const FOOTER_LINK = "link-standard inline-flex items-center min-h-11";
 * @mutate src/pages/auth/Login.tsx | <p className="text-center text-ds-14 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-login-new-here=""> | <p className="text-center text-ds-12 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-login-new-here="">
 * @mutate src/pages/auth/ResetPassword.tsx | "Open the reset link from your email, or request a new one." | "To set a new password, use the reset link from your email — or request one below."
 * @mutate src/pages/jobs/JobDetail.tsx |             <div className="mx-auto w-full max-w-[440px] flex" data-job-not-found="login"> |             <div className="flex" data-job-not-found="login">
 * @mutate src/pages/u/PublicProfilePage.tsx | <Link to={user ? "/home" : "/"}>Go home</Link> | <Link to={user ? "/home" : "/"}>Go to Louisiana Helpr</Link>
 * @mutate src/pages/info/HelpCenter.tsx | No answers match &ldquo;{query.trim()}&rdquo;. | No answers match "{query.trim()}".
 * @mutate src/pages/info/legal/LegalChrome.tsx |         : "rounded-[20px] border border-border bg-muted/40 px-4 py-3 flex items-center justify-between gap-3" |         : "rounded-[20px] bg-muted px-4 py-3 flex items-center justify-between gap-3"
 * @mutate src/lib/supportTopics.ts |     messagePlaceholder: "Tell us what happened.", |     messagePlaceholder: "How can our team help you today?",
 * @mutate src/pages/info/legal/LegalTabBar.tsx | rounded-full text-ds-13 font-sans | rounded-full text-ds-11 sm:text-ds-13 font-sans
 * @mutate src/components/landing/SectionsShowcase.tsx | className="grid grid-cols-2 justify-items-center sm:flex | className="flex
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { blankComments } from "./helpers/blankNonCode";

vi.mock("@/hooks/useIdCheckOnForViewer", () => ({ useIdCheckOnForViewer: () => true }));
vi.mock("@/lib/useIdCheckOnForViewer", () => ({ useIdCheckOnForViewer: () => true }));
vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

import { notFoundCopy } from "@/pages/info/NotFound";
import { gatedPageNotice, loginNotice, loginNoticeInLang } from "@/pages/auth/loginNotice";
import { PasswordStrengthMeter } from "@/components/auth/PasswordStrengthMeter";
import { guestFactLabel, guestJobArea, guestJobFacts, type GuestJob } from "@/components/dashboard/GuestJobPreview";
import { parishForTown } from "@/lib/parishes";
import { enPublic } from "@/lib/i18n/enPublic";
import { esPublic } from "@/lib/i18n/esPublic";
import { esLanding } from "@/lib/i18n/esLanding";
import { enLanding } from "@/lib/i18n/enLanding";
import { setLang, ensureLangLoaded, __resetLangForTests } from "@/lib/i18n/language";
import { DECLUTTER_BUYER_FEE_FIXED_CENTS, DECLUTTER_BUYER_FEE_PERCENT, DECLUTTER_BUYER_FEE_WORDS } from "@/lib/declutter/money";
import { COMMON_PROBLEMS } from "@/pages/info/helpCenter/helpCenterContent";
import { SUPPORT_TOPICS } from "@/lib/supportTopics";
import Fees from "@/pages/info/Fees";
import Safety from "@/pages/info/Safety";

const ROOT = resolve(import.meta.dirname, "../..");
const src = (f: string) => blankComments(readFileSync(resolve(ROOT, f), "utf8"));
const raw = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

const spanish = async () => {
  setLang("es");
  await act(async () => { await ensureLangLoaded(); });
};

beforeEach(() => { __resetLangForTests(); window.localStorage.clear(); });
afterEach(() => { cleanup(); __resetLangForTests(); window.localStorage.clear(); });

describe("#1 guest pages speak Spanish", () => {
  it("every new public word has its Spanish, and no Spanish is the English left in place", () => {
    const keys = Object.keys(enPublic).filter((k) => k.startsWith("pub.") || k.startsWith("ln."));
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      const es = esPublic[k as keyof typeof esPublic];
      expect(es, k).toBeTruthy();
      expect(es, k).not.toBe(enPublic[k as keyof typeof enPublic]);
    }
  });

  it("English readers see exactly the old words", () => {
    expect(notFoundCopy("/nope")).toEqual({ title: "Page not found", body: "This page doesn't exist or has moved. The link may be old.", primary: "Go home", primaryTo: "/" });
    const n = gatedPageNotice("/post-job")!;
    expect(loginNoticeInLang(n)).toBe(n);
    expect(guestFactLabel("Parish")).toBe("Parish");
  });

  it("Not found, the guest job facts and the password meter in Spanish", async () => {
    await spanish();
    expect(notFoundCopy("/nope").title).toBe(esPublic["pub.nf.title"]);
    expect(notFoundCopy("/nope").primary).toBe(esPublic["pub.goHome"]);
    expect(notFoundCopy("/messages/abc").primary).toBe(esPublic["pub.nf.msgPrimary"]);
    expect(guestFactLabel("You'd earn after fees")).toBe(esPublic["pub.fact.earn"]);
    expect(guestFactLabel("Area")).toBe(esPublic["pub.fact.Area"]);
    render(<PasswordStrengthMeter password="Abcdefgh1!xyz" />);
    expect(screen.getByTestId("password-strength").textContent).toBe(esPublic["pub.pw.4"]);
  });

  it("every Log in notice a guest can get is wholly Spanish (no English sentence left)", async () => {
    await spanish();
    const redirects = ["/post-job", "/tips", "/shops", "/jobs", "/profile", "/home", "/payment-success", "/complete-profile", "/messages/x",
      `/jobs/${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, "/declutter/item/1", "/declutter/sell", "/declutter/settings", "/declutter/move",
      "/declutter?tab=buying", "/declutter?tab=selling", "/declutter", "/somewhere-else"];
    const base = { oauthError: null, connect: null, signedOutForInactivity: false, sessionLost: false, hadSessionHere: false, arrivedFromSignup: false, bouncedFromGatedRoute: true };
    const notices = [
      ...redirects.map((redirect) => loginNotice({ ...base, redirect }).notice!),
      loginNotice({ ...base, bouncedFromGatedRoute: false, sessionLost: true }).notice!,
      loginNotice({ ...base, bouncedFromGatedRoute: false, signedOutForInactivity: true }).notice!,
      loginNotice({ ...base, bouncedFromGatedRoute: false, arrivedFromSignup: true }).notice!,
    ];
    expect(notices.length).toBeGreaterThan(20);
    for (const n of notices) {
      const es = loginNoticeInLang(n);
      expect(es, n).not.toBe(n);
      for (const v of Object.entries(enPublic).filter(([k]) => k.startsWith("ln.")).map(([, e]) => e)) expect(es, n).not.toContain(v);
    }
  });

  it("the guest pages draw their words through wordInLang", () => {
    expect(src("src/components/Navbar.tsx")).toContain('{navWord("footer.jobs", "Jobs")}');
    expect(src("src/pages/jobs/JobDetail.tsx")).toContain(`w("pub.job.notOpenTitle", "This job isn't open anymore")`);
    expect(src("src/pages/helprs/FindHelprs.tsx")).toContain('{w("pub.helprs.town", "Town or parish")}');
    expect(src("src/pages/info/HireTownPage.tsx")).toContain('wordInLang("pub.town.moreNear", "More near you")');
    expect(src("src/pages/info/support/SupportFormParts.tsx")).toContain('wordInLang("pub.support.chooseTopic", "Choose a topic")');
    expect(src("src/pages/auth/Login.tsx")).toContain("{loginNoticeInLang(notice)}");
  });
});

describe("#5 the guest job sheet names the real parish", () => {
  const JOB = { id: "j", title: "Mow", category: "yard_work", location: "New Orleans, LA", budget: null, date_needed: null, start_time: null } as unknown as GuestJob;
  it("New Orleans, Baton Rouge and Metairie name their parishes; an unknown town is an Area", () => {
    expect(guestJobArea("New Orleans, LA")).toBe("Orleans Parish");
    expect(guestJobArea("Baton Rouge, LA")).toBe("East Baton Rouge Parish");
    expect(guestJobArea("Metairie, LA")).toBe("Jefferson Parish");
    expect(parishForTown("Nowhere Special")).toBeNull();
    expect(guestJobFacts(JOB).find((f) => f.label === "Parish")?.value).toBe("Orleans Parish");
    expect(guestJobFacts({ ...JOB, location: "Nowhere Special, LA" }).find((f) => f.value === "Nowhere Special")?.label).toBe("Area");
  });
});

describe("landing", () => {
  const css = raw("src/index.css");
  it("#6 the search pill has a 1px edge (its Jobs | Declutter switch is gone, owner 11-18)", () => {
    expect(/\.landing-search \{[^}]*border: 1px solid hsl\(var\(--input\)\);/.test(css)).toBe(true);
    expect(css).not.toContain(".landing-search-tabs");
    expect(src("src/components/landing/HeroSection.tsx")).not.toContain("landing-search-tabs");
  });
  it("#26 the header H has no drop-shadow in light mode", () => {
    const rule = /\n\.helpr-emblem \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("filter: none");
    expect(rule).not.toContain("drop-shadow");
  });
  it("#7 the card's date is one unbreakable run", () => {
    expect(src("src/components/landing/LiveJobsSection.tsx")).toContain('<span className="whitespace-nowrap" data-live-job-date="">{date}</span>');
  });
  it("#8 the Spanish tabs are no longer than the English by more than 3 letters", () => {
    for (const side of ["hire", "work", "sell"] as const) {
      const k = `landing.how.side.${side}` as const;
      expect(esLanding[k].length, k).toBeLessThanOrEqual(enLanding[k].length + 3);
    }
  });
  it("#25 the close's four links are a 2 x 2 grid on a phone", () => {
    const s = src("src/components/landing/SectionsShowcase.tsx");
    expect(s).toMatch(/className="grid grid-cols-2 justify-items-center sm:flex[^"]*" data-testid="landing-join-starts"/);
  });
});

describe("#9 /fees and /safety cover Declutter", () => {
  it("the fee is checkout's own numbers, and the seller keeps the whole price", () => {
    const { container } = render(<MemoryRouter><Fees /><Safety /></MemoryRouter>);
    const line = container.querySelector("[data-fees-declutter]")?.textContent ?? "";
    expect(line).toContain(`buyer's fee of ${DECLUTTER_BUYER_FEE_WORDS}, once per checkout`);
    expect(line).toContain("The seller receives the whole item price.");
    expect(container.querySelector("[data-safety-declutter]")?.textContent).toMatch(/24 hours after the handover/);
  });
  it("the Spanish line carries the same numbers", async () => {
    await spanish();
    const { container } = render(<MemoryRouter><Fees /></MemoryRouter>);
    const line = container.querySelector("[data-fees-declutter]")?.textContent ?? "";
    expect(line).toContain(`${DECLUTTER_BUYER_FEE_PERCENT}%`);
    expect(line).toContain(`${DECLUTTER_BUYER_FEE_FIXED_CENTS} centavos`);
  });
});

describe("Help, support, legal, auth", () => {
  it("#10 a Declutter tile, and the open tile reads as selected", () => {
    expect(COMMON_PROBLEMS.map((p) => p.id)).toContain("item-never-came");
    expect(COMMON_PROBLEMS.length).toBeGreaterThan(4);
    expect(src("src/pages/info/HelpCenter.tsx")).toContain('${open ? "border-[hsl(var(--bark))] bg-[hsl(var(--bark)/0.08)]" : "border-border bg-card"}');
  });
  it("#21 curly quotes and a light footer", () => {
    expect(src("src/pages/info/HelpCenter.tsx")).toContain("No answers match &ldquo;{query.trim()}&rdquo;.");
    const chrome = src("src/pages/info/legal/LegalChrome.tsx");
    expect(chrome).toContain("border border-border bg-muted/40 px-4 py-3");
    expect(chrome).not.toMatch(/rounded-\[20px\] bg-muted px-4/);
  });
  it("#22 support: no repeated intro, a plain placeholder, an olive highlight", () => {
    const message = SUPPORT_TOPICS.find((t) => t.key === "message")!;
    expect(message.description).not.toMatch(/reads every message/);
    expect(message.messagePlaceholder).toBe("Tell us what happened.");
    expect(src("src/pages/info/support/SupportFormParts.tsx")).toContain('className="focus:bg-[hsl(var(--bark)/0.1)] focus:text-foreground"');
  });
  it("#23 legal tab labels are 13px at every width", () => {
    const bar = src("src/pages/info/legal/LegalTabBar.tsx");
    expect(bar).toContain("rounded-full text-ds-13 font-sans");
    expect(bar).not.toContain("text-ds-11");
  });
  it("#12 the footer's desktop rows are 32px with a mouse", () => {
    expect(src("src/components/Footer.tsx")).toContain('const FOOTER_LINK = "link-standard inline-flex items-center min-h-11 lg:[@media(pointer:fine)]:min-h-8";');
  });
  it("#16 Log in's sign-up line is 14px", () => {
    expect(src("src/pages/auth/Login.tsx")).toContain('<p className="text-center text-ds-14 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }} data-login-new-here="">');
  });
  it("#18 Reset password says it plainly, with no em dash", () => {
    const reset = src("src/pages/auth/ResetPassword.tsx");
    expect(reset).toContain('"Open the reset link from your email, or request a new one."');
    const literals = [...reset.matchAll(/"([^"\n]{20,})"/g)].map((m) => m[1]).filter((l) => /reset link/i.test(l));
    expect(literals.length).toBeGreaterThan(1);
    for (const l of literals) expect(l).not.toContain("—");
  });
  it("#19 the job's not-found cards are the 404's card", () => {
    const jd = src("src/pages/jobs/JobDetail.tsx");
    expect(jd).toContain('<div className="mx-auto w-full max-w-[440px] flex" data-job-not-found="login">');
    expect(jd).toContain('<div className="mx-auto w-full max-w-[440px] flex" data-job-not-found="unavailable">');
    expect(jd).not.toContain("Browse open Jobs");
    expect(jd).not.toMatch(/"Log in to see this job\."|"This job isn't available\."/);
  });
  it("#20 Go home and one tab title", () => {
    expect(src("src/pages/u/PublicProfilePage.tsx")).not.toContain("Go to Louisiana Helpr");
    expect(src("src/components/profile/PublicProfileForward.tsx")).not.toContain("Go to Louisiana Helpr");
    expect(src("src/pages/info/NotFound.tsx")).toContain('title: "Not found — Helpr",');
    expect(src("src/components/declutter/DeclutterSkeletons.tsx")).toContain('notFound ? "Not found — Helpr"');
  });
});
