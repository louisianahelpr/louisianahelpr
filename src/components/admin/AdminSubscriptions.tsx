import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Crown, Clock, Users, DollarSign } from "lucide-react";

interface SubscribedProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
}

const AdminSubscriptions = () => {
  const [profiles, setProfiles] = useState<SubscribedProfile[]>([]);
  const [allProfiles, setAllProfiles] = useState<SubscribedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expired">("all");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    // Get all profiles that have or had a subscription
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
      .not("subscription_tier", "is", null)
      .order("subscription_expires_at", { ascending: false, nullsFirst: false });

    // Also get profiles where tier is null but expires_at was set (expired)
    const { data: expiredData } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, subscription_tier, subscription_expires_at")
      .is("subscription_tier", null)
      .not("subscription_expires_at", "is", null);

    const all = [...(data || []), ...(expiredData || [])];
    setAllProfiles(all);
    setProfiles(all);
    setLoading(false);
  };

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

  if (loading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading subscription data…</div>;
  }

  const tierColor = (tier: string | null) => {
    switch (tier) {
      case "elite": return "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
      case "pro": return "bg-primary/10 text-primary";
      case "basic": return "bg-secondary text-secondary-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Active Subs</span>
            <Crown className="w-4 h-4 text-primary opacity-60" />
          </div>
          <p className="text-2xl font-bold text-foreground">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">Expired</span>
            <Clock className="w-4 h-4 text-muted-foreground opacity-60" />
          </div>
          <p className="text-2xl font-bold text-foreground">{expiredCount}</p>
        </div>
        {Object.entries(tierCounts).map(([tier, count]) => (
          <div key={tier} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground capitalize">{tier}</span>
              <Users className="w-4 h-4 text-primary opacity-60" />
            </div>
            <p className="text-2xl font-bold text-foreground">{count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or tier…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "active", "expired"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
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
            <div key={p.user_id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{p.full_name || "No name"}</p>
                <p className="text-xs text-muted-foreground">{p.email}</p>
              </div>
              <div className="flex items-center gap-2">
                {p.subscription_tier && (
                  <Badge className={`capitalize text-[10px] ${tierColor(p.subscription_tier)}`}>
                    {p.subscription_tier}
                  </Badge>
                )}
                <Badge variant={status === "active" ? "default" : "secondary"} className="text-[10px]">
                  {status === "active" ? "Active" : "Expired"}
                </Badge>
                {p.subscription_expires_at && (
                  <span className="text-[10px] text-muted-foreground">
                    {status === "active" ? "Expires" : "Expired"}{" "}
                    {new Date(p.subscription_expires_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No subscriptions found</p>
        )}
      </div>
    </div>
  );
};

export default AdminSubscriptions;
