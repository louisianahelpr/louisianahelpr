// @mutate src/content/giftGuideSponsorLogos.json | "logo":"/gift-guides/sponsors/ryse.webp" | "logo":"/gift-guides/sponsors/lmnt.webp"
/**
 * The gift-guides logo row shows RYSE's blue square from their Facebook page (lead 2026-11-22, readiness check
 * Ready-to-post-1123 README section 7: the row still showed the old black "RYSE / FUEL YOUR GREATNESS" wordmark).
 * Source: ~/Desktop/25 Days Logos/RYSE-facebook-blue.png via INDEX.md and scripts/gift-guide-sponsor-logos.mjs.
 * Measured with sharp: the old webp averaged rgb(19, 19, 19); the blue one rgb(16, 106, 224).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

describe("the logo row's RYSE logo is the blue Facebook square", () => {
  it("the RYSE row draws a mostly blue logo (inventory floor: the row lists sponsors)", async () => {
    const rows = JSON.parse(readFileSync(join(ROOT, "src/content/giftGuideSponsorLogos.json"), "utf8")) as { name: string; logo?: string }[];
    expect(rows.length).toBeGreaterThan(50);
    const ryse = rows.find((r) => r.name === "RYSE");
    expect(ryse?.logo).toBeTruthy();
    const sharp = (await import("sharp")).default;
    const { channels } = await sharp(join(ROOT, "public", String(ryse?.logo))).stats();
    const [r, , b] = channels.map((c) => c.mean);
    expect(b).toBeGreaterThan(180);
    expect(b - r).toBeGreaterThan(120);
  });
});
