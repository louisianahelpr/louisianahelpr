import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Supabase Auth requires a Turnstile token (Q1314). A native build without
// VITE_TURNSTILE_ENABLED=true sends none, so no one can log in on it and the
// installed binary cannot be patched. build:ios is the one command every iOS
// lane runs (ios-beta.yml, deploy.yml, local fastlane), and vite.config.ts
// refuses a Capacitor build without the flag. This pins both halves.
const root = join(__dirname, "..", "..");

describe("native builds ship with Turnstile on", () => {
  it("build:ios sets VITE_TURNSTILE_ENABLED=true on the vite build", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(pkg.scripts["build:ios"]).toMatch(
      /VITE_CAPACITOR_BUILD=1 VITE_TURNSTILE_ENABLED=true vite build/,
    );
  });

  it("vite.config.ts refuses a Capacitor build without it", () => {
    const config = readFileSync(join(root, "vite.config.ts"), "utf8");
    expect(config).toMatch(/isCapacitorBuild && env\.VITE_TURNSTILE_ENABLED !== "true"/);
  });
});
