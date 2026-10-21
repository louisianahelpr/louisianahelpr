import type { ReactNode } from "react";
import HelprMark from "@/components/HelprMark";

/**
 * The head of an auth card: the H mark (links home), one sentence-case h1 and
 * an optional muted line. The same head /login's card carries (board 37), so
 * forgot password, set a new password and check your email read as the same
 * centered card instead of a Title Case `[back] [title]` row over a bare box
 * (spec v2 rebuild, audit 2026-10-21).
 */
export function AuthCardHead({ title, sub, testId }: { title: string; sub?: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col items-center text-center gap-1.5" data-testid={testId}>
      <div className="mb-2">
        <HelprMark to="/" size="lg" emblemOnly />
      </div>
      <h1 className="text-page-title text-foreground text-balance">{title}</h1>
      {sub && <p className="text-ds-14 text-muted-foreground text-balance">{sub}</p>}
    </div>
  );
}
