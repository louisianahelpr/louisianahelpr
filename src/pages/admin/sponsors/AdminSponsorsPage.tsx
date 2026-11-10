/**
 * /admin/sponsors: the 25 Days of Louisiana Giveaways admin (owner spec
 * 2026-11-09, section 5). Admin only (ProtectedRoute + AdminRoute, and every
 * sponsor_admin_* function checks the admin role on the server), and dark
 * until the sponsor_25days switch is on for the admin (Testers or Everyone).
 *
 *   Calendar   sponsors under each day; status; move to another day; wall toggle
 *   Sign-ups   every detail, logo download, filter by day/status, CSV export
 *   Links      add a brand -> /sponsor?ref=<code> with a copy button; visits,
 *              first/last visit, signed up yes/no
 *   Add        add a sponsor by hand
 *   Content    reach stats, founder photo, per-day cap, testimonials (real only)
 */
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { useFeatureStatus } from "@/hooks/useFeature";
import { errorToast, successToast } from "@/lib/toast";
import { report } from "@/lib/errorLogger";
import { userFacingError } from "@/lib/userFacingError";
import { sponsorAdminBackend, type SponsorAdminBackend } from "./sponsorAdminApi";
import type { SponsorAdminData, SponsorAdminSignup, SponsorStatus } from "@/lib/sponsor/types";
import { sponsorPage as C } from "@/content/sponsorPage";
import { cleanDays, slugifyBrand } from "../../../../supabase/functions/_shared/sponsorSignup";

export const SPONSOR_STATUSES: Array<{ key: SponsorStatus; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "confirmed", label: "Confirmed" },
  { key: "prize_received", label: "Prize received" },
  { key: "posted", label: "Posted" },
];
const statusLabel = (s: SponsorStatus) => SPONSOR_STATUSES.find((x) => x.key === s)?.label ?? s;
const DAYS = Array.from({ length: 25 }, (_, i) => i + 1);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

/** The sign-ups as CSV, every column, one row per sign-up. Exported for its test. */
export function signupsCsv(rows: SponsorAdminSignup[]): string {
  const cols: Array<[string, (r: SponsorAdminSignup) => unknown]> = [
    ["Signed up", (r) => r.created_at], ["Brand", (r) => r.brand_name], ["Contact", (r) => r.contact_name], ["Email", (r) => r.email],
    ["Phone", (r) => r.phone], ["Website", (r) => r.website], ["Instagram", (r) => r.instagram], ["Facebook", (r) => r.facebook],
    ["TikTok", (r) => r.tiktok], ["Days", (r) => (r.any_day ? "Any day" : r.days.join(" "))], ["Prize", (r) => r.prize_description],
    ["Prize value ($)", (r) => r.prize_value], ["Ship to", (r) => (r.ship_to === "helpr" ? "Louisiana Helpr" : r.ship_to === "winner" ? "Winner" : "")],
    ["Status", (r) => statusLabel(r.status)], ["OK on wall", (r) => (r.wall_ok ? "yes" : "no")], ["Shown on wall", (r) => (r.show_on_wall ? "yes" : "no")],
    ["Has logo", (r) => (r.logo_path ? "yes" : "no")], ["Invite code", (r) => r.ref_code], ["Added by", (r) => r.source], ["Notes", (r) => r.notes],
  ];
  const cell = (v: unknown) => {
    let s = v == null ? "" : String(v);
    // A cell starting with = + - @ would run as a formula in a spreadsheet (CSV injection).
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(([h]) => cell(h)).join(","), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(","))].join("\r\n") + "\r\n";
}

