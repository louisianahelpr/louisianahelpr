/**
 * GUARD (owner 11-19): 25 Days of Louisiana Giveaways reminder pushes and the /25days "How to enter" button.
 * Migration 20261119200128; backend proof src/test/pglite/giveawayReminders.pglite.mjs (ALL PASS applied 3x;
 * NEW_MIGRATION=skip red; 11 planted defects, 11 killed).
 *
 * Built from the migrations (the NEWEST definition of giveaway_reminder_sweep and the newest type CHECK):
 *   1. The config rows are the owner's dates (Louisiana time) and words, link /25days, and never say HOW to enter.
 *   2. A cron runs the sweep every 15 minutes.
 *   3. The sweep: nothing while the switch is off; per member the switch, the Giveaway reminders switch, no seed, test
 *      or banned account; once per member (the sends table's key, claimed in the same statement as the notice).
 *   4. giveaway_reminders is in the newest notifications_type_check and every registry; push ON by default, email OFF;
 *      Settings shows its row.
 *   5. The page: a "How to enter" link to the configured URL, else the Facebook Page.
 *
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql |       ON CONFLICT (reminder_key, user_id) DO NOTHING\n |       ON CONFLICT (reminder_key, user_id) DO UPDATE SET sent_at = now()\n
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql |        WHERE np.giveaway_reminders IS NOT FALSE\n |        WHERE true\n
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql |          AND NOT public.is_test_subject(p.user_id)\n |
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql |          AND p.is_seed IS NOT TRUE\n |
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql | s.key = 'sponsor_25days' AND s.audience IS DISTINCT FROM 'off') THEN | s.key = 'nope') THEN
 * @mutate supabase/migrations/20261119200128_giveaway_reminders.sql | giveaway_reminders boolean NOT NULL DEFAULT true; | giveaway_reminders boolean NOT NULL DEFAULT false;
 * @mutate src/components/sponsor/Sections.tsx | href={enterUrl} target="_blank" | href={C.links.website} target="_blank"
 * @mutate src/pages/sponsor/SponsorPage.tsx | const enterUrl = entryQ.data ?? C.links.facebookPage; | const enterUrl = C.links.website;
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { EntrantHero, Hero } from "@/components/sponsor/Sections";
import { safeEntryUrl } from "@/lib/sponsor/api";
import { sponsorPage } from "@/content/sponsorPage";
import { rows } from "@/components/notificationPreferences/constants";
import { defaultPrefs } from "@/components/notificationPreferences/constants";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const DEFS = effectiveDefs(MIGRATIONS);
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
const all = files.map((f) => ({ f, sql: flat(readFileSync(resolve(MIGRATIONS, f), "utf8")) }));
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const MIG = all.find((m) => m.f.endsWith("_giveaway_reminders.sql"));

/** The seeded config rows: key, Louisiana time, title, message, link. */
function seededRows(): Array<{ key: string; at: string; message: string; link: string }> {
  const sql = MIG?.sql ?? "";
  const block = sql.slice(sql.indexOf("INSERT INTO public.giveaway_reminders AS g"));
  const out: Array<{ key: string; at: string; message: string; link: string }> = [];
  const row = /\('([a-z0-9_]+)', '([0-9-]+ [0-9:]+) America\/Chicago', '((?:[^']|'')*)', '((?:[^']|'')*)', '(\/[^']*)'\)/g;
  for (const m of block.slice(0, block.indexOf("ON CONFLICT")).matchAll(row)) {
    out.push({ key: m[1], at: m[2], message: m[4].replace(/''/g, "'"), link: m[5] });
  }
  return out;
}

