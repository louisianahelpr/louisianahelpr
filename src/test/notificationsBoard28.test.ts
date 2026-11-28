/**
 * Notifications sheet = board 28 (2026-10-20), restyle: "Mark all read" in
 * words; rust ONLY on money notices (spec v2 §1.1): the day label is muted, the
 * unread dot is olive, an unread row has no rust wash, and the row's icon
 * wears the money colour only for MONEY_TYPES (a bare icon since polish audit
 * 11-27 #13, no tinted circle behind it); titles in Montserrat.
 *
 * @mutate src/components/NotificationPanelView.tsx |                                   style={{ background: "hsl(var(--bark))" }} |                                   style={{ background: "hsl(var(--burnt-sienna))" }}
 * @mutate src/components/NotificationPanelView.tsx |                       color: "hsl(var(--muted-foreground))",\n |                       color: "hsl(var(--burnt-sienna))",\n
 * @mutate src/components/NotificationPanelView.tsx |                 {t("notif.markAllRead")}\n |                 <CheckCheck />\n
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx | new Set(["payment", "financial_alerts", "declutter_sales", "declutter_refunds"]) | new Set(["payment", "financial_alerts", "declutter_sales", "declutter_refunds", "application"])
 * @mutate src/components/NotificationPanelView.tsx | className="min-w-0 flex-1 font-sans font-bold | className="min-w-0 flex-1 font-display font-bold
 * @mutate src/components/notificationPanel/NotificationLeading.tsx |   const money = MONEY_TYPES.has(n.type); |   const money = true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { MONEY_TYPES } from "@/components/notificationPanel/notificationPanelHelpers";

const src = blankComments(readFileSync(resolve(__dirname, "../components/NotificationPanelView.tsx"), "utf8"));
// The row's leading circle moved to NotificationLeading (Q2037 faces, 2026-11-04); the panel mounts it per row.
const leading = blankComments(readFileSync(resolve(__dirname, "../components/notificationPanel/NotificationLeading.tsx"), "utf8"));

describe("the notifications sheet matches board 28", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(20000);
    expect(src).toContain("groupedNotifications.map");
  });

  it("'Mark all read' in words", () => {
    // F260q: the words come from the dictionary (enNotifications.ts "Mark all read").
    expect(src).toMatch(/onClick=\{markAllRead\}[\s\S]{0,400}>\s*\{t\("notif\.markAllRead"\)\}\s*</);
  });

  it("rust only on money: muted day label, olive unread dot, no rust wash, money tint only for money kinds", () => {
    expect([...MONEY_TYPES].sort()).toEqual(["declutter_refunds", "declutter_sales", "financial_alerts", "payment"]);
    const panelRows = src.slice(src.indexOf("groupedNotifications.map"));
    expect(panelRows).toMatch(/<NotificationLeading n=\{n\}/);
    const rows = `${panelRows}\n${leading}`;
    const sienna = (rows.match(/--burnt-sienna/g) ?? []).length;
    // Exactly one money colour declaration in the row list, and no tinted circle behind any icon (polish audit 11-27 #13).
    expect(sienna).toBe(1);
    expect(leading).toMatch(/const money = MONEY_TYPES\.has\(n\.type\);/);
    expect(rows).toMatch(/money\s*\?\s*\{ color: "hsl\(var\(--burnt-sienna\)\)" \}/);
    expect(leading.slice(leading.indexOf("const money"))).not.toMatch(/background|rounded-full/);
    expect(rows).toMatch(/aria-label=\{t\("notif\.unreadDot"\)\}[\s\S]{0,200}background: "hsl\(var\(--bark\)\)"/);
    expect(rows).toMatch(/className="min-w-0 flex-1 font-sans font-bold/);
  });
});

// @mutate src/components/notificationPanel/notificationPanelHelpers.tsx |   new_offers: <Sparkles className="w-4 h-4" />, |   new_offers: <Sparkles className="w-4 h-4 text-accent" />,
describe("icons take the circle's colour", () => {
  it("no notice icon carries its own colour class (a rust sparkle on a non-money notice was the board-28 defect)", () => {
    const helpers = blankComments(readFileSync(resolve(__dirname, "../components/notificationPanel/notificationPanelHelpers.tsx"), "utf8"));
    const icons = helpers.slice(helpers.indexOf("typeIcons"), helpers.indexOf("};", helpers.indexOf("typeIcons")));
    expect((icons.match(/className="w-4 h-4"/g) ?? []).length).toBeGreaterThan(10);
    expect(icons).not.toMatch(/text-(accent|primary|muted-foreground)/);
  });
});
