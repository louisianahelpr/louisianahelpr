import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { formatShortDate } from "@/lib/format";
import { AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { cn } from "@/lib/utils";

/**
 * Sign-up leads (Q1587, owner 2026-10-11): the emails saved at sign-up step 1
 * (public.signup_leads, migration 20261009223714), which of them got the one
 * reminder, and which went on to finish signing up. Read through
 * admin_list_signup_leads() (20261012030524), an admin-only SECURITY DEFINER
 * read; the table itself stays service_role only.
 */
type SignupLead = {
  email: string;
  created_at: string;
  reminder_sent_at: string | null;
  completed_at: string | null;
  total_count: number;
};

type LeadsLoad = { unavailable: true } | { unavailable: false; rows: SignupLead[] };

/** Rows shown before "Show all". */
const LEADS_PREVIEW = 10;

const signupLeadsQueryKey = ["admin", "signup-leads"] as const;

async function loadSignupLeads(): Promise<LeadsLoad> {
  const res = await supabase.rpc("admin_list_signup_leads");
  // PGRST202: the function is not deployed yet (db-deploy lag after merge).
  // Said on the card, never shown as "no leads".
  if (res.error && (res.error as { code?: string }).code === "PGRST202") return { unavailable: true };
  return { unavailable: false, rows: (unwrap(res) ?? []) as SignupLead[] };
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2">
      <p className="font-mono text-ds-18 font-semibold tabular-nums text-foreground leading-none">{value}</p>
      <p className="mt-1 text-ds-11 text-muted-foreground">{label}</p>
    </div>
  );
}

function LeadRow({ lead }: { lead: SignupLead }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <p className="text-ds-13 font-medium text-foreground break-all">{lead.email}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-ds-11 text-muted-foreground tabular-nums">
        <span>Saved {formatShortDate(lead.created_at)}</span>
        <span>{lead.reminder_sent_at ? `Reminded ${formatShortDate(lead.reminder_sent_at)}` : "Not reminded"}</span>
        <span className={cn(lead.completed_at && "text-primary font-medium")}>
          {lead.completed_at ? `Completed ${formatShortDate(lead.completed_at)}` : "Not completed"}
        </span>
      </p>
    </li>
  );
}

export function SignupLeadsCard() {
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: signupLeadsQueryKey, queryFn: loadSignupLeads, staleTime: 60_000 });
  const title = (
    <span className="flex items-center gap-2">
      <Mail className="w-4 h-4 text-primary" /> Sign-up leads
    </span>
  );
  const subtitle = "Emails saved at sign-up step 1, the one reminder, and who finished";

  if (q.isPending) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <div className="flex justify-center py-6" role="status" aria-label="Loading sign-up leads">
          <HelprSpinner size={20} />
        </div>
      </AdminCard>
    );
  }
  if (q.isError) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <ErrorState
          variant="inline"
          title="Couldn't load sign-up leads"
          body="Check your connection and try again."
          onRetry={() => void q.refetch()}
          surfaceStyle={NESTED_EMPTY_SURFACE}
        />
      </AdminCard>
    );
  }
  if (q.data.unavailable) {
    return (
      <AdminCard title={title} subtitle={subtitle}>
        <p className="text-ds-13 text-muted-foreground">
          Not available yet: the lead list starts working once its database update finishes deploying.
        </p>
      </AdminCard>
    );
  }

  const rows = q.data.rows;
  const total = rows[0]?.total_count ?? 0;
  const reminded = rows.filter((r) => r.reminder_sent_at).length;
  const completed = rows.filter((r) => r.completed_at).length;
  const shown = showAll ? rows : rows.slice(0, LEADS_PREVIEW);

  return (
    <AdminCard title={title} subtitle={subtitle}>
      <div className="grid grid-cols-3 gap-2">
        <Stat label={total === 1 ? "Lead" : "Leads"} value={Number(total)} />
        <Stat label="Reminded" value={reminded} />
        <Stat label="Completed" value={completed} />
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={Mail}
          variant="inline"
          title="No sign-up leads yet"
          body="An email typed at sign-up step 1 shows here, with its reminder and whether the person finished."
          surfaceStyle={NESTED_EMPTY_SURFACE}
        />
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border/60">
            {shown.map((lead) => (
              <LeadRow key={lead.email} lead={lead} />
            ))}
          </ul>
          {rows.length > LEADS_PREVIEW && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-3 min-h-[44px] text-ds-13 font-medium text-primary hover:underline"
            >
              {showAll ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
          {Number(total) > rows.length && (
            <p className="mt-2 text-ds-11 text-muted-foreground">
              Showing the newest {rows.length} of {Number(total)}.
            </p>
          )}
        </>
      )}
    </AdminCard>
  );
}
