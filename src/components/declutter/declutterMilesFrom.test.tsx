/*
 * GUARD (DA-10, Declutter audit 10-29): "Distances don't say where they're measured from (profile ZIP); 'Use my
 * location' hidden in Filters." The auditor's miles came from the profile ZIP (70501, Lafayette) while the device
 * was in Baton Rouge, and the only words about it and the only "Use my location" were inside the filter sheet.
 *
 * Browse and Free now carry a line above their cards: "Miles from 70501" (or where else the miles come from) with
 * "Use my location" beside it, following the filter sheet's rule for when to offer it (offerAsk).
 * Shots: ~/.lh-shots/b104/da10/after-browse-{375,1440}.png (before: ~/.lh-shots/b104/da8/before-all-*.png).
 */
// @mutate src/components/declutter/DeclutterMilesFrom.tsx | return ask.zip ? `Miles from ${ask.zip}` : "Miles from your ZIP code's area"; | return "Miles from your ZIP code's area";
// @mutate src/components/declutter/DeclutterMilesFrom.tsx | ) : offerAsk(ask) ? ( | ) : false ? (
// @mutate src/components/declutter/DeclutterMilesFrom.tsx | variant="link" size="sm" className="shrink-0 px-1 text-ds-13 font-semibold" | variant="outline" size="sm" className="rounded-full"
// @mutate src/components/declutter/DeclutterBrowseBar.tsx |   return !fromDevice && (!ask.asked \|\| ask.canAskAgain); |   return !ask.asked \|\| ask.canAskAgain;
// @mutate src/components/declutter/DeclutterBrowseView.tsx | {itemsPhase !== "offline-empty" && rows.length > 0 && <DeclutterMilesFrom ask={ask} />} | {null}
// @mutate src/components/declutter/DeclutterFreeView.tsx | <DeclutterMilesFrom ask={{ origin, askDevice, asked, asking, canAskAgain, deviceNote, zip }} /> | {null}
// @mutate src/components/declutter/useDeclutterOrigin.ts | canAskAgain, deviceNote, zip }; | canAskAgain, deviceNote, zip: null };
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { DeclutterMilesFrom } from "./DeclutterMilesFrom";
import type { OriginAsk } from "./DeclutterBrowseBar";
import type { DeclutterOrigin } from "./useDeclutterOrigin";

const at = (source: "device" | "profile" | "zip" | "parish"): DeclutterOrigin => ({ status: "ready", lat: 30.2, lng: -92.0, source, approximate: source !== "device" });

function ask(over: Partial<OriginAsk>): OriginAsk {
  return { origin: at("zip"), asked: false, asking: false, canAskAgain: false, deviceNote: null, askDevice: vi.fn(), zip: "70501", ...over };
}

describe("Declutter miles line (DA-10)", () => {
  it("names the ZIP the miles come from, with Use my location beside it", () => {
    const a = ask({});
    render(<DeclutterMilesFrom ask={a} />);
    expect(screen.getByText("Miles from 70501")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
    expect(a.askDevice).toHaveBeenCalledTimes(1);
  });

  it("BUY-21: Use my location is a text button that shares the line's row (no outline, no wrap row of its own)", () => {
    render(<DeclutterMilesFrom ask={ask({ origin: at("profile") })} />);
    const btn = screen.getByRole("button", { name: "Use my location" });
    expect(btn.className).not.toMatch(/\bborder\b|ctl-tint/);
    expect(btn.className).toContain("text-primary");
    expect(btn.className).toContain("text-ds-13");
    expect(btn.className).toContain("shrink-0");
  });

  it.each([
    ["profile", "Miles from your saved location"],
    ["parish", "Miles from your parish's center"],
  ] as const)("a %s origin says so, and still offers the device", (source, words) => {
    render(<DeclutterMilesFrom ask={ask({ origin: at(source) })} />);
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use my location" })).toBeInTheDocument();
  });

  it("miles from the device: says so, no button (also a fix cached earlier this session, never asked here)", () => {
    render(<DeclutterMilesFrom ask={ask({ origin: at("device"), asked: false })} />);
    expect(screen.getByText("Miles from where you are")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("while asking: 'Finding you…', no button; a read that failed says why and offers it again", () => {
    const { unmount } = render(<DeclutterMilesFrom ask={ask({ asked: true, asking: true })} />);
    expect(screen.getByRole("status").textContent).toBe("Finding you…");
    expect(screen.queryByRole("button")).toBeNull();
    unmount();
    render(<DeclutterMilesFrom ask={ask({ asked: true, canAskAgain: true, deviceNote: "Location permission declined" })} />);
    expect(screen.getByText("Location permission declined")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try my location again" })).toBeInTheDocument();
  });

  it("no position at all: asks for the location rather than showing miles", () => {
    render(<DeclutterMilesFrom ask={ask({ origin: { status: "none", zipOnFile: false }, zip: null })} />);
    expect(screen.getByText("Use your location to see how far items are")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use my location" })).toBeInTheDocument();
  });

  it("Browse and Free both show it above their cards, with the profile ZIP passed through", () => {
    const browse = blankComments(readFileSync("src/components/declutter/DeclutterBrowseView.tsx", "utf8"));
    const free = blankComments(readFileSync("src/components/declutter/DeclutterFreeView.tsx", "utf8"));
    const hook = blankComments(readFileSync("src/components/declutter/useDeclutterOrigin.ts", "utf8"));
    const lines = [...(browse.match(/<DeclutterMilesFrom ask=\{ask\} \/>/g) ?? []), ...(free.match(/<DeclutterMilesFrom ask=\{\{[^}]*zip \}\} \/>/g) ?? [])];
    expect(lines.length).toBeGreaterThan(1);
    expect(browse).toMatch(/const ask = \{[^}]*\bzip\b[^}]*\}/);
    expect(hook).toMatch(/canAskAgain, deviceNote, zip \};/);
  });
});
