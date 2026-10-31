import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { ErrorState } from "@/components/ui/ErrorState";

type Days = 7 | 30 | 90;

/** One row of admin_signup_source_report (20261031220447): counts only, real members only. */
interface SourceRow {
  source: string;
  campaign: string | null;
  signups: number;
  first_posts: number;
}

/** "facebook" -> "facebook", "direct" -> "Direct (no link)", "other" -> "Other". */
function sourceLabel(source: string): string {
  if (source === "direct") return "Direct (no link)";
  if (source === "other") return "Other";
  return source;
}

/**
 * OPS-5 (owner 10-29): which links bring sign-ups and first posts. Every number is counted by
 * admin_signup_source_report from real members (no test accounts); the member's own words are the only thing kept.
 */
export function SignupSources() {
  const [days, setDays] = useState<Days>(30);
  const q = useQuery({
    queryKey: ["admin", "signup-sources", days],
    queryFn: async () => {
      const res = await supabase.rpc("admin_signup_source_report", { p_days: days });
      // Merge-to-deploy window: the function is not on the database yet, so the card stays out (PGRST202).
      if (res.error && isMissingRpcNamed(res.error, "admin_signup_source_report")) return null;
      return (unwrap(res) ?? []) as unknown as SourceRow[];
    },
  });
  if (q.data === null) return null;

  const controls = (
    <select
      aria-label="Time window"
      className="min-h-11 rounded-full border border-border bg-card px-4 text-ds-13 font-semibold"
      value={days}
      onChange={(e) => setDays(Number(e.target.value) as Days)}
    >
      <option value={7}>Last 7 days</option>
      <option value={30}>Last 30 days</option>
      <option value={90}>Last 90 days</option>
    </select>
  );

  if (q.isError) {
    return (
      <AdminCard title="Where sign-ups come from" action={controls}>
        <ErrorState title="Couldn't load sign-up sources" onRetry={() => void q.refetch()} />
      </AdminCard>
    );
  }

  const rows = q.data ?? [];
  return (
    <AdminCard
      title="Where sign-ups come from"
      subtitle={`Last ${days} days · real members only · from the link they first opened`}
      action={controls}
    >
      <div data-testid="signup-sources">
        {q.isLoading ? (
          <p className="text-ds-14 text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-ds-14 text-muted-foreground">No sign-ups with a known source in this window yet.</p>
        ) : (
          <table className="w-full text-ds-14">
            <thead>
              <tr className="text-left text-ds-13 text-muted-foreground">
                <th scope="col" className="py-2 font-semibold">Source</th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold whitespace-nowrap">Sign-ups</th>
                <th scope="col" className="py-2 pl-3 text-right font-semibold whitespace-nowrap">First posts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={`${r.source}|${r.campaign ?? ""}`}>
                  <td className="py-2.5 min-w-0">
                    <span className="font-semibold text-foreground break-words">{sourceLabel(r.source)}</span>
                    {r.campaign && <span className="block text-ds-13 text-muted-foreground break-words">{r.campaign}</span>}
                  </td>
                  <td className="py-2.5 text-right tabular-nums">{r.signups}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.first_posts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </AdminCard>
  );
}
