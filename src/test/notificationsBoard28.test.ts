/**
 * Notifications sheet = board 28 (2026-10-20), restyle: "Mark all read" in
 * words; rust ONLY on money notices (spec v2 §1.1): the day label is muted, the
 * unread dot is olive, an unread row has no rust wash, and the icon circle
 * wears the money tint only for MONEY_TYPES; titles in Montserrat.
 *
 * @mutate src/components/NotificationPanel.tsx |                                   style={{ background: "hsl(var(--bark))" }} |                                   style={{ background: "hsl(var(--burnt-sienna))" }}
 * @mutate src/components/NotificationPanel.tsx |                       color: "hsl(var(--muted-foreground))",\n |                       color: "hsl(var(--burnt-sienna))",\n
 * @mutate src/components/NotificationPanel.tsx |                 Mark all read\n |                 <CheckCheck />\n
 * @mutate src/components/notificationPanel/notificationPanelHelpers.tsx | new Set(["payment", "financial_alerts", "declutter_sales", "declutter_refunds"]) | new Set(["payment", "financial_alerts", "declutter_sales", "declutter_refunds", "application"])
 * @mutate src/components/NotificationPanel.tsx | className="min-w-0 flex-1 font-sans font-bold | className="min-w-0 flex-1 font-display font-bold
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { MONEY_TYPES } from "@/components/notificationPanel/notificationPanelHelpers";

const src = blankComments(readFileSync(resolve(__dirname, "../components/NotificationPanel.tsx"), "utf8"));

describe("the notifications sheet matches board 28", () => {
  it("is not vacuous", () => {
    expect(src.length).toBeGreaterThan(20000);
    expect(src).toContain("groupedNotifications.map");
  });

  it("'Mark all read' in words", () => {
    expect(src).toMatch(/onClick=\{markAllRead\}[\s\S]{0,400}>\s*Mark all read\s*</);
  });

  it("rust only on money: muted day label, olive unread dot, no rust wash, money tint only for money kinds", () => {
    expect([...MONEY_TYPES].sort()).toEqual(["declutter_refunds", "declutter_sales", "financial_alerts", "payment"]);
    const rows = src.slice(src.indexOf("groupedNotifications.map"));
    const sienna = (rows.match(/--burnt-sienna/g) ?? []).length;
    // Exactly the two money-tint declarations (background + colour) in the row list.
    expect(sienna).toBe(2);
    expect(rows).toMatch(/MONEY_TYPES\.has\(n\.type\)\s*\?\s*\{ background: "hsl\(var\(--burnt-sienna\) \/ 0\.12\)"/);
    expect(rows).toMatch(/aria-label="Unread"[\s\S]{0,200}background: "hsl\(var\(--bark\)\)"/);
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
