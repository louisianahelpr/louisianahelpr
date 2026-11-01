/**
 * The in-progress views (owner 2026-11-01): after Post it / List N items, each listing's step (Uploading photos ->
 * Checking -> Live); while a bunch's photos are read, "Reading your photos…" with its steps and a bar. Wired in:
 * declutterBunchKeepOpen.test.tsx (the list run) and declutterSellPhotos.test.tsx (Post it).
 *
 * @mutate src/components/declutter/SellProgress.tsx |     if (done >= n + i + 1) return "live"; |     if (done >= n + i + 2) return "live";
 * @mutate src/components/declutter/SellProgress.tsx |   if (/^Putting it up/i.test(words)) return "live"; |   if (/^Putting it up/i.test(words)) return "checking";
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { bunchItemSteps, postStepOf, ReadingPhotos, SellProgress } from "./SellProgress";

describe("each listing's step while it goes up", () => {
  it("Sell one: from the posting words", () => {
    expect(postStepOf("Uploading photo 1 of 3")).toBe("photos");
    expect(postStepOf("Adding photo 2 of 3")).toBe("photos");
    expect(postStepOf("Saving your listing")).toBe("checking");
    expect(postStepOf("Putting it up")).toBe("live");
  });

  it("Sell a bunch: every item made ready, then every item listed (2 steps each)", () => {
    expect(bunchItemSteps(0, 6)).toEqual(["photos", "waiting", "waiting"]);
    expect(bunchItemSteps(1, 6)).toEqual(["checking", "photos", "waiting"]);
    expect(bunchItemSteps(3, 6)).toEqual(["checking", "waiting", "waiting"]);
    expect(bunchItemSteps(4, 6)).toEqual(["live", "checking", "waiting"]);
    expect(bunchItemSteps(6, 6)).toEqual(["live", "live", "live"]);
  });

  it("the card names each item and its step, with a bar", () => {
    render(<SellProgress title="Listing 2 items…" rows={[{ name: "Lamp", step: "live" }, { name: "Chair", step: "checking" }]} />);
    expect(screen.getByRole("status")).toHaveTextContent("Listing 2 items…");
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(80);
    expect([...document.querySelectorAll("[data-progress-row]")].map((r) => r.textContent)).toEqual(["LampLive", "ChairChecking"]);
  });

  it("reading a bunch's photos: the steps and how far along", () => {
    render(<ReadingPhotos adding={{ ready: 2, total: 4 }} sorting={{ done: 0, total: 1 }} found={0} />);
    expect(screen.getByText("Reading your photos…")).toBeTruthy();
    expect([...document.querySelectorAll("[data-reading-step]")].map((r) => [r.textContent, r.getAttribute("data-reading-step")]))
      .toEqual([["Adding photos (2 of 4)", "now"], ["Sorting into items", "next"], ["Writing each listing", "next"]]);
    expect(Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"))).toBe(15);
  });
});
