import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Crown, Clock, Users } from "lucide-react";
import { tierDisplayName } from "@/lib/subscriptionTiers";
import { useInstantQuery } from "@/hooks/useInstantQuery";
import { formatShortDate } from "@/lib/format";
import { EmptyState } from "@/components/ui/EmptyState";
import { AdminViewShell, AdminCard } from "@/components/admin/AdminViewShell";
import { NESTED_EMPTY_SURFACE } from "@/components/admin/adminEmptyState";

interface SubscribedProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
}

const AdminSubscriptions = () => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expired">("all");

  const { data: allProfiles, isInitialLoading } = useInstantQuery<SubscribedProfile[]>({
    key: ["admin-subscriptions"],
    fallback: [],
    fetcher: async () => {
      const data = unwrap(await supabase
        .from("profiles")
        .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
        .not("subscription_tier", "is", null)
        .order("subscription_expires_at", { ascending: false, nullsFirst: false }));

      const expiredData = unwrap(await supabase
        .from("profiles")
        .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
        .is("subscription_tier", null)
        .not("subscription_expires_at", "is", null));

      return [...(data || []), ...(expiredData || [])];
    },
  });

  const now = new Date();

  const getStatus = (p: SubscribedProfile) => {
    if (!p.subscription_tier) return "expired";
    if (p.subscription_expires_at && new Date(p.subscription_expires_at) < now) return "expired";
    return "active";
  };

  const filtered = allProfiles.filter(p => {
    const status = getStatus(p);
    if (filter === "active" && status !== "active") return false;
    if (filter === "expired" && status !== "expired") return false;
    if (search) {
      const q = search.toLowerCase();
      return (p.full_name || "").toLowerCase().includes(q) ||
        (p.email || "").toLowerCase().includes(q) ||
        (p.subscription_tier || "").toLowerCase().includes(q);
    }
    return true;
  });

  const activeCount = allProfiles.filter(p => getStatus(p) === "active").length;
  const expiredCount = allProfiles.filter(p => getStatus(p) === "expired").length;
  const tierCounts: Record<string, number> = {};
  allProfiles.filter(p => getStatus(p) === "active").forEach(p => {
    const t = p.subscription_tier || "unknown";
    tierCounts[t] = (tierCounts[t] || 0) + 1;
  });

  if (isInitialLoading) {
    return <div className="text-center py-12 text-ds-11 text-muted-foreground">Loading subscription data…</div>;
  }

  const tierColor = (tier: string | null) => {
    switch (tier) {
      // intentional: Elite tier is a brand/premium gold chip, not a
      // semantic status tone — see AdminHelperTiers for the same rule.
      case "elite": return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
      case "plus": return "bg-primary/20 text-primary";
      case "pro": return "bg-primary/10 text-primary";
      case "basic": return "bg-secondary text-secondary-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <AdminViewShell>
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-ds-11 text-muted-foreground">Active Subs</span>
            <Crown className="w-4 h-4 text-primary opacity-60" />
          </div>
          <p className="text-ds-24 font-bold text-foreground">{activeCount}</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-ds-11 text-muted-foreground">Expired</span>
            <Clock className="w-4 h-4 text-muted-foreground opacity-60" />
          </div>
          <p className="text-ds-24 font-bold text-foreground">{expiredCount}</p>
        </div>
        {Object.entries(tierCounts).map(([tier, count]) => (
          <div key={tier} className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-ds-11 text-muted-foreground">{tierDisplayName(tier)}</span>
              <Users className="w-4 h-4 text-primary opacity-60" />
            </div>
            <p className="text-ds-24 font-bold text-foreground">{count}</p>
          </div>
        ))}
      </div>

      {/* Filters + list in one card: the search box and the status chips
          scope the list directly beneath them, and were previously three
          unrelated blocks stacked on the bare page. */}
      <AdminCard
        title="Subscribers"
        contentClassName="space-y-4"
      >
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search subscriptions by name, email, or tier"
            placeholder="Search by name, email, or tier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div role="group" aria-label="Filter by subscription status" className="flex gap-1 shrink-0">
          {(["all", "active", "expired"] as const).map(f => (
            <button
              key={f}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-2 text-ds-13 rounded-ds-sm transition-colors ${
                filter === f
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="space-y-2">
        {filtered.map(p => {
          const status = getStatus(p);
          return (
            <div key={p.user_id} className="rounded-ds-md border border-border/60 bg-background/40 p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-ds-13 font-medium text-foreground">{p.full_name || "No name"}</p>
                <p className="text-ds-11 text-muted-foreground">{p.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {p.subscription_tier && (
                  <Badge className={`text-ds-10 ${tierColor(p.subscription_tier)}`}>
                    {tierDisplayName(p.subscription_tier)}
                  </Badge>
                )}
                <Badge variant={status === "active" ? "default" : "secondary"} className="text-ds-10">
                  {status === "active" ? "Active" : "Expired"}
                </Badge>
                {p.subscription_expires_at && (
                  <span className="text-muted-foreground text-ds-11">
                    {status === "active" ? "Expires" : "Expired"}{" "}
                    {formatShortDate(p.subscription_expires_at)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <EmptyState
            surfaceStyle={NESTED_EMPTY_SURFACE}
            variant="inline"
            icon={Crown}
            title="No subscriptions found"
            body="Nothing matches the current filter."
          />
        )}
      </div>
      </AdminCard>
    </AdminViewShell>
  );
};

export default AdminSubscriptions;
