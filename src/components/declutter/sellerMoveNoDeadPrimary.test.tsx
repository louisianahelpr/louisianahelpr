/**
 * App audit 11-24 (deep audit 11-22 #48 rest): the seller's "Move pickup time" panel showed a dead, disabled "Move to
 * this time" under "No pickup times are open … Message the seller to agree a time." The seller IS the seller, and the
 * primary could never be pressed. Now the primary rides in PickupSlotPicker's `actions` (drawn only where there are
 * times to pick), the seller's no-times line says "None of your pickup times…" and points them at the Helpr, and
 * "Keep the time" stays as the way out.
 *
 * CLASS GUARD (below): at every <PickupSlotPicker> render site, a variant="primary" button disabled on the picked value
 * sits inside the picker's `actions`, so no picker caller can draw a dead primary under "no times".
 *
 * @mutate src/components/declutter/SellerMoveHelprPickup.tsx |         actions={ |         data-x={
 * @mutate src/components/declutter/DeclutterPickupWindows.tsx |         ? "None of your pickup times are open before the pickup deadline." |         ? "No pickup times are open before the pickup deadline. Message the seller to agree a time."
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const state = vi.hoisted(() => ({ latest: "" }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => name === "declutter_order_pickup_windows"
      ? { data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, starts: "09:00:00", ends: "11:00:00", latest_pickup_at: state.latest })), error: null }
      : { data: null, error: null },
  },
}));

import { SellerMoveHelprPickup } from "./SellerMoveHelprPickup";

function openPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SellerMoveHelprPickup taskId="t1" orderId="o1" who="Sam" current={null} /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Move pickup time" }));
}

describe("the seller's pickup move offers no dead primary", () => {
  it("no open times: says so in the seller's own words, no 'Move to this time', Keep the time stays", async () => {
    state.latest = new Date(Date.now() + 60_000).toISOString();
    openPanel();
    const none = await screen.findByTestId("declutter-no-pickup-slots");
    expect(none).toHaveTextContent("None of your pickup times are open before the pickup deadline.");
    expect(none).not.toHaveTextContent("Message the seller");
    expect(screen.getByText("Message Sam to agree a new time.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to this time" })).toBeNull();
    expect(screen.getByRole("button", { name: "Keep the time" })).toBeEnabled();
  });

  it("with open times: the chips and 'Move to this time' show", async () => {
    state.latest = new Date(Date.now() + 7 * 86_400_000).toISOString();
    openPanel();
    expect(await screen.findByTestId("declutter-slot-picker")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to this time" })).toBeDisabled();
  });
});

/** Each `<PickupSlotPicker ... />` element's text (brace depth aware), from a comment-blanked source. */
export function pickerElements(code: string): string[] {
  const out: string[] = [];
  let at = code.indexOf("<PickupSlotPicker");
  while (at >= 0) {
    let depth = 0;
    let i = at;
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (depth === 0 && c === "/" && code[i + 1] === ">") { i += 2; break; }
    }
    out.push(code.slice(at, i));
    at = code.indexOf("<PickupSlotPicker", i);
  }
  return out;
}
/** Text of the element's `actions={...}` attribute, or "" when absent. */
function actionsAttr(el: string): string {
  const at = el.indexOf("actions={");
  if (at < 0) return "";
  let depth = 0;
  for (let i = at + "actions=".length; i < el.length; i++) {
    if (el[i] === "{") depth++;
    else if (el[i] === "}" && --depth === 0) return el.slice(at, i + 1);
  }
  return el.slice(at);
}
/** Per picker element: variant="primary" Buttons in the file whose `disabled` reads `!<value>`, and how many sit outside `actions`. */
export function deadPrimaries(code: string): { outside: number; total: number }[] {
  const res: { outside: number; total: number }[] = [];
  for (const el of pickerElements(code)) {
    const v = /\bvalue=\{(\w+)\}/.exec(el)?.[1];
    if (!v) continue;
    const re = new RegExp(`<Button[^>]*variant="primary"[^>]*disabled=\\{[^}]*!\\(?${v}\\b`, "g");
    const total = (code.match(re) ?? []).length;
    const inside = (actionsAttr(el).match(re) ?? []).length;
    res.push({ outside: total - inside, total });
  }
  return res;
}

describe("CLASS: no picker caller draws a dead primary under 'no times'", () => {
  it("the parser flags a primary outside actions and passes one inside", () => {
    const bad = `<PickupSlotPicker value={pick} onPick={setPick} fallback={null} />\n<Button variant="primary" disabled={!pick}>Go</Button>`;
    const good = `<PickupSlotPicker value={pick} onPick={setPick} fallback={null} actions={<Button variant="primary" disabled={!pick}>Go</Button>} />`;
    expect(deadPrimaries(bad)[0]).toMatchObject({ outside: 1 });
    expect(deadPrimaries(good)[0]).toMatchObject({ outside: 0, total: 1 });
  });

  it("every render site keeps its pick-gated primary inside actions", () => {
    const root = process.cwd();
    const sites: string[] = [];
    const offenders: string[] = [];
    let gated = 0;
    for (const f of walkSource([join(root, "src")]).filter((x) => !/\.test\.tsx?$|\/src\/test\//.test(x))) {
      const code = blankComments(readFileSync(f, "utf8"));
      if (!code.includes("<PickupSlotPicker")) continue;
      for (const r of deadPrimaries(code)) {
        sites.push(f);
        gated += r.total;
        if (r.outside > 0) offenders.push(f);
      }
    }
    // DeclutterPickupWindows (Helpr accept), SellerMoveHelprPickup, DeclutterBookingPanel.
    expect(sites.length).toBeGreaterThan(2);
    // SellerMoveHelprPickup's "Move to this time" (BookingPanel's Book is variant={booked ? ... : "primary"}, not literal).
    expect(gated).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
