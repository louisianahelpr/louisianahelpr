/**
 * DB-LOW follow-ups (lead 11-01, Declutter audit DB 10-30 "Small Buying items"):
 * (a) the Buying card's controls are the shared Button, not hand-built ones: the order head's next action and its
 *     "Details" toggle (BuyerOrderHead), and a cart line's "Remove" (RemoveFromCart);
 * (b) the buyer's next move is one verb, "pick" ("Pick a pickup time", "Pick a time to meet"), never "book".
 * The class is read from the rendered controls: each must carry exactly the shared Button's classes for its variant.
 *
 * @mutate src/components/declutter/BuyingOrders.tsx |           <Button type="button" size="sm" onClick={onAction} data-next-action=""> |           <Button type="button" size="sm" className="btn-grad-primary min-h-11 rounded-full px-5 text-sm font-semibold" onClick={onAction} data-next-action="">
 * @mutate src/components/declutter/BuyingOrders.tsx | <Button type="button" variant="link" size="sm" className="px-1" aria-expanded={open} | <Button type="button" variant="ghost" size="sm" className="px-1" aria-expanded={open}
 * @mutate src/components/declutter/DeclutterCartRemove.tsx |       <Button type="button" variant="link" size="sm" className="shrink-0 px-1 text-ds-13" |       <Button type="button" variant="ghost" size="sm" className="shrink-0 px-1 text-ds-13"
 * @mutate src/components/declutter/BuyingOrders.tsx |   if (f.handover === "pickup_home") return f.booked ? "I got it" : "Pick a pickup time"; |   if (f.handover === "pickup_home") return f.booked ? "I got it" : "Book a pickup time";
 * @mutate src/components/declutter/BuyingOrders.tsx |       if (at === 0) return you("Pick a time to meet at the safe spot"); |       if (at === 0) return you("Book a time to meet at the safe spot");
 * @mutate src/components/declutter/BoughtWhatNext.tsx | : [book("Pick a pickup time", "In Buying, from the seller's times"), | : [book("Book a pickup time", "In Buying, from the seller's times"),
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";
import { buttonVariants } from "@/components/ui/button";
import { BuyerOrderHead, buyerNextAction, type BuyerOrderView } from "./BuyingOrders";
import { RemoveFromCart } from "./DeclutterCartRemove";
import type { OrderFacts } from "./OrderSteps";

const classesOf = (el: Element) => new Set(el.className.split(/\s+/).filter(Boolean));
function wearsShared(el: Element, variant: "default" | "link") {
  // A call site may still set its own padding or type size (Button merges className with tailwind-merge); everything
  // else the shared Button gives must be there.
  const want = buttonVariants({ variant, size: "sm" }).split(/\s+/).filter((c) => c && !/^(px|py|h|text-ds)-/.test(c));
  const have = classesOf(el);
  return want.filter((c) => !have.has(c));
}

const facts = (over: Partial<OrderFacts> = {}): OrderFacts => ({ handover: "pickup_home", side: "buyer", booked: false, done: false, ...over });
const view = (over: Partial<BuyerOrderView> = {}): BuyerOrderView => ({
  orderId: "o1", facts: facts(), bucket: "needs_you", action: "Pick a pickup time", next: { who: "you", text: "Pick a pickup time" }, money: "You paid $40.00.", ...over,
});

describe("DB-LOW (a): the Buying card's controls are the shared Button", () => {
  it("the next action is the primary Button and Details is the link Button", () => {
    render(<BuyerOrderHead view={view()} open={false} onOpen={() => {}} onClose={() => {}} />);
    const next = screen.getByRole("button", { name: "Pick a pickup time" });
    const details = screen.getByRole("button", { name: "Details" });
    expect(wearsShared(next, "default")).toEqual([]);
    expect(wearsShared(details, "link")).toEqual([]);
    expect(details.className).not.toMatch(/\bunderline-offset-2\b/);
    expect(buttonVariants({ variant: "link", size: "sm" }).split(/\s+/).length).toBeGreaterThan(5);
  });

  it("a cart line's Remove is the link Button", () => {
    render(<QueryClientProvider client={new QueryClient()}><RemoveFromCart line={{ line_id: "l1", item_title: "Oak chair" }} /></QueryClientProvider>);
    const remove = screen.getByRole("button", { name: "Remove Oak chair from your cart" });
    expect(wearsShared(remove, "link")).toEqual([]);
  });
});

describe("DB-LOW (b): the buyer's next move is one verb, pick", () => {
  it("every pickup kind's unbooked action says Pick, never Book", () => {
    const actions = (["porch", "pickup_home", "meetup"] as const).map((h) => buyerNextAction(facts({ handover: h })));
    expect(actions).toEqual(["Pick a pickup time", "Pick a pickup time", "Pick a time to meet"]);
  });

  // The class, in source: no Declutter buyer step, button or notice tells the buyer to "Book a ..." time (a Helpr job is
  // still booked: DeclutterAddHelpr's "Book a Helpr" is the Jobs verb).
  const FILES = [
    "src/components/declutter/BuyingOrders.tsx", "src/components/declutter/BoughtWhatNext.tsx", "src/components/declutter/DeclutterPorchHandover.tsx",
    "src/components/declutter/DeclutterHandoverViews.tsx", "src/components/declutter/DeclutterMeetup.tsx", "src/components/declutter/DeclutterPorchDay.tsx",
    "src/components/declutter/DeclutterHandoverSheets.tsx", "src/components/declutter/SellerDeliveryOrder.tsx", "src/lib/declutter/meetupErrors.ts",
    "src/lib/declutter/errors.ts",
  ];
  it("no Declutter pickup copy says book a time", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/["'`][^"'`\n]*\b(?:Book (?:a|this)\b(?! Helpr)|book a (?:pickup )?time|to book\b|books the time|you booked a)[^"'`\n]*["'`]/gi)) hits.push(`${f}: ${m[0]}`);
      for (const m of code.matchAll(/["'`]Book["'`]/g)) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
    expect(FILES.length).toBeGreaterThan(9);
  });
});
