import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { useFeedPhase } from "@/hooks/useFeedPhase";

export type SignupLead = {
  email: string;
  source: string | null;
  created_at: string;
  reminder_sent_at: string | null;
  completed_at: string | null;
  unsubscribed_at: string | null;
};

/** One word per lead: where it stands now. Completed wins over everything. */
export function leadStatus(l: SignupLead): "Signed up" | "Unsubscribed" | "Reminded" | "Waiting" {
  if (l.completed_at) return "Signed up";
  if (l.unsubscribed_at) return "Unsubscribed";
  if (l.reminder_sent_at) return "Reminded";
  return "Waiting";
}

/**
 * Sign-up leads (Q1587): the step-1 emails saved by record-signup-lead (owner
 * 2026-10-09, "Save it, follow up once"), how many were reminded and how many
 * went on to sign up. Read through admin_signup_leads(), admins only; the
 * table itself is service_role only.
 */
export function SignupLeadsCard() {
  const { data, isPending, isError, refetch, status, fetchStatus } = useQuery({
    queryKey: ["admin-signup-leads"],
    queryFn: async () => (unwrap(await supabase.rpc("admin_signup_leads")) ?? []) as SignupLead[],
    staleTime: 60_000,
  });

  // Q571: offline with nothing loaded says so, never the empty state.
  const offlineEmpty = useFeedPhase({ status, fetchStatus }) === "offline-empty";
  const leads = data ?? [];
  const reminded = leads.filter((l) => l.reminder_sent_at).length;
  const completed = leads.filter((l) => l.completed_at).length;

  return (
    <AdminCard
      title={
        <span className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-primary" /> Sign-up Leads
        </span>
      }
      subtitle="Emails saved at sign-up step 1, kept about 30 days"
    >
      {offlineEmpty ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="You're offline."
          body="The sign-up leads load when you're back online."
          onRetry={() => refetch()}
        />
      ) : isPending ? (
        <div className="space-y-2" aria-busy="true" data-testid="signup-leads-loading">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : isError ? (
        <ErrorState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          title="We couldn't load the sign-up leads."
          onRetry={() => refetch()}
        />
      ) : leads.length === 0 ? (
        <EmptyState
          surfaceStyle={NESTED_EMPTY_SURFACE}
          variant="inline"
          icon={Mail}
          title="No sign-up leads saved"
          body="An email lands here when someone finishes sign-up step 1."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-ds-13 text-foreground" data-testid="signup-leads-summary">
            <span className="font-semibold">{leads.length}</span> saved ·{" "}
            <span className="font-semibold">{reminded}</span> reminded ·{" "}
            <span className="font-semibold">{completed}</span> signed up
          </p>
          <ul className="divide-y divide-border/60">
            {leads.map((l) => (
              <li key={l.email} className="flex items-center justify-between gap-3 py-2 min-w-0">
                <div className="min-w-0">
                  <p className="text-ds-13 text-foreground truncate">{l.email}</p>
                  <p className="text-ds-11 text-muted-foreground">Saved {formatShortDate(l.created_at)}</p>
                </div>
                <span className="shrink-0 text-ds-11 font-medium text-muted-foreground">{leadStatus(l)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AdminCard>
  );
}