describe("25 Days giveaway reminders (owner 11-19)", () => {
  it("the config is the owner's schedule and words, in Louisiana time, opening /25days", () => {
    const r = seededRows();
    expect(r.map((x) => `${x.at} | ${x.message}`)).toEqual([
      "2026-11-30 18:00:00 | 🎄 25 Days of Louisiana Giveaways starts tomorrow! Enter once for a chance at all 25 days. Tap to see how.",
      "2026-12-01 09:00:00 | It's here! Enter once and you're in for all 25 days of Louisiana giveaways 🎁",
      "2026-12-05 18:00:00 | It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.",
      "2026-12-10 18:00:00 | It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.",
      "2026-12-15 18:00:00 | It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.",
      "2026-12-19 18:00:00 | It's not too late! Enter our 25 Days of Louisiana Giveaways. One entry covers every day left.",
      "2026-12-23 18:00:00 | Last chance! Only a few days of giveaways left 🎄",
    ]);
    expect(new Set(r.map((x) => x.key)).size).toBe(r.length);
    expect(r.every((x) => x.link === "/25days")).toBe(true);
  });

  it("no reminder or button says HOW people enter (owner: don't say exactly what the plan is)", () => {
    const words = [...seededRows().map((x) => x.message), sponsorPage.entrant.enterCta].join(" ").toLowerCase();
    for (const how of ["share", "comment", "like ", "tag ", "follow"]) expect(words, how).not.toContain(how);
    expect(sponsorPage.entrant.enterCta).toBe("Entry details on our Facebook page");
  });

  it("a cron runs the sweep every 15 minutes", () => {
    const last = [...all].reverse().find((m) => m.sql.includes("cron.schedule('giveaway-reminders'"));
    expect(last?.sql).toContain("cron.schedule('giveaway-reminders', '1,16,31,46 * * * *', $c$SELECT public.cron_record_work('giveaway-reminders', to_jsonb(public.giveaway_reminder_sweep()));$c$)");
  });

  it("the sweep: switch, opt-out, test and seed accounts, once per member", () => {
    const body = flat(DEFS.get("giveaway_reminder_sweep")?.stmt ?? "");
    expect(body).toContain("IF NOT EXISTS (SELECT 1 FROM public.feature_switches s WHERE s.key = 'sponsor_25days' AND s.audience IS DISTINCT FROM 'off') THEN RETURN");
    expect(body).toContain("WHERE g.send_at <= now() AND g.send_at > now() - interval '6 hours'");
    for (const filter of [
      "WHERE np.giveaway_reminders IS NOT FALSE",
      "AND p.is_seed IS NOT TRUE",
      "AND (p.ban_status IS NULL OR p.ban_status NOT IN ('banned', 'temp_banned', 'permanently_banned'))",
      "AND NOT public.is_test_subject(p.user_id)",
      "AND (v_everyone OR public.sponsor_25days_on_for(p.user_id))",
      "ON CONFLICT (reminder_key, user_id) DO NOTHING RETURNING user_id",
    ]) expect(body, filter).toContain(filter);
    // The notice is written only for the members claimed in the same statement.
    expect(body).toContain("SELECT c.user_id, r.title, r.message, 'giveaway_reminders', r.link FROM claimed c");
    expect(MIG?.sql).toContain("PRIMARY KEY (reminder_key, user_id)");
  });

  it("giveaway_reminders is a type with its own switch, on by default, in every registry", () => {
    const check = [...all].reverse().find((m) => m.sql.includes("ADD CONSTRAINT notifications_type_check"));
    expect(check?.f).toBe(MIG?.f);
    expect(check?.sql).toContain("'giveaway_reminders'");
    expect(MIG?.sql).toContain("ADD COLUMN IF NOT EXISTS giveaway_reminders boolean NOT NULL DEFAULT true;");
    expect(MIG?.sql).toContain("ADD COLUMN IF NOT EXISTS email_giveaway_reminders boolean NOT NULL DEFAULT false;");
    expect(MIG?.sql).toContain("('giveaway_reminders', 'giveaway_reminders', '25 Days of Louisiana Giveaways reminders.')");
    expect(read("supabase/functions/_shared/notificationTypes.ts")).toMatch(/giveaway_reminders:\s+\{ prefCol: 'email_giveaway_reminders'/);
    expect(read("supabase/functions/create-notification/index.ts")).toContain('"giveaway_reminders"');
    expect(read("src/components/notificationPreferences/deployLagColumns.ts")).toContain('"giveaway_reminders"');
    const row = rows.find((x) => x.key === "giveaway_reminders");
    expect(row?.emailKey).toBe("email_giveaway_reminders");
    expect(row?.noEmailSwitch).toBeTruthy();
    expect(defaultPrefs.giveaway_reminders).toBe(true);
  });

  it("the page's How to enter button opens the configured link, else the Facebook Page", () => {
    const { unmount } = render(<MemoryRouter><EntrantHero enterUrl="https://www.facebook.com/louisianahelpr/posts/1" /></MemoryRouter>);
    const a = screen.getByTestId("giveaway-enter");
    expect(a.textContent).toBe("Entry details on our Facebook page");
    expect(a.getAttribute("href")).toBe("https://www.facebook.com/louisianahelpr/posts/1");
    expect(a.getAttribute("target")).toBe("_blank");
    unmount();
    // The brand-facing /sponsor gets no shopper button.
    render(<MemoryRouter><Hero greetingBrand={null} /></MemoryRouter>);
    expect(screen.queryByTestId("giveaway-enter")).toBeNull();
    const page = read("src/pages/sponsor/SponsorPage.tsx");
    expect(page).toContain("const enterUrl = entryQ.data ?? C.links.facebookPage;");
    expect(page).toContain("<EntrantHero enterUrl={enterUrl} />");
  });

  it("only an https link is used as the entry link", () => {
    expect(safeEntryUrl("https://www.facebook.com/x/posts/1")).toBe("https://www.facebook.com/x/posts/1");
    for (const bad of [null, "", "javascript:alert(1)", "http://x.com", "https://a b", 42]) expect(safeEntryUrl(bad)).toBeNull();
  });
});
