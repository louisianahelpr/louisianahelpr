// Spend Dashboard — top-of-page summary + per-member breakdown.
//
// Reads the `business_spend_summary(p_business_id)` RPC (migration
// 20260609170000) for the per-member breakdown. The aggregate cards on
// top are derived from the same payload so we keep a single source of
// truth — when the RPC is missing (PGRST202 on prod before
// `supabase db push`), we render a graceful banner instead of a broken
// chart.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { DollarSign, Wallet, Lock, Hourglass, AlertCircle } from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";

interface SpendRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  posted_count: number;
  posted_amount: number;
  paid_amount: number;
  in_escrow_amount: number;
  pending_amount: number;
}

interface SpendDashboardTabProps {
  businessId: string;
  monthlyBudget?: number | null;
  monthlyBudgetAlertAt?: number | null;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export function SpendDashboardTab({
  businessId,
  monthlyBudget,
  monthlyBudgetAlertAt,
}: SpendDashboardTabProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["business-spend-summary", businessId],
    queryFn: async (): Promise<{ rows: SpendRow[]; rpcMissing: boolean }> => {
      const { data: raw, error: err } = await supabase.rpc("business_spend_summary" as any, {
        p_business_id: businessId,
      } as any);
      if (err) {
        // PGRST202 = function not found. Migration hasn't been pushed
        // to prod yet — render the empty-state instead of throwing.
        const code = (err as { code?: string }).code;
        if (code === "PGRST202") {
          return { rows: [], rpcMissing: true };
        }
        throw err;
      }
      return { rows: (raw as SpendRow[] | null) ?? [], rpcMissing: false };
    },
    enabled: !!businessId,
    staleTime: 30_000,
  });

  const rows = data?.rows ?? [];
  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => {
        acc.posted += Number(r.posted_amount) || 0;
        acc.paid += Number(r.paid_amount) || 0;
        acc.escrow += Number(r.in_escrow_amount) || 0;
        acc.pending += Number(r.pending_amount) || 0;
        return acc;
      },
      { posted: 0, paid: 0, escrow: 0, pending: 0 },
    );
  }, [rows]);

  const budgetPct = monthlyBudget && monthlyBudget > 0
    ? Math.min(100, Math.round((totals.posted / monthlyBudget) * 100))
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <HelprSpinner size={28} />
      </div>
    );
  }

  if (data?.rpcMissing) {
    return (
      <Card className="p-5 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--burnt-sienna))" }} />
        <div>
          <p className="font-medium">Spend dashboard rolling out</p>
          <p className="text-ds-11 text-muted-foreground mt-1">
            We're finishing the deployment. This will populate as soon as the upgrade lands —
            usually within a few minutes.
          </p>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-5">
        <p className="text-ds-13" style={{ color: "hsl(var(--burnt-sienna))" }}>
          Couldn't load spend data — try refreshing.
        </p>
      </Card>
    );
  }

  const chartData = rows.map((r) => ({
    name: (r.full_name || r.email || "Member").split(" ")[0] || "Member",
    Posted: Number(r.posted_amount) || 0,
    Paid: Number(r.paid_amount) || 0,
    Escrow: Number(r.in_escrow_amount) || 0,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SpendStat icon={DollarSign} label="Posted (MTD)" value={fmt(totals.posted)} />
        <SpendStat icon={Wallet} label="Paid out" value={fmt(totals.paid)} />
        <SpendStat icon={Lock} label="In escrow" value={fmt(totals.escrow)} />
        <SpendStat icon={Hourglass} label="Pending" value={fmt(totals.pending)} />
      </div>

      {monthlyBudget && monthlyBudget > 0 && budgetPct !== null && (
        <Card className="p-4">
          <div className="flex items-center justify-between text-ds-13 mb-2">
            <span className="font-medium">Monthly budget</span>
            <span className="text-muted-foreground">
              {fmt(totals.posted)} / {fmt(monthlyBudget)} · {budgetPct}%
            </span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ background: "hsl(var(--olivewood) / 0.12)" }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${budgetPct}%`,
                background:
                  monthlyBudgetAlertAt && budgetPct >= monthlyBudgetAlertAt * 100
                    ? "hsl(var(--burnt-sienna))"
                    : "hsl(var(--bark))",
              }}
            />
          </div>
        </Card>
      )}

      {chartData.length > 0 ? (
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Spend by team member</h3>
          <div style={{ width: "100%", height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Legend />
                <Bar dataKey="Posted" fill="hsl(var(--bark))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Paid" fill="hsl(var(--olivewood))" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Escrow" fill="hsl(var(--gold-warm))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-ds-13 text-muted-foreground">
            No spend yet this month. Once your team starts posting, this dashboard will populate.
          </p>
        </Card>
      )}
    </div>
  );
}

function SpendStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="w-3.5 h-3.5" />
        <span className="text-ds-10 uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-display text-ds-17 mt-1 leading-tight">{value}</p>
    </Card>
  );
}

export default SpendDashboardTab;
