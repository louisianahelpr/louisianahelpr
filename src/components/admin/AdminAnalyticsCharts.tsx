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
      <Legend />
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
      <Legend />
      <Line type="monotone" dataKey="revenue" name="Revenue ($)" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
      <Line type="monotone" dataKey="fees" name="Profit ($)" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 4 }} />
      <Line type="monotone" dataKey="signups" name="New Users" stroke="hsl(var(--secondary))" strokeWidth={2} dot={{ r: 4 }} />
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
