/**
 * GD-010: three comments said guests cannot file a `reports` row because
 * reports.reporter_id is NOT NULL. It has been nullable since 20260902051631
 * (deletion anonymises it); the INSERT policy's auth.uid() = reporter_id check
 * is what refuses a guest. A comment that cites a withdrawn schema guarantee
 * misleads the next reader, so none may make that claim again.
 *
 * @mutate supabase/functions/contact-support/index.ts | // Guests cannot: the INSERT policy needs auth.uid() = reporter_id. | // Guests cannot: reports.reporter_id is a NOT NULL user uuid.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = ["src/pages/info/Support.tsx", "supabase/functions/contact-support/index.ts", "src/components/profile/SupportInline.tsx"];
const STALE = /reporter_id[^\n]{0,40}NOT NULL|NOT NULL[^\n]{0,40}reporter_id/;

describe("guest report gate cites the policy, not a NOT NULL (GD-010)", () => {
  for (const f of FILES) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      expect(src.length).toBeGreaterThan(200);
      expect(src).not.toMatch(STALE);
    });
  }
});
