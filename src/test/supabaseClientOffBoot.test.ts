/**
 * Q2705/Q2706 (Builder 3, 11-04): supabase-js (the `supabase` chunk, 30.0 KB gz of the 193 KB boot) leaves the
 * boot path once no module in main.tsx's static closure imports the client statically. Slice 1 moved the
 * fire-and-forget callers to loadModule (8 -> 4 boot importers); slice 2 gave OfflineBanner the realtime health
 * registry in its own module (src/lib/realtimeHealth.ts), so realtimeRecovery.ts left boot (4 -> 3); slice 3
 * has useLoginTracking subscribe after loading the client (3 -> 2). Slice 4 has useAuthReady and useCurrentUser
 * take the client on first use (2 -> 0). The list below only ever shrinks.
 *
 * @mutate src/lib/clientCompat.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/minSupportedBuild.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/nativeLaunchRoute.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/lib/signupSource.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/components/OfflineBanner.tsx | import { useRealtimeDegraded } from "@/lib/realtimeHealth"; | import { useRealtimeDegraded } from "@/lib/realtimeRecovery";
 * @mutate src/hooks/useAuthReady.ts | import { loadModule } from "@/lib/loadModule"; | import { loadModule } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 * @mutate src/hooks/useCurrentUser.ts | import { loadModule, untilReload } from "@/lib/loadModule"; | import { loadModule, untilReload } from "@/lib/loadModule"; import { supabase } from "@/integrations/supabase/client"; void supabase;
 *
 * The bytes only move when the build's chunk groups let them (Builder 3, 11-04, slice 4 chunking): loadModule.ts
 * rides in the preload-helper chunk (the "supabase" bucket's recursive capture took it, so every boot chunk that lazy-loads
 * imported supabase for it), and Home-only shared code gets "home-shared" (in app-shared, a boot chunk, the Home
 * modules that import the client put it on every page's boot). bundle-size.yml env build: boot 193 -> 151 KB gz,
 * /posts 195 -> 152. The /posts and kpi critical-path budgets were lowered in the same commit.
 * @mutate vite.config.ts | /src[\\/]lib[\\/]loadModule\.ts$/.test(id), | /src[\\/]lib[\\/]loadModuleNever\.ts$/.test(id),
 * @mutate vite.config.ts | test: (id: string) => SHARED_DIR_RE.test(id) && homeOnly(norm(id)), | test: (id: string) => false && homeOnly(norm(id)),
 * @mutate vite.config.ts | false /* the home-only modules, not their deps | true /* the home-only modules, not their deps
 * @mutate vite.config.ts | const homeOnly = (f: string) => homeSet.has(f) && !bootSet.has(f); | const homeOnly = (f: string) => homeSet.has(f);
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
const STILL_STATIC: string[] = [];

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

  it("the build's chunk groups keep the client's chunk off boot (slice 4 chunking)", () => {
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    const groupOf = (name: string) => config.match(new RegExp(`name:\\s*"${name}",[\\s\\S]*?\\}`))?.[0] ?? "";
    const prio = (g: string) => Number(g.match(/priority:\s*(\d+)/)?.[1] ?? NaN);
    const loadModule = groupOf("preload-helper");
    expect(loadModule).toMatch(/\|\|\s*\/src\[\\\\\/\]lib\[\\\\\/\]loadModule\\\.ts\$\/\.test\(id\)/);
    // Above the vendor buckets (100): otherwise "supabase"'s recursive capture takes it back.
    expect(prio(loadModule)).toBeGreaterThanOrEqual(110);
    const homeShared = groupOf("home-shared");
    expect(homeShared).toMatch(/test:\s*\(id: string\) => SHARED_DIR_RE\.test\(id\) && homeOnly\(norm\(id\)\),/);
    expect(homeShared).toMatch(/includeDependenciesRecursively:\s*false/);
    expect(prio(homeShared)).toBeGreaterThan(prio(groupOf("app-shared")));
    expect(config).toMatch(/const homeOnly = \(f: string\) => homeSet\.has\(f\) && !bootSet\.has\(f\);/);
  });
});
