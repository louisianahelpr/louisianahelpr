import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { Dialog, DialogContent, DialogHero } from "@/components/ui/dialog";
import { Building2, ChevronRight, Search, Users, ShieldCheck } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { formatTimestamp } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";

interface BusinessRow {
  business_id: string;
  business_name: string;
  owner_id: string;
  owner_name: string | null;
  owner_email: string | null;
  seat_tier: string | null;
  billing_mode: string | null;
  verification_status: string | null;
  member_count: number;
  total_gmv_cents: number;
  last_activity_at: string | null;
  created_at: string;
}

interface MemberRow {
  member_id: string;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
  role: string;
  status: string;
  joined_at: string | null;
}

const fmtCents = (cents: number | null | undefined) =>
  ((cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const fmtDate = (s: string | null) => (s ? formatTimestamp(s) : "Never");

/**
 * Admin-facing list of business accounts with team rosters + total GMV.
 * Backed by the admin_list_business_accounts RPC (gated on has_role('admin')
 * inside the RPC itself, but reached through the admin shell).
 *
 * Falls back gracefully on PGRST202 when the migration hasn't been
 * pushed yet — shows an empty-state with a hint about `supabase db push`.
 */
const AdminBusinessAccounts = () => {
  const [search, setSearch] = useState("");
  const [openBusiness, setOpenBusiness] = useState<BusinessRow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: queryKeys.adminBusiness.accounts(),
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_list_business_accounts");
      if (error) throw error;
      return (data ?? []) as BusinessRow[];
    },
  });

  const { data: members } = useQuery({
    queryKey: queryKeys.adminBusiness.members(openBusiness?.business_id ?? null),
    enabled: !!openBusiness,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("admin_list_business_members", {
        _business_id: openBusiness!.business_id,
      });
      if (error) throw error;
      return (data ?? []) as MemberRow[];
    },
  });

  const filtered = (data ?? []).filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      b.business_name.toLowerCase().includes(q) ||
      (b.owner_name ?? "").toLowerCase().includes(q) ||
      (b.owner_email ?? "").toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><HelprSpinner size={28} /></div>;
  }

  if (isError) {
    const code = (error as any)?.code;
    const isMissing = code === "PGRST202";
    return (
      <Card className="p-6 text-center">
        <Building2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="font-semibold mb-1">
          {isMissing ? "RPC not yet deployed" : "Couldn't load business accounts"}
        </p>
        <p className="text-ds-12 text-muted-foreground">
          {isMissing
            ? "Run `supabase db push` to apply migration 20260609180000_business_features."
            : (error as any)?.message || "Try again in a moment."}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search business accounts"
          placeholder="Search by name, owner, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No business accounts"
          body={search ? "No matches — try a different search." : "No accounts have signed up yet."}
        />
      ) : (
        <Card className="divide-y divide-border/40">
          {filtered.map((b) => (
            <button
              key={b.business_id}
              onClick={() => setOpenBusiness(b)}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-secondary/40 transition-colors"
            >
              <div className="w-10 h-10 rounded-ds-sm bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Building2 className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="font-semibold truncate">{b.business_name}</span>
                  {b.verification_status === "verified" && (
                    <Badge variant="secondary" className="text-ds-10 gap-1">
                      <ShieldCheck className="w-3 h-3" /> Verified
                    </Badge>
                  )}
                  {b.billing_mode === "invoice" && (
                    <Badge variant="outline" className="text-ds-10">Invoice</Badge>
                  )}
                </div>
                <p className="text-ds-11 text-muted-foreground truncate">
                  {b.owner_name ?? b.owner_email ?? b.owner_id.slice(0, 8)} ·{" "}
                  <Users className="w-3 h-3 inline" /> {b.member_count} ·{" "}
                  GMV {fmtCents(b.total_gmv_cents)} ·{" "}
                  {b.last_activity_at ? `Active ${fmtDate(b.last_activity_at)}` : "No activity yet"}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </Card>
      )}

      <Dialog open={!!openBusiness} onOpenChange={(open) => { if (!open) setOpenBusiness(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHero
            eyebrow={
              <>
                <Building2 className="w-3.5 h-3.5" /> Business account
              </>
            }
            eyebrowClassName="inline-flex items-center gap-1.5"
            title={openBusiness?.business_name}
          />
          {openBusiness && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-ds-12">
                <div>
                  <p className="text-muted-foreground">Owner</p>
                  <p className="font-semibold truncate">{openBusiness.owner_name ?? openBusiness.owner_email}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Total GMV</p>
                  <p className="font-semibold tabular-nums">{fmtCents(openBusiness.total_gmv_cents)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Seat tier</p>
                  <p className="font-semibold capitalize">{openBusiness.seat_tier ?? "starter"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Billing mode</p>
                  <p className="font-semibold capitalize">{openBusiness.billing_mode ?? "card"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Members</p>
                  <p className="font-semibold">{openBusiness.member_count}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Last activity</p>
                  <p className="font-semibold">{fmtDate(openBusiness.last_activity_at)}</p>
                </div>
              </div>

              <div>
                <p className="text-ds-12 font-semibold mb-2">Team roster</p>
                {members ? (
                  members.length === 0 ? (
                    <p className="text-ds-11 text-muted-foreground">No members.</p>
                  ) : (
                    <ul className="rounded-ds-sm border border-border divide-y divide-border/60">
                      {members.map((m) => (
                        <li key={m.member_id} className="flex items-center gap-2 p-2 text-ds-12">
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold truncate">{m.full_name ?? m.email ?? "—"}</p>
                            <p className="text-ds-11 text-muted-foreground truncate">{m.email}</p>
                          </div>
                          <Badge variant={m.role === "owner" ? "default" : "secondary"} className="text-ds-10 capitalize">{m.role}</Badge>
                          <Badge variant={m.status === "active" ? "outline" : "secondary"} className="text-ds-10 capitalize">{m.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  )
                ) : (
                  <div className="py-2 flex justify-center"><HelprSpinner size={16} /></div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminBusinessAccounts;
