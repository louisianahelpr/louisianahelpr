/**
 * A-007: avatar_url and portfolio_urls render into <img src> on 14 surfaces (grep, 2026-09-24)
 * (admin user detail among them), so a client write of a third-party URL is a
 * tracking pixel. The newest migration defining enforce_profile_image_urls
 * must anchor on THIS project's host with the trailing slash (so
 * "<ref>.supabase.co.evil.example" fails), cover both columns, and exempt only
 * server context. Behaviour proven in PGlite (~/.lh-pglite/a007.mjs, 8 cases).
 *
 * @mutate supabase/migrations/20260924073416_profile_image_urls_pinned_to_own_storage.sql |   v_ok  constant text := '^https://fncmgoasalhdgfwzhsqa\.supabase\.co/'; -- A-007 this project's host |   v_ok  constant text := '^https://fncmgoasalhdgfwzhsqa\.supabase\.co'; -- A-007 this project's host
 * @mutate supabase/migrations/20260924073416_profile_image_urls_pinned_to_own_storage.sql |   BEFORE UPDATE OF avatar_url, portfolio_urls ON public.profiles |   BEFORE UPDATE OF avatar_url ON public.profiles
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const DIR = resolve(__dirname, "../../supabase/migrations");

describe("client profile image URLs are pinned to this project's host (A-007)", () => {
  const defs = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ f, sql: readFileSync(resolve(DIR, f), "utf8") }))
    .filter(({ sql }) => /FUNCTION public\.enforce_profile_image_urls\(\)/i.test(sql));

  it("finds the definition", () => {
    expect(defs.length).toBeGreaterThanOrEqual(1);
  });

  it("pattern is anchored, host-exact, slash-terminated", () => {
    const { f, sql } = defs[defs.length - 1];
    const pat = sql.match(/v_ok\s+constant text := '([^']+)'/)?.[1];
    expect(pat, f).toBe("^https://fncmgoasalhdgfwzhsqa\\.supabase\\.co/");
  });

  it("trigger covers both columns", () => {
    const { f, sql } = defs[defs.length - 1];
    expect(sql, f).toMatch(/BEFORE UPDATE OF avatar_url, portfolio_urls ON public\.profiles/);
    expect(sql, f).toMatch(/IF public\.is_server_context\(\) THEN\s+RETURN NEW;/);
  });
});
