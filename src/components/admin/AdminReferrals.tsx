import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Gift, Users, DollarSign, Banknote, Copy } from "lucide-react";
import { toast } from "sonner";

interface ReferralCode {
  id: string;
  code: string;
  user_id: string;
  created_at: string;
  userName?: string;
}

interface Referral {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code_id: string;
  created_at: string;
  referrerName?: string;
  referredName?: string;
}

interface ReferralCredit {
  id: string;
  user_id: string;
  amount: number;
  reason: string;
  redeemed: boolean;
  created_at: string;
  referred_user_id: string | null;
  referral_code_id: string | null;
  userName?: string;
}

const AdminReferrals = () => {
  const [codes, setCodes] = useState<ReferralCode[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [credits, setCredits] = useState<ReferralCredit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"overview" | "codes" | "referrals" | "credits">("overview");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [codesRes, referralsRes, creditsRes] = await Promise.all([
      supabase.from("referral_codes").select("*").order("created_at", { ascending: false }),
      supabase.from("referrals").select("*").order("created_at", { ascending: false }),
      supabase.from("referral_credits").select("*").order("created_at", { ascending: false }),
    ]);

    const allCodes = codesRes.data || [];
    const allReferrals = referralsRes.data || [];
    const allCredits = creditsRes.data || [];

    // Gather all unique user IDs for name resolution
    const userIds = new Set<string>();
    allCodes.forEach(c => userIds.add(c.user_id));
    allReferrals.forEach(r => { userIds.add(r.referrer_id); userIds.add(r.referred_id); });
    allCredits.forEach(c => { userIds.add(c.user_id); if (c.referred_user_id) userIds.add(c.referred_user_id); });

    const idsArray = Array.from(userIds);
    const nameMap: Record<string, string> = {};

    // Batch fetch profiles
    if (idsArray.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", idsArray);
      (profiles || []).forEach(p => {
        nameMap[p.user_id] = p.full_name || p.email || p.user_id.slice(0, 8);
      });
    }

    setCodes(allCodes.map(c => ({ ...c, userName: nameMap[c.user_id] || c.user_id.slice(0, 8) })));
    setReferrals(allReferrals.map(r => ({
      ...r,
      referrerName: nameMap[r.referrer_id] || r.referrer_id.slice(0, 8),
      referredName: nameMap[r.referred_id] || r.referred_id.slice(0, 8),
    })));
    setCredits(allCredits.map(c => ({
      ...c,
      userName: nameMap[c.user_id] || c.user_id.slice(0, 8),
    })));
    setLoading(false);
  };

  const totalEarned = credits.reduce((s, c) => s + Number(c.amount), 0);
  const totalCashedOut = credits.filter(c => c.redeemed).reduce((s, c) => s + Number(c.amount), 0);
  const totalAvailable = totalEarned - totalCashedOut;

  const filteredCodes = codes.filter(c =>
    !search || c.code.toLowerCase().includes(search.toLowerCase()) ||
    (c.userName || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredReferrals = referrals.filter(r =>
    !search || (r.referrerName || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.referredName || "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredCredits = credits.filter(c =>
    !search || (c.userName || "").toLowerCase().includes(search.toLowerCase()) ||
    c.reason.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return <div className="text-center py-12 text-sm text-muted-foreground">Loading referral data…</div>;
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "codes" as const, label: `Codes (${codes.length})` },
    { id: "referrals" as const, label: `Referrals (${referrals.length})` },
    { id: "credits" as const, label: `Credits (${credits.length})` },
  ];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Codes", value: codes.length, icon: Gift },
          { label: "Successful Referrals", value: referrals.length, icon: Users },
          { label: "Total Earned", value: `$${totalEarned.toFixed(2)}`, icon: DollarSign },
          { label: "Cashed Out", value: `$${totalCashedOut.toFixed(2)}`, icon: Banknote },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{stat.label}</span>
              <stat.icon className="w-4 h-4 text-primary opacity-60" />
            </div>
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== "overview" && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      )}

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Program Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Users with codes</p>
                <p className="font-semibold text-foreground">{codes.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Successful referrals</p>
                <p className="font-semibold text-foreground">{referrals.length}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits awarded</p>
                <p className="font-semibold text-foreground">${totalEarned.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits available</p>
                <p className="font-semibold text-primary">${totalAvailable.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Credits cashed out</p>
                <p className="font-semibold text-foreground">${totalCashedOut.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Conversion rate</p>
                <p className="font-semibold text-foreground">
                  {codes.length > 0 ? ((referrals.length / codes.length) * 100).toFixed(1) : 0}%
                </p>
              </div>
            </div>
          </div>

          {/* Recent activity */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Recent Credits</h3>
            {credits.slice(0, 5).map(c => (
              <div key={c.id} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
                <div>
                  <p className="font-medium text-foreground">{c.userName}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.reason === "referrer_bonus" ? "Referral bonus" : "First job bonus"} · {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-primary">+${Number(c.amount).toFixed(2)}</p>
                  <Badge variant={c.redeemed ? "secondary" : "default"} className="text-[10px]">
                    {c.redeemed ? "Cashed out" : "Available"}
                  </Badge>
                </div>
              </div>
            ))}
            {credits.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No credits awarded yet</p>
            )}
          </div>
        </div>
      )}

      {/* Codes Tab */}
      {tab === "codes" && (
        <div className="space-y-2">
          {filteredCodes.map(c => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{c.userName}</p>
                <p className="text-xs text-muted-foreground">Created {new Date(c.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-primary tracking-widest">{c.code}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(c.code); toast.success("Code copied"); }}
                  className="p-1 rounded hover:bg-secondary/50 transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}
          {filteredCodes.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No referral codes found</p>
          )}
        </div>
      )}

      {/* Referrals Tab */}
      {tab === "referrals" && (
        <div className="space-y-2">
          {filteredReferrals.map(r => (
            <div key={r.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    <span className="text-primary">{r.referrerName}</span>
                    <span className="text-muted-foreground mx-2">→</span>
                    <span>{r.referredName}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Referred on {new Date(r.created_at).toLocaleDateString()}
                  </p>
                </div>
                {credits.some(c => c.referred_user_id === r.referred_id || c.referred_user_id === r.referrer_id) ? (
                  <Badge variant="default" className="text-[10px]">Bonus earned</Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">Awaiting first job</Badge>
                )}
              </div>
            </div>
          ))}
          {filteredReferrals.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No referrals found</p>
          )}
        </div>
      )}

      {/* Credits Tab */}
      {tab === "credits" && (
        <div className="space-y-2">
          {filteredCredits.map(c => (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{c.userName}</p>
                <p className="text-xs text-muted-foreground">
                  {c.reason === "referrer_bonus" ? "Referral bonus" : "First job bonus"} · {new Date(c.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-primary">+${Number(c.amount).toFixed(2)}</p>
                <Badge variant={c.redeemed ? "secondary" : "default"} className="text-[10px]">
                  {c.redeemed ? "Cashed out" : "Available"}
                </Badge>
              </div>
            </div>
          ))}
          {filteredCredits.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No credits found</p>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminReferrals;