function download(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Panel({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function StatusSelect({ value, onChange, label }: { value: SponsorStatus; onChange: (s: SponsorStatus) => void; label: string }) {
  return (
    <select aria-label={label} className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value as SponsorStatus)}>
      {SPONSOR_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  );
}

export default function AdminSponsorsPage() {
  const demo = import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo");
  const sw = useFeatureStatus("sponsor_25days");
  const allowed = demo || sw.on;
  const [tab, setTab] = useState("calendar");
  const qc = useQueryClient();
  const backendQ = useQuery({ queryKey: ["sponsor-25days", "backend"], queryFn: sponsorAdminBackend, staleTime: Infinity, meta: { persist: false } });
  const backend = backendQ.data as SponsorAdminBackend | undefined;
  const dataQ = useQuery({
    queryKey: ["sponsor-25days", "admin"],
    enabled: !!backend && allowed,
    queryFn: () => (backend as SponsorAdminBackend).overview(),
    meta: { persist: false },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sponsor-25days", "admin"] });
  const act = useMutation({
    mutationFn: async (fn: (b: SponsorAdminBackend) => Promise<unknown>) => fn(backend as SponsorAdminBackend),
    onSuccess: () => { void refresh(); },
    // The data layer already turned a refusal into plain words (ADMIN_RPC_ERROR_COPY).
    onError: (e: unknown) => errorToast("That change was not saved", { description: userFacingError(e, "Try again in a moment.") }),
  });

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader title="25 Days sponsors" backTo="/admin" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pb-10">
        {demo ? <p className="rounded-lg bg-black px-3 py-2 text-center text-xs font-bold tracking-wider text-yellow-300">LOCAL PREVIEW · SAMPLE DATA · NOT LIVE</p> : null}
        {!allowed && sw.settled ? (
          <Panel title="The 25 Days page is switched off">
            <p className="text-sm text-muted-foreground">
              Turn on the <strong>sponsor_25days</strong> switch in Admin → Settings → Hidden Feature Switches. Set it to Testers to set things up
              (only admins and test accounts see the page), then Everyone when you are ready for brands to see it.
            </p>
          </Panel>
        ) : null}
        {allowed && (dataQ.isPending || !backend) ? <p className="py-10 text-center text-muted-foreground" role="status">Loading…</p> : null}
        {allowed && dataQ.isError ? (
          <Panel title="Couldn't load sponsors">
            <Button onClick={() => void dataQ.refetch()}>Try again</Button>
          </Panel>
        ) : null}
        {allowed && dataQ.data && backend ? (
          <>
            <UnderlineTabs
              ariaLabel="Sponsor admin sections"
              value={tab}
              onChange={setTab}
              tabs={[
                { key: "calendar", label: "Calendar" },
                { key: "signups", label: "Sign-ups", count: dataQ.data.signups.length },
                { key: "links", label: "Links" },
                { key: "add", label: "Add sponsor" },
                { key: "content", label: "Page content" },
              ]}
            />
            {tab === "calendar" ? <CalendarView data={dataQ.data} run={(f) => act.mutate(f)} /> : null}
            {tab === "signups" ? <SignupsView data={dataQ.data} backend={backend} run={(f) => act.mutate(f)} /> : null}
            {tab === "links" ? <LinksView data={dataQ.data} run={(f) => act.mutateAsync(f)} /> : null}
            {tab === "add" ? <AddSponsorView run={(f) => act.mutateAsync(f)} onDone={() => setTab("calendar")} /> : null}
            {tab === "content" ? <ContentView data={dataQ.data} run={(f) => act.mutateAsync(f)} /> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

type Run = (fn: (b: SponsorAdminBackend) => Promise<unknown>) => void;
type RunAsync = (fn: (b: SponsorAdminBackend) => Promise<unknown>) => Promise<unknown>;

function CalendarView({ data, run }: { data: SponsorAdminData; run: Run }) {
  const anyDay = data.signups.filter((s) => s.any_day || s.days.length === 0);
  const SponsorChip = ({ s, day }: { s: SponsorAdminSignup; day: number | null }) => (
    <li className="rounded-xl border border-border bg-background p-2 text-sm">
      <div className="font-semibold">{s.brand_name}</div>
      <div className="text-xs text-muted-foreground">{s.prize_description} · ${s.prize_value}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusSelect label={`Status for ${s.brand_name}`} value={s.status} onChange={(st) => run((b) => b.setStatus(s.id, st))} />
        <select
          aria-label={`Move ${s.brand_name} to another day`}
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          value=""
          onChange={(e) => { const to = Number(e.target.value); if (to) run((b) => b.moveDay(s.id, day, to)); }}
        >
          <option value="">{day ? "Move to…" : "Set a day…"}</option>
          {DAYS.filter((d) => d !== day).map((d) => <option key={d} value={d}>Dec {d}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs" title={s.wall_ok ? "" : "The sponsor did not tick OK to show their logo"}>
          <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" checked={s.show_on_wall} disabled={!s.wall_ok} onChange={(e) => run((b) => b.setWall(s.id, e.target.checked))} />
          On wall{!s.wall_ok ? " (no OK)" : ""}
        </label>
      </div>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      {anyDay.length > 0 ? (
        <Panel title={`Any day is fine (${anyDay.length})`}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{anyDay.map((s) => <SponsorChip key={s.id} s={s} day={null} />)}</ul>
        </Panel>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {DAYS.map((d) => {
          const list = data.signups.filter((s) => s.days.includes(d));
          const cap = data.settings.max_per_day;
          return (
            <section key={d} className="rounded-2xl border border-border bg-card p-3 shadow-sm" aria-label={`December ${d}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-base font-bold">Dec {d}</h3>
                <span className="text-xs text-muted-foreground">{list.length}{cap ? ` / ${cap}` : ""}</span>
              </div>
              {list.length ? <ul className="flex flex-col gap-2">{list.map((s) => <SponsorChip key={s.id} s={s} day={d} />)}</ul> : <p className="text-xs text-muted-foreground">No sponsor yet</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function SignupsView({ data, backend, run }: { data: SponsorAdminData; backend: SponsorAdminBackend; run: Run }) {
  const [day, setDay] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const rows = useMemo(
    () => data.signups.filter((s) => (!day || (day === "any" ? s.any_day || s.days.length === 0 : s.days.includes(Number(day)))) && (!status || s.status === status)),
    [data.signups, day, status],
  );
  const getLogo = async (signupId: string) => {
    try {
      const url = await backend.logoDownloadUrl(signupId);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sponsor-logo-${signupId}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      report(e, { tags: { area: "sponsor_25days", action: "logo_download" } });
      errorToast("Couldn't get that logo", { description: userFacingError(e, "Try again in a moment.") });
    }
  };
  return (
    <Panel
      title={`Sign-ups (${rows.length})`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Filter by day" className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">All days</option>
            <option value="any">Any day</option>
            {DAYS.map((d) => <option key={d} value={d}>Dec {d}</option>)}
          </select>
          <select aria-label="Filter by status" className="h-9 rounded-lg border border-border bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {SPONSOR_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => download(`25-days-sponsors-${new Date().toISOString().slice(0, 10)}.csv`, signupsCsv(rows))}>Export CSV</Button>
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="text-xs uppercase text-muted-foreground">
            <tr>{["Brand", "Contact", "Days", "Prize", "Ship to", "Status", "Wall", "Logo", "Signed up"].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="border-t border-border align-top">
                <td className="px-2 py-2">
                  <div className="font-semibold">{s.brand_name}</div>
                  <div className="text-xs text-muted-foreground">{[s.website, s.instagram, s.facebook, s.tiktok].filter(Boolean).join(" · ")}</div>
                  {s.notes ? <div className="mt-1 text-xs italic">{s.notes}</div> : null}
                </td>
                <td className="px-2 py-2">{s.contact_name}<div className="text-xs"><a href={`mailto:${s.email}`}>{s.email}</a></div>{s.phone ? <div className="text-xs">{s.phone}</div> : null}</td>
                <td className="px-2 py-2">{s.any_day || s.days.length === 0 ? "Any day" : s.days.map((d) => `Dec ${d}`).join(", ")}</td>
                <td className="px-2 py-2">{s.prize_description}<div className="text-xs text-muted-foreground">${s.prize_value}</div></td>
                <td className="px-2 py-2">{s.ship_to === "helpr" ? "Louisiana Helpr" : s.ship_to === "winner" ? "Winner" : "—"}</td>
                <td className="px-2 py-2"><StatusSelect label={`Status for ${s.brand_name}`} value={s.status} onChange={(st) => run((b) => b.setStatus(s.id, st))} /></td>
                <td className="px-2 py-2">
                  <input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" aria-label={`Show ${s.brand_name} on the sponsor wall`} checked={s.show_on_wall} disabled={!s.wall_ok} onChange={(e) => run((b) => b.setWall(s.id, e.target.checked))} />
                  {!s.wall_ok ? <div className="text-ds-11 text-muted-foreground">no OK</div> : null}
                </td>
                <td className="px-2 py-2">{s.logo_path ? <Button size="sm" variant="outline" onClick={() => void getLogo(s.id)}>Download</Button> : "—"}</td>
                <td className="px-2 py-2 text-xs">{fmt(s.created_at)}{s.ref_code ? <div className="text-muted-foreground">via {s.ref_code}</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No sign-ups match.</p> : null}
      </div>
    </Panel>
  );
}

function LinksView({ data, run }: { data: SponsorAdminData; run: RunAsync }) {
  const [brand, setBrand] = useState("");
  const [email, setEmail] = useState("");
  const origin = C.links.website;
  const link = (code: string) => `${origin}/sponsor?ref=${code}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      successToast("Link copied");
    } catch {
      // Clipboard blocked (no permission / insecure context): the link is shown on screen to copy by hand.
      errorToast("Couldn't copy. Select the link and copy it by hand.");
    }
  };
  const add = async () => {
    if (!brand.trim()) return;
    const code = (await run((b) => b.addInvite(brand.trim(), email.trim() || null))) as string;
    setBrand("");
    setEmail("");
    if (code) void copy(link(code));
  };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Add a brand and get its link">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input aria-label="Brand name" placeholder="Brand name" value={brand} onChange={(e) => setBrand(e.target.value)} />
          <Input aria-label="Brand email (optional)" placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button onClick={() => void add()} disabled={!brand.trim()}>Create link</Button>
        </div>
        {brand.trim() ? <p className="mt-2 text-xs text-muted-foreground">Link will be like: {link(slugifyBrand(brand) || "brand")}</p> : null}
      </Panel>
      <Panel title={`Links (${data.invites.length})`} actions={<span className="text-xs text-muted-foreground">Visits with no link: {data.directVisits}</span>}>
        {/* Phone: one card per link, so the link and its Copy button are never cut off. */}
        <ul className="flex flex-col gap-3 sm:hidden">
          {data.invites.map((i) => (
            <li key={i.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="font-semibold">{i.brand}</div>
              {i.email ? <div className="text-xs text-muted-foreground">{i.email}</div> : null}
              <code className="mt-2 block break-all text-xs">{link(i.ref_code)}</code>
              <div className="mt-2 text-xs text-muted-foreground">
                {i.visits} visits · first {fmt(i.first_visit)} · last {fmt(i.last_visit)} · signed up: {i.signed_up ? "Yes" : "No"}
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => void copy(link(i.ref_code))}>Copy link</Button>
                <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete the link for ${i.brand}? Its visit history goes too.`)) void run((b) => b.deleteInvite(i.id)); }}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr>{["Brand", "Link", "Visits", "First visit", "Last visit", "Signed up", ""].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {data.invites.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-2 py-2 font-semibold">{i.brand}<div className="text-xs font-normal text-muted-foreground">{i.email ?? ""}</div></td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <code className="break-all text-xs">{link(i.ref_code)}</code>
                      <Button size="sm" variant="outline" onClick={() => void copy(link(i.ref_code))}>Copy</Button>
                    </div>
                  </td>
                  <td className="px-2 py-2">{i.visits}</td>
                  <td className="px-2 py-2 text-xs">{fmt(i.first_visit)}</td>
                  <td className="px-2 py-2 text-xs">{fmt(i.last_visit)}</td>
                  <td className="px-2 py-2">{i.signed_up ? <span className="font-semibold text-green-700">Yes</span> : "No"}</td>
                  <td className="px-2 py-2">
                    <Button size="sm" variant="outline" onClick={() => { if (window.confirm(`Delete the link for ${i.brand}? Its visit history goes too.`)) void run((b) => b.deleteInvite(i.id)); }}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function AddSponsorView({ run, onDone }: { run: RunAsync; onDone: () => void }) {
  const [f, setF] = useState({ brand_name: "", contact_name: "", email: "", prize_description: "", prize_value: "", days: "", any_day: false, wall_ok: false });
  const days = cleanDays(f.days.split(/[\s,]+/).filter(Boolean));
  const valid = f.brand_name.trim() && f.contact_name.trim() && f.email.includes("@") && f.prize_description.trim() && Number(f.prize_value) > 0 && days !== null && (f.any_day || days.length > 0);
  const save = async () => {
    if (!valid || days === null) return;
    await run((b) =>
      b.addSignup({
        brand_name: f.brand_name.trim(), contact_name: f.contact_name.trim(), email: f.email.trim(), phone: null, website: null, instagram: null,
        facebook: null, tiktok: null, prize_description: f.prize_description.trim(), prize_value: Math.round(Number(f.prize_value)), ship_to: null,
        notes: null, any_day: f.any_day && days.length === 0, status: "pending", show_on_wall: f.wall_ok, wall_ok: f.wall_ok, days,
      }),
    );
    successToast("Sponsor added");
    onDone();
  };
  const field = (key: keyof typeof f, label: string, type = "text") => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Input type={type} value={String(f[key])} onChange={(e) => setF((x) => ({ ...x, [key]: e.target.value }))} />
    </label>
  );
  return (
    <Panel title="Add a sponsor by hand">
      <div className="grid gap-3 sm:grid-cols-2">
        {field("brand_name", "Brand name")}
        {field("contact_name", "Contact name")}
        {field("email", "Email", "email")}
        {field("prize_value", "Prize value ($)")}
        <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
          Prize
          <Textarea value={f.prize_description} onChange={(e) => setF((x) => ({ ...x, prize_description: e.target.value }))} />
        </label>
        {field("days", "Days (e.g. 3, 12)")}
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" checked={f.any_day} onChange={(e) => setF((x) => ({ ...x, any_day: e.target.checked }))} /> Any day is fine</label>
          <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" checked={f.wall_ok} onChange={(e) => setF((x) => ({ ...x, wall_ok: e.target.checked }))} /> They said OK to show their logo</label>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">A sponsor added here skips the per-day cap and gets no emails.</p>
      <Button className="mt-3" onClick={() => void save()} disabled={!valid}>Add sponsor</Button>
    </Panel>
  );
}

function ContentView({ data, run }: { data: SponsorAdminData; run: RunAsync }) {
  const s = data.settings;
  const num = (v: number | null) => (v == null ? "" : String(v));
  const [form, setForm] = useState({ max: num(s.max_per_day), g: num(s.group_members), p: num(s.page_followers), m: num(s.monthly_visitors) });
  const parse = (v: string): number | null => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v.replace(/,/g, "")))));
  const [t, setT] = useState({ quote: "", name: "", brand: "" });
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Reach stats and cap">
        <p className="mb-3 text-xs text-muted-foreground">Only real numbers. A blank stat is hidden on the page. A blank cap means unlimited sponsors per day.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          {([["g", "Group members"], ["p", "Page followers"], ["m", "Monthly site visitors"], ["max", "Max sponsors per day"]] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1 text-sm font-medium">
              {label}
              <Input inputMode="numeric" value={form[k]} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value }))} />
            </label>
          ))}
        </div>
        <Button
          className="mt-3"
          onClick={() =>
            void run((b) => b.saveSettings({ max_per_day: parse(form.max) || null, group_members: parse(form.g), page_followers: parse(form.p), monthly_visitors: parse(form.m) })).then(() => successToast("Saved"))
          }
        >
          Save
        </Button>
      </Panel>
      <Panel title="Founder photo">
        <p className="mb-2 text-sm text-muted-foreground">{s.founder_photo_path ? "A photo is set." : "No photo yet: the page shows no photo frame until you add one."}</p>
        <input
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Upload founder photo"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { errorToast("That photo is over 5 MB."); return; }
            void run((b) => b.uploadFounderPhoto(file)).then(() => successToast("Photo saved"));
          }}
        />
      </Panel>
      <Panel title="Testimonials (real ones only)">
        <p className="mb-3 text-xs text-muted-foreground">Add only words a real sponsor actually sent you, with their OK. The section stays hidden until one is approved.</p>
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <Input aria-label="Quote" placeholder="Their words" value={t.quote} onChange={(e) => setT((x) => ({ ...x, quote: e.target.value }))} />
          <Input aria-label="Name" placeholder="Name" value={t.name} onChange={(e) => setT((x) => ({ ...x, name: e.target.value }))} />
          <Input aria-label="Brand" placeholder="Brand (optional)" value={t.brand} onChange={(e) => setT((x) => ({ ...x, brand: e.target.value }))} />
          <Button
            disabled={!t.quote.trim() || !t.name.trim()}
            onClick={() => void run((b) => b.saveTestimonial({ id: null, quote: t.quote.trim(), name: t.name.trim(), brand: t.brand.trim() || null, approved: false })).then(() => setT({ quote: "", name: "", brand: "" }))}
          >
            Add
          </Button>
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {data.testimonials.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2 text-sm">
              <span>“{x.quote}” — {x.name}{x.brand ? `, ${x.brand}` : ""}</span>
              <span className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="h-4 w-4 min-h-0 min-w-0 shrink-0" checked={x.approved} onChange={(e) => void run((b) => b.saveTestimonial({ ...x, approved: e.target.checked }))} /> Approved (shows on page)</label>
                <Button size="sm" variant="outline" onClick={() => void run((b) => b.deleteTestimonial(x.id))}>Delete</Button>
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
