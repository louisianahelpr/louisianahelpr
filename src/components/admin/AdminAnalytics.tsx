import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Users, Briefcase, DollarSign, TrendingUp } from "lucide-react";

const AdminAnalytics = () => {
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalCustomers: 0,
    totalHelpers: 0,
    totalJobs: 0,
    openJobs: 0,
    completedJobs: 0,
    totalRevenue: 0,
    totalFees: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const [profilesRes, jobsRes] = await Promise.all([
        supabase.from("profiles").select("role"),
        supabase.from("jobs").select("status, budget, payment_status, platform_fee_amount"),
      ]);

      const profiles = profilesRes.data || [];
      const jobs = jobsRes.data || [];

      const completedJobs = jobs.filter((j) => j.status === "completed");

      setStats({
        totalUsers: profiles.length,
        totalCustomers: profiles.filter((p) => p.role === "customer").length,
        totalHelpers: profiles.filter((p) => p.role === "helper").length,
        totalJobs: jobs.length,
        openJobs: jobs.filter((j) => j.status === "open").length,
        completedJobs: completedJobs.length,
        totalRevenue: completedJobs.reduce((sum, j) => sum + (j.budget || 0), 0),
        totalFees: completedJobs.reduce((sum, j) => sum + (j.platform_fee_amount || 0), 0),
      });
      setLoading(false);
    };
    load();
  }, []);

  if (loading) return <p className="text-muted-foreground">Loading analytics…</p>;

  const cards = [
    { label: "Total Users", value: stats.totalUsers, sub: `${stats.totalCustomers} customers · ${stats.totalHelpers} helpers`, icon: Users, color: "text-primary" },
    { label: "Total Jobs", value: stats.totalJobs, sub: `${stats.openJobs} open · ${stats.completedJobs} completed`, icon: Briefcase, color: "text-primary" },
    { label: "Total Revenue", value: `$${stats.totalRevenue.toFixed(2)}`, sub: "From all paid jobs", icon: DollarSign, color: "text-primary" },
    { label: "Platform Fees", value: `$${stats.totalFees.toFixed(2)}`, sub: "Helpr's earnings", icon: TrendingUp, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-display font-bold text-foreground">Analytics</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{card.label}</span>
              <card.icon className={`w-5 h-5 ${card.color}`} />
            </div>
            <p className="text-2xl font-bold text-foreground">{card.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminAnalytics;
