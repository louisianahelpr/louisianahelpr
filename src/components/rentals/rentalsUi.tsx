import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { useAuthReady } from "@/hooks/useAuthReady";
import NotFound from "@/pages/info/NotFound";

/**
 * Every Rentals page renders the 404 unless the hidden 'rentals' switch is on
 * for the member (the DeclutterGate pattern). The server refuses regardless
 * (require_feature in every rentals_* RPC); this only keeps the screens hidden.
 */
export function RentalsGate({ children }: { children: ReactNode }) {
  const enabled = useFeature("rentals");
  const { user, isReady } = useAuthReady();
  const qc = useQueryClient();
  if (enabled) return <>{children}</>;
  const state = qc.getQueryState(["feature-enabled", "rentals", user?.id ?? null]);
  const settled = isReady && (!user || state?.status === "success" || state?.status === "error");
  return settled ? <NotFound /> : null;
}

export function RentalsCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold text-base">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
