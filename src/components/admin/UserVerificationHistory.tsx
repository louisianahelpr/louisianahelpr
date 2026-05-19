import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { History, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { formatName } from "@/lib/utils";

interface VerificationRow {
  id: string;
  changed_at: string;
  changed_by: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  approval_status: "Approval status",
  idv_status: "Stripe IDV status",
  idv_confidence: "IDV confidence",
  idv_failure_reason: "IDV failure reason",
  idv_session_id: "IDV session id",
  legacy_manual_review: "Manual review override",
};

const renderValue = (field: string, value: string | null): string => {
  if (value === null) return "—";
  if (field === "idv_session_id") return value.slice(-8); // truncate for display
  return value;
};

const UserVerificationHistory = ({ userId }: { userId: string }) => {
  // Pull the last 25 verification-field changes for this user. Cast via
  // `as any`: helper_verifications is in a recent migration not yet in
  // generated client types. RLS already allows admins to read all rows
  // and users to read their own.
  const { data: rows = [], isLoading } = useQuery<VerificationRow[]>({
    queryKey: ["helper-verifications", userId],
    queryFn: async () => {
      const { data, error } = await supabase.from("helper_verifications")
        .select("id, changed_at, changed_by, field, old_value, new_value")
        .eq("user_id", userId)
        .order("changed_at", { ascending: false })
        .limit(25);
      if (error) {
        // Don't surface as a toast — the panel just shows empty if it fails.
        return [];
      }
      return (data ?? []) as VerificationRow[];
    },
    staleTime: 60_000,
  });

  // Resolve actor names in a single batched fetch.
  const actorIds = [...new Set(rows.map((r) => r.changed_by).filter((id): id is string => !!id))];
  const { data: actors = new Map<string, string>() } = useQuery({
    queryKey: ["helper-verifications-actors", actorIds.sort().join(",")],
    enabled: actorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", actorIds);
      if (error) {
        console.error("[UserVerificationHistory] failed to load actor profiles:", error);
        return new Map<string, string>();
      }
      return new Map((data ?? []).map((p) => [p.user_id, formatName(p.full_name, "Unknown")]));
    },
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> Verification History
        </h4>
        <p className="text-ds-11 text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" /> Verification History
        </h4>
        <p className="text-ds-11 text-muted-foreground">No changes logged yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-ds-11 sm:text-ds-13 font-semibold text-foreground uppercase tracking-wide flex items-center gap-1.5">
        <History className="w-3.5 h-3.5" /> Verification History
        <span className="ml-1 text-ds-10 font-normal text-muted-foreground">
          (last {rows.length})
        </span>
      </h4>
      <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
        {rows.map((r) => {
          const actorName = r.changed_by
            ? (actors.get(r.changed_by) ?? "Unknown admin")
            : "system";
          const isSystem = !r.changed_by;
          return (
            <div key={r.id} className="rounded-ds-sm border border-border/50 bg-card/40 p-2 text-ds-11">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-medium text-foreground">
                  {FIELD_LABEL[r.field] ?? r.field}
                </span>
                <span className="text-ds-10 text-muted-foreground">
                  {formatDistanceToNow(new Date(r.changed_at), { addSuffix: true })}
                </span>
              </div>
              <div className="text-muted-foreground mt-0.5 break-words">
                <span className="opacity-70">{renderValue(r.field, r.old_value)}</span>
                <span className="mx-1.5">→</span>
                <span className="text-foreground">{renderValue(r.field, r.new_value)}</span>
              </div>
              <div className="text-ds-10 text-muted-foreground mt-0.5 flex items-center gap-1">
                <User className="w-2.5 h-2.5" />
                <span className={isSystem ? "italic" : ""}>{actorName}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default UserVerificationHistory;
