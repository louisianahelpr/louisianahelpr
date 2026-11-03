/**
 * Q2249: the /login loading skeleton draws the board 37 Log in card, so a cold /login load does not jump from the old
 * layout (a 2xl column, a "Log In" title row above the card, lg:p-10) to the real one (AuthShell maxWidth="sm", the
 * card head's "Log in" h1 under the H mark, lg:p-8). The two geometries are read from their own files and compared.
 *
 * @mutate src/components/LoginRouteSkeleton.tsx | <div className="w-full max-w-sm" data-login-skeleton-column=""> | <div className="w-full page-measure" data-login-skeleton-column="">
 * @mutate src/components/LoginRouteSkeleton.tsx | <div className="liquid-glass p-5 sm:p-6 lg:p-8 space-y-6" data-login-skeleton-card=""> | <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6" data-login-skeleton-card="">
 * @mutate src/components/LoginRouteSkeleton.tsx |             <h1 className="text-page-title text-foreground">Log in</h1> |             <h1 className="text-page-title text-foreground">Log In</h1>
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { en } from "@/lib/i18n/en";

const read = (rel: string) => blankComments(readFileSync(resolve(__dirname, "..", rel), "utf8"));
const login = read("pages/auth/Login.tsx");
const shell = read("components/auth/AuthShell.tsx");
const skeleton = read("components/LoginRouteSkeleton.tsx");

describe("Q2249: the /login skeleton is the board 37 card", () => {
  it("is not vacuous", () => {
    expect(login.length).toBeGreaterThan(5000);
    expect(skeleton.length).toBeGreaterThan(1000);
    expect(skeleton).toContain('data-testid="login-route-skeleton"');
  });

  it("the same column: Login's AuthShell maxWidth maps to the skeleton column's width class", () => {
    const width = /<AuthShell [^>]*maxWidth="(\w+)"/.exec(login)?.[1];
    expect(width).toBe("sm");
    const cls = new RegExp(`\\b${width}: "([^"]+)"`).exec(shell)?.[1];
    expect(cls).toBe("max-w-sm");
    expect(skeleton).toContain(`<div className="w-full ${cls}" data-login-skeleton-column="">`);
    // No title row above the card (Login passes no title): the old skeleton drew one.
    expect(/<AuthShell [^>]*\btitle=/.test(login)).toBe(false);
    expect(skeleton).not.toMatch(/text-headline-hero/);
  });

  it("the same card padding and the same head: the H mark, then the one h1 in Login's words", () => {
    const card = /<div className="liquid-glass ([^"]+)">/.exec(login)?.[1];
    expect(card).toBe("p-5 sm:p-6 lg:p-8 space-y-6");
    expect(skeleton).toContain(`<div className="liquid-glass ${card}" data-login-skeleton-card="">`);
    const h1 = /<h1 className="([^"]+)">\{t\("login\.title"\)\}<\/h1>/.exec(login)?.[1];
    expect(h1).toBe("text-page-title text-foreground");
    expect(skeleton).toContain(`<h1 className="${h1}">${en["login.title"]}</h1>`);
    expect((skeleton.match(/<h1\b/g) ?? []).length).toBe(1);
    // The H mark (HelprMark lg emblem is h-14) sits above the h1, as in Login's card head.
    expect(login).toContain('<HelprMark to="/" size="lg" emblemOnly />');
    expect(skeleton.indexOf('className="h-14 w-14')).toBeGreaterThan(-1);
    expect(skeleton.indexOf('className="h-14 w-14')).toBeLessThan(skeleton.indexOf("<h1"));
  });
});
