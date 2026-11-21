import type { ReactNode } from "react";
import HelprMark from "@/components/HelprMark";
import BackButton from "@/components/BackButton";

/**
 * The top row of every auth card: the H mark (links home) centred, with the shared back arrow at the card's top-left
 * on the same line (owner 11-21: "do we need a back button here so they can get back to home??"; it replaced board
 * 37/55's "no back arrow, the H is the way home"). The arrow is BackButton's own: it goes back to where you came from
 * inside the site, else Home ("/", which the app's NativeRedirect turns into Browse), so phone web and the app behave
 * the same. Absolute, so the H stays optically centred and the row's height is the H's.
 * One component for /login, /signup's first step and every AuthCardHead card. Guard: src/test/authCardBackArrow1121.test.tsx.
 */
export function AuthCardMarkRow() {
  return (
    <div className="relative mb-2 flex w-full items-center justify-center" data-auth-card-mark="">
      <div className="absolute left-0 top-1/2 -translate-y-1/2" data-auth-card-back="">
        <BackButton />
      </div>
      {/* The H mark used everywhere else (owner 2026-10-20: never in a circle). */}
      <HelprMark to="/" size="lg" emblemOnly />
    </div>
  );
}

/**
 * The head of an auth card: the mark row (the H, linking home, and the back arrow), one sentence-case h1 and
 * an optional muted line. The same head /login's card carries (board 37), so
 * forgot password, set a new password and check your email read as the same
 * centered card instead of a Title Case `[back] [title]` row over a bare box
 * (spec v2 rebuild, audit 2026-10-21).
 */
export function AuthCardHead({ title, sub, testId }: { title: string; sub?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5" data-testid={testId}>
      <AuthCardMarkRow />
      <h1 className="text-page-title text-foreground text-balance">{title}</h1>
      {sub && <p className="text-ds-14 text-muted-foreground text-balance">{sub}</p>}
    </div>
  );
}
