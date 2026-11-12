/**
 * CLASS GUARD (lead decision 2026-11-10, owner may override; Q2154 screenshot pass): a Shops setting whose options
 * each carry a label and a sentence is a RadioCardList (role="radiogroup" of role="radio" cards that wrap their full
 * text), never a row of full-width pill <Button aria-pressed>. The pills drew a 3-4 line option as an oval at 375
 * (~/.lh-shots/b1-owner-1110d/shops-dashboard-MOCKED-H-375--s2.png) and announced as toggle buttons, not choices.
 *
 *   1. Source, every non-test .tsx under src/components/shops (comments blanked): no <Button> that is aria-pressed
 *      AND full width AND whitespace-normal (the multi-line choice drawn as a pill).
 *   2. Mounted, each of the four pickers: one radiogroup by its name, one radio per option, the saved one checked,
 *      every option's FULL label and sentence in its text, and no truncate / line-clamp / ellipsis / nowrap class
 *      inside an option (jsdom has no layout; the 375 measurement is in the 11-10 handoff).
 *
 * @mutate src/components/shops/ShopCancelPolicyPicker.tsx |         <RadioCardList | <RadioCardListX
 * @mutate src/components/ui/RadioCardList.tsx |             aria-checked={on} |             aria-pressed={on}
 * @mutate src/components/ui/RadioCardList.tsx | <span className="flex-1 min-w-0 whitespace-normal break-words"> | <span className="flex-1 min-w-0 truncate">
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { trackedFiles } from "@/test/helpers/trackedFiles";
import { blankComments } from "@/test/helpers/blankNonCode";

const row = vi.hoisted(() => ({ cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", handover_mode: "porch", custom_orders: "off" }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }), rpc: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import CancelPolicyPicker from "@/components/shops/ShopCancelPolicyPicker";
import ReadyTapCancelPicker from "@/components/shops/ShopReadyTapCancelPicker";
import HandoverModePicker from "@/components/shops/ShopHandoverModePicker";
import CustomOrdersPicker from "@/components/shops/ShopCustomOrdersPicker";
import { CANCEL_POLICY_TEXT, READY_TAP_CANCEL_TEXT, PICKABLE_CUSTOM_ORDER_MODES, CUSTOM_ORDER_TEXT } from "@/lib/shops/orders";
import { HANDOVER_MODE_TEXT } from "@/lib/shops/handover";

describe("source: no multi-line pill choice in Shops", () => {
  it("no <Button> is aria-pressed, full width and whitespace-normal", () => {
    const files = trackedFiles("src/components/shops").filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"));
    expect(files.length).toBeGreaterThan(40);
    let buttons = 0;
    const offenders: string[] = [];
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      for (const m of src.matchAll(/<Button\b[\s\S]*?<\/Button>/g)) {
        buttons++;
        const b = m[0];
        if (/aria-pressed/.test(b) && /\bw-full\b/.test(b) && /\bwhitespace-normal\b/.test(b)) offenders.push(`${f}: ${b.slice(0, 80)}`);
      }
    }
    expect(buttons).toBeGreaterThan(60);
    expect(offenders).toEqual([]);
  });
});

const PICKERS: Array<{ name: string; C: ComponentType<{ shopId: string }>; checked: string; options: Array<{ label: string; sub: string }> }> = [
  { name: "Cancel rule", C: CancelPolicyPicker, checked: CANCEL_POLICY_TEXT.until_accept.shop.label, options: Object.values(CANCEL_POLICY_TEXT).map((t) => ({ label: t.shop.label, sub: t.shop.hint })) },
  { name: "How buyers get their orders", C: HandoverModePicker, checked: HANDOVER_MODE_TEXT.porch.label, options: Object.values(HANDOVER_MODE_TEXT).map((t) => ({ label: t.label, sub: t.detail })) },
  { name: "Custom orders", C: CustomOrdersPicker, checked: CUSTOM_ORDER_TEXT.off.label, options: PICKABLE_CUSTOM_ORDER_MODES.map((m) => ({ label: CUSTOM_ORDER_TEXT[m].label, sub: CUSTOM_ORDER_TEXT[m].hint })) },
  { name: "If you mark an order ready early", C: ReadyTapCancelPicker, checked: READY_TAP_CANCEL_TEXT.from_day_before.label, options: Object.values(READY_TAP_CANCEL_TEXT).map((t) => ({ label: t.label, sub: t.hint })) },
];

describe("mounted: each Shops picker is a radio group with every word shown", () => {
  for (const p of PICKERS) {
    it(p.name, async () => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><p.C shopId="s1" /></QueryClientProvider>);
      const group = await screen.findByRole("radiogroup", { name: p.name });
      const radios = within(group).getAllByRole("radio");
      expect(radios).toHaveLength(p.options.length);
      expect(p.options.length).toBeGreaterThan(1);
      radios.forEach((r, i) => {
        expect(r.textContent).toContain(p.options[i].label);
        expect(r.textContent).toContain(p.options[i].sub);
        expect(r.getAttribute("aria-checked")).toBe(p.options[i].label === p.checked ? "true" : "false");
        for (const el of [r, ...r.querySelectorAll("*")]) {
          expect(String(el.getAttribute("class") ?? "")).not.toMatch(/\b(truncate|line-clamp-\d|text-ellipsis|whitespace-nowrap)\b/);
        }
      });
    });
  }
});

// S022 (Shops audit 11-12): the shop's own settings speak to the SHOP. The cancel-rule picker showed the buyer's
// words ("you can cancel ... until your order is ready", "the shop accepts"), so "you" pointed at the wrong person.
// @mutate src/components/shops/ShopCancelPolicyPicker.tsx | label: CANCEL_POLICY_TEXT[p].shop.label, sub: CANCEL_POLICY_TEXT[p].shop.hint | label: CANCEL_POLICY_TEXT[p].label, sub: CANCEL_POLICY_TEXT[p].detail
describe("S022: the shop's cancel-rule settings use shop-side words", () => {
  const BUYER_WORDS = /\byour (order|ready date)\b|\byou can cancel\b|\bthe shop (accepts|marks)\b/i;
  for (const p of PICKERS.filter((x) => x.name === "Cancel rule" || x.name === "If you mark an order ready early")) {
    it(p.name, async () => {
      row.cancel_policy = "until_handover";
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(<QueryClientProvider client={qc}><p.C shopId="s1" /></QueryClientProvider>);
      const group = await screen.findByRole("radiogroup", { name: p.name });
      expect(within(group).getAllByRole("radio").length).toBeGreaterThan(1);
      expect(group.textContent ?? "").not.toMatch(BUYER_WORDS);
      row.cancel_policy = "until_accept";
    });
  }
});
