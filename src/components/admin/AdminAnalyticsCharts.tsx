// Recharts-heavy chart components extracted from AdminAnalytics so the
// recharts library (~250 KB pre-gzip) lands in a separately-loadable chunk.
// Importing this file is what pulls recharts in — the parent uses React.lazy
// to keep recharts off the AdminAnalytics initial-paint critical path.
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart as RePieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend,
} from "recharts";

interface SubPieDatum {
  value: number;
  name: string;
  color: string;
}

interface MonthlyDatum {
  month: string;
  revenue: number;
  fees: number;
  signups: number;
  jobs: number;
}

interface CategoryDatum {
  name: string;
  count: number;
  revenue: number;
}

/**
 * Recharts colours a legend LABEL with its series colour. That is fine until a
 * series is painted in a token that was never meant to be read: "New Users"
 * used `--secondary`, which is `--sand`, a SURFACE token — #e2e4e9 in light and
 * #373b43 in dark, i.e. near-invisible against the chart in both themes. The
 * legend text measured 1.27:1 light and 1.45:1 dark against the 4.5:1 it needs.
 *
 * Two fixes, because there were two bugs stacked on each other. The series
 * colour is corrected below, and this formatter pins every legend LABEL to
 * `--foreground` so no future series colour can make its own label unreadable
 * again. The swatch keeps the series colour, which is the part of a legend that
 * actually has to match the line.
 */
const legendLabel = (value: string) => (
  <span style={{ color: "hsl(var(--foreground))", fontSize: 12 }}>{value}</span>
);

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export const SubscriberPieChart = ({ data }: { data: SubPieDatum[] }) => (
  <ResponsiveContainer width="100%" height="100%" minHeight={180}>
    <RePieChart>
      <Pie data={data} cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={3} dataKey="value">
        {data.map((entry, index) => (
          <Cell key={index} fill={entry.color} />
        ))}
      </Pie>
      <Tooltip formatter={(value, name) => [`${value} helper${Number(value) === 1 ? "" : "s"}`, name as string]} />
      <Legend formatter={legendLabel} />
    </RePieChart>
  </ResponsiveContainer>
);

export const RevenueLineChart = ({ data }: { data: MonthlyDatum[] }) => (
  <ResponsiveContainer width="100%" height="100%" minHeight={250}>
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
      <Tooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "hsl(var(--foreground))" }} />
      <Legend formatter={legendLabel} />
      <Line type="monotone" dataKey="revenue" name="Revenue ($)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
      <Line type="monotone" dataKey="fees" name="Profit ($)" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 4 }} />
      {/* --stormy-sky, not --secondary. --secondary is --sand, a surface
          token: as a 2px line it was invisible against the chart in both
          themes, so this series had no readable line AND no readable legend
          label. --stormy-sky is a real mid-tone in both themes (198 12% 36%
          light / 198 14% 65% dark) and is a distinct hue from the bark green
          and burnt-sienna rust of the other two series. */}
      <Line type="monotone" dataKey="signups" name="New Users" stroke="hsl(var(--stormy-sky))" strokeWidth={2} dot={{ r: 4 }} />
    </LineChart>
  </ResponsiveContainer>
);

export const MonthlyJobsBarChart = ({ data }: { data: MonthlyDatum[] }) => (
  <ResponsiveContainer width="100%" height="100%" minHeight={200}>
    <BarChart data={data}>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Bar dataKey="jobs" name="Completed Jobs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
    </BarChart>
  </ResponsiveContainer>
);

export const CategoriesBarChart = ({ data }: { data: CategoryDatum[] }) => (
  <ResponsiveContainer width="100%" height="100%" minHeight={250}>
    <BarChart data={data} layout="vertical">
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
      <XAxis type="number" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
      <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" width={90} />
      <Tooltip contentStyle={TOOLTIP_STYLE} />
      <Bar dataKey="count" name="Jobs" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
    </BarChart>
  </ResponsiveContainer>
);
