/**
 * Spanish landing (Builder 2, 11-11): a route ships only its own words. The English screen dictionaries
 * (src/lib/i18n/en*.ts, register-on-import through enRegistry.ts) each get their own chunk group in vite.config.ts,
 * above app-shared, so Home's page reaching enDeclutter/enHome/enPublic no longer puts them on every route's boot
 * (Q178: / 212 vs 197 KB gz, /browse 325 vs 284, Selling 600 vs 532, 9 routes over). Boot keeps enCore + enRegistry;
 * the Spanish dictionaries are reached only through es.ts's dynamic import.
 *
 * @mutate vite.config.ts | .filter((f) => /^en[A-Z]\w*\.ts$/.test(f) && f !== "enCore.ts" && f !== "enRegistry.ts") | .filter((f) => /^enScreens\.ts$/.test(f) && f !== "enCore.ts" && f !== "enRegistry.ts")
 * @mutate vite.config.ts | name: dict === "enScreens" ? "i18n-screens" : `i18n-${dict}`, | name: "i18n-screens",
 * @mutate src/components/landing/useGuestSpanish.ts | const esModule = () => loadModule(() => import("@/lib/i18n/es")); | import { es as esNow } from "@/lib/i18n/es"; void esNow; const esModule = () => loadModule(() => import("@/lib/i18n/es"));
 * @mutate src/lib/i18n/enRegistry.ts | import { enCore } from "./enCore"; | import { enCore } from "./enCore"; import "./enDeclutter";
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { bootModules } from "../../scripts/perf/bootReach.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const I18N = resolve(ROOT, "src/lib/i18n");
const rel = (f: string) => relative(ROOT, f).split("\\").join("/");
const files = readdirSync(I18N).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f));
const screenDicts = files.filter((f) => /^en[A-Z]\w*\.ts$/.test(f) && f !== "enCore.ts" && f !== "enRegistry.ts");
const spanishDicts = files.filter((f) => /^es([A-Z]\w*)?\.ts$/.test(f));

describe("each screen's words ride with that screen (Spanish landing, Q178)", () => {
  it("vite.config.ts gives every English screen dictionary its own chunk group, above app-shared", () => {
    expect(screenDicts.length).toBeGreaterThan(10);
    const config = blankComments(readFileSync(resolve(ROOT, "vite.config.ts"), "utf8"));
    // The list is read from the folder, so a new dictionary is covered without editing the config.
    expect(config).toContain(
      `.filter((f) => /^en[A-Z]\\w*\\.ts$/.test(f) && f !== "enCore.ts" && f !== "enRegistry.ts")`,
    );
    const group = config.match(/\.\.\.I18N_SCREEN_DICTS\.map\(\(dict\) => \(\{[\s\S]*?\}\)\)/)?.[0] ?? "";
    // One chunk per dictionary: a single shared name would hand every screen every screen's words.
    expect(group).toMatch(/name: dict === "enScreens" \? "i18n-screens" : `i18n-\$\{dict\}`,/);
    expect(group).toMatch(/\$\{dict\}\\\\\.ts\$/);
    expect(group).toMatch(/minSize: 0,/);
    expect(group).toMatch(/includeDependenciesRecursively: false/);
    const prio = Number(group.match(/priority:\s*(\d+)/)?.[1] ?? NaN);
    const appShared = config.match(/name:\s*"app-shared",[\s\S]*?\}/)?.[0] ?? "";
    const appPrio = Number(appShared.match(/priority:\s*(\d+)/)?.[1] ?? NaN);
    expect(appPrio).toBeGreaterThan(0);
    expect(prio).toBeGreaterThan(appPrio);
  });

  it("no screen dictionary and no Spanish dictionary is in main.tsx's static closure", () => {
    const boot = [...bootModules(ROOT)].map(rel);
    expect(boot.length).toBeGreaterThan(20);
    const words = boot.filter((f) => f.startsWith("src/lib/i18n/"));
    for (const f of words) {
      expect(screenDicts.map((d) => `src/lib/i18n/${d}`)).not.toContain(f);
      expect(spanishDicts.map((d) => `src/lib/i18n/${d}`)).not.toContain(f);
    }
    // t()'s own modules (every screen loads them) import only the boot words.
    const dictImport = /(?:^|[;\n])\s*import\s+(?!type\b)[^;]*?["']\.\/(en|es)[A-Z]?\w*["']/g;
    for (const core of ["enRegistry.ts", "language.ts"]) {
      const text = blankComments(readFileSync(resolve(I18N, core), "utf8"));
      const hits = [...text.matchAll(dictImport)].map((m) => m[0].trim()).filter((s) => !/["']\.\/(enCore|enRegistry)["']/.test(s));
      expect(hits, core).toEqual([]);
    }
  });

  it("the Spanish dictionaries are reached only through es.ts, which is only ever imported dynamically", () => {
    expect(spanishDicts.length).toBeGreaterThan(5);
    const staticEs = /(?:^|[;\n])\s*import\s+(?!type\b)[^;]*?from\s*["'](?:@\/lib\/i18n|\.)\/es[A-Z]?\w*["']/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "test" && e.name !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) && rel(p) !== "src/lib/i18n/es.ts") {
          if (staticEs.test(blankComments(readFileSync(p, "utf8")))) offenders.push(rel(p));
        }
      }
    };
    walk(resolve(ROOT, "src"));
    expect(offenders).toEqual([]);
  });
});
