/**
 * What the seller sees when sorting didn't finish (owner 2026-10-30, on an iPhone: "each picture a separate item and
 * don't even write the listing with ai"): one card, with the reason and Sort again; and a card with no words offers
 * "Write it with AI", says why it is blank, and shows on that card why writing failed.
 *
 * @mutate src/components/declutter/DeclutterBunchPile.tsx | {item.sortReason}</p> | </p>
 * @mutate src/components/declutter/DeclutterBunchCard.tsx | {rewriting ? "Writing…" : noWords ? "Write it with AI" : "Write it again"} | {rewriting ? "Writing…" : "Write it again"}
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |       {rewriteNote && <p | {false && <p
 * @mutate src/components/declutter/DeclutterBunchCard.tsx |       {mergeTarget && ( |       {false && (
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BunchCard } from "./DeclutterBunchCard";
import { BunchPileCard } from "./DeclutterBunchPile";
import { blankItem, notSortedPile } from "@/lib/declutter/bunch";

vi.mock("./DeclutterPriceHint", () => ({ default: () => null }));

const card = (props: Partial<Parameters<typeof BunchCard>[0]> = {}) => render(
  <ul>
    <BunchCard item={blankItem(["a"])} index={0} others={[]} urls={new Map()} files={new Map()} at={null} rewriting={false} onChange={() => {}} onMove={() => {}} onSplit={() => {}} onRemovePhoto={() => {}} onCover={() => {}} onReorder={() => {}} canDrag={false} onAddPhotos={() => {}} onMerge={() => {}} onDrop={() => {}} onRewrite={() => {}} {...props} />
  </ul>,
);

describe("the photos that aren't sorted yet", () => {
  const pile = (keys: string[]) => notSortedPile(keys, "We couldn't sort these 3 photos yet: Connection trouble. Check your signal and try again.");
  const show = (keys: string[], extra = {}) => render(<ul><BunchPileCard item={pile(keys)} urls={new Map()} busy={false} onSortAgain={() => {}} onOneItem={() => {}} onDrop={() => {}} {...extra} /></ul>);

  it("say how many, why, and offer Sort again", () => {
    const onSortAgain = vi.fn();
    show(["a", "b", "c"], { onSortAgain });
    expect(screen.getByRole("heading", { name: "3 photos not sorted yet" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Connection trouble");
    fireEvent.click(screen.getByRole("button", { name: "Sort again" }));
    expect(onSortAgain).toHaveBeenCalledTimes(1);
  });

  it("can be called one item, or left out", () => {
    const onOneItem = vi.fn();
    const onDrop = vi.fn();
    show(["a", "b", "c"], { onOneItem, onDrop });
    fireEvent.click(screen.getByRole("button", { name: "These are one item" }));
    fireEvent.click(screen.getByRole("button", { name: "Don't sell these" }));
    expect(onOneItem).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("can't be called one item past the limit on photos", () => {
    show(Array.from({ length: 13 }, (_, i) => `p${i}`));
    expect(screen.queryByRole("button", { name: "These are one item" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sort again" })).toBeTruthy();
  });

  it("can't start anything while a sort or a listing run is going", () => {
    show(["a", "b"], { busy: true });
    expect((screen.getByRole("button", { name: "Sort again" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("an item with no words", () => {
  it("offers Write it with AI and says why it is blank", () => {
    const onRewrite = vi.fn();
    card({ onRewrite });
    expect(document.querySelector("[data-bunch-no-words]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Write it with AI/ }));
    expect(onRewrite).toHaveBeenCalledTimes(1);
  });

  it("with words, it is Write it again, and says nothing about being blank", () => {
    card({ item: { ...blankItem(["a"]), title: "Oak chair" } });
    expect(screen.getByRole("button", { name: /^Write it again/ })).toBeTruthy();
    expect(document.querySelector("[data-bunch-no-words]")).toBeNull();
  });

  it("says on the card why writing failed", () => {
    card({ rewriteNote: "We couldn't write \"Item 1\": Connection trouble." });
    expect(screen.getByRole("alert").textContent).toContain("Connection trouble");
  });
});

// @mutate src/components/declutter/DeclutterBunchCard.tsx |       {item.failedPhoto && item.photoKeys.includes(item.failedPhoto) && ( |       {false && (
// @mutate src/components/declutter/DeclutterBunchPhotos.tsx | data-bunch-photo-failed={item.failedPhoto === k ? "" : undefined} | data-bunch-photo-failed={undefined}
describe("a photo that didn't finish sending", () => {
  it("stays on the item, marked, says which, and offers Try again", () => {
    const onRetryUpload = vi.fn();
    card({ item: { ...blankItem(["a", "b"]), title: "Floor lamp", failedPhoto: "b" }, onRetryUpload });
    expect(document.querySelectorAll("[data-bunch-photo-failed]")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "See Floor lamp, photo 2" }).closest("li")?.hasAttribute("data-bunch-photo-failed")).toBe(true);
    expect(document.querySelector("[data-bunch-upload-failed]")?.textContent).toContain("Photo 2");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetryUpload).toHaveBeenCalledTimes(1);
  });

  it("says nothing once that photo has moved off the item", () => {
    card({ item: { ...blankItem(["a"]), title: "Floor lamp", failedPhoto: "b" } });
    expect(document.querySelector("[data-bunch-upload-failed]")).toBeNull();
  });
});

describe("the merge suggestion", () => {
  it("names the other item and merges into it", () => {
    const onMerge = vi.fn();
    card({ item: { ...blankItem(["a"]), title: "Oak chair", mergeHint: "two" }, others: [{ key: "two", name: "Rocking chair" }], onMerge });
    expect(document.querySelector("[data-bunch-merge-hint]")?.textContent).toContain("Rocking chair");
    fireEvent.click(screen.getByRole("button", { name: "Merge them" }));
    expect(onMerge).toHaveBeenCalledWith("two");
  });

  it("goes when that item has gone", () => {
    card({ item: { ...blankItem(["a"]), title: "Oak chair", mergeHint: "gone" }, others: [] });
    expect(document.querySelector("[data-bunch-merge-hint]")).toBeNull();
  });
});
