/**
 * Q2705/Q2706 (Builder 3, 11-04): supabase-js (the `supabase` chunk, 30.0 KB gz of the 193 KB boot) leaves the
 * boot path once no module in main.tsx's static closure imports the client statically. Slice 1 moved the
 * fire-and-forget callers to loadModule (8 -> 4 boot importers); slice 2 gave OfflineBanner the realtime health
 * registry in its own module (src/lib/realtimeHealth.ts), so realtimeRecovery.ts left boot (4 -> 3); slice 3
 * has useLoginTracking subscribe after loading the client (3 -> 2). The list below only ever shrinks. Next:
 * useAuthReady and useCurrentUser (plan: Builder 3's 11-04 handoff).
 *
 * @mutate src/lib/clientCompat.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/minSupportedBuild.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/nativeLaunchRoute.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/signupSource.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/components/OfflineBanner.tsx | import { useRealtimeDegraded } from "@/lib/realtimeHealth"; | import { useRealtimeDegraded } from "@/lib/realtimeRecovery";
 * @mutate src/hooks/useLoginTracking.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { bootModules } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const STATIC_CLIENT = /(?:^|[;\n])\s*import\s+(?!type\b)[^;]*?from\s*["']@\/integrations\/supabase\/client["']/;

/** Boot modules that still import the Supabase client statically. Remove a line when you move one off. */
const STILL_STATIC = [
  "src/hooks/useAuthReady.ts",
  "src/hooks/useCurrentUser.ts",
];

describe("the Supabase client leaves the boot path one importer at a time (Q2705/Q2706)", () => {
  it("only the listed boot modules import the client statically", () => {
    const boot = [...bootModules(ROOT)].filter((f) => /\.(ts|tsx)$/.test(f));
    // Floor: the walk really covers boot.
    expect(boot.length).toBeGreaterThan(80);
    const importers = boot
      .filter((f) => STATIC_CLIENT.test(blankComments(readFileSync(f, "utf8"))))
      .map((f) => relative(ROOT, f).split("\\").join("/"))
      .sort();
    expect(importers).toEqual([...STILL_STATIC].sort());
  });
});
