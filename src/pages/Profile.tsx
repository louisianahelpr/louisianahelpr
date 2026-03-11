import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft, DollarSign, TrendingUp, Gift, Briefcase, LogOut,
  ChevronLeft, ChevronRight, MapPin, Clock, Calendar, Filter,
  CreditCard, Shield, FileText, ExternalLink, Mail, Lock, ImagePlus, X, Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type Tab = "profile" | "earnings" | "schedule" | "history" | "payment" | "legal";

const statusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary",
  accepted: "bg-accent/20 text-accent-foreground",
  in_progress: "bg-accent/20 text-accent-foreground",
  revision_requested: "bg-destructive/10 text-destructive",
  completed: "bg-secondary text-secondary-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

const scheduleStatusColors: Record<string, string> = {
  open: "bg-primary/10 text-primary border-primary/20",
  accepted: "bg-accent/20 text-accent-foreground border-accent/30",
  in_progress: "bg-accent/20 text-accent-foreground border-accent/30",
  completed: "bg-secondary text-secondary-foreground border-border",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

type HistoryTab = "all" | "posted" | "worked";
type StatusFilter = "all" | "open" | "in_progress" | "completed" | "cancelled";

const ProfilePage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");

  // Profile fields
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  // Earnings state
  const [earningsJobs, setEarningsJobs] = useState<Job[]>([]);
  const [tips, setTips] = useState<{ amount: number; job_id: string; created_at: string }[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

  // Schedule state
  const [schedulePostedJobs, setSchedulePostedJobs] = useState<Job[]>([]);
  const [scheduleAssignedJobs, setScheduleAssignedJobs] = useState<Job[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // History state
  const [histPostedJobs, setHistPostedJobs] = useState<Job[]>([]);
  const [histWorkedJobs, setHistWorkedJobs] = useState<Job[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [histTab, setHistTab] = useState<HistoryTab>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) { navigate("/login"); return; }
      setUser(session.user);
      loadProfile(session.user.id);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) { navigate("/login"); return; }
      setUser(session.user);
      loadProfile(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadProfile = async (userId: string) => {
    const { data } = await supabase.from("profiles").select("*").eq("user_id", userId).single();
    if (data) {
      setProfile(data);
      setFullName(data.full_name || "");
      setPhone(data.phone || "");
      setLocation(data.location || "");
      setBio(data.bio || "");
      setSkills(data.skills || "");
      setHourlyRate(data.hourly_rate?.toString() || "");
    }
    setLoading(false);
  };

  // Load tab data on demand
  useEffect(() => {
    if (!user) return;
    if (tab === "earnings") loadEarnings();
    if (tab === "schedule") loadSchedule();
    if (tab === "history") loadHistory();
  }, [tab, user]);

  const loadEarnings = async () => {
    if (!user) return;
    setEarningsLoading(true);
    const [jobsRes, tipsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
      supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", user.id).eq("payment_status", "pending"),
    ]);
    if (jobsRes.data) setEarningsJobs(jobsRes.data);
    if (tipsRes.data) setTips(tipsRes.data);
    setEarningsLoading(false);
  };

  const loadSchedule = async () => {
    if (!user) return;
    setScheduleLoading(true);
    const [posted, assigned] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).in("status", ["open", "accepted", "in_progress"]).order("date_needed"),
      supabase.from("jobs").select("*").eq("helper_id", user.id).in("status", ["accepted", "in_progress"]).order("date_needed"),
    ]);
    if (posted.data) setSchedulePostedJobs(posted.data);
    if (assigned.data) setScheduleAssignedJobs(assigned.data);
    setScheduleLoading(false);
  };

  const loadHistory = async () => {
    if (!user) return;
    setHistoryLoading(true);
    const [posted, worked] = await Promise.all([
      supabase.from("jobs").select("*").eq("customer_id", user.id).order("created_at", { ascending: false }),
      supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
    ]);
    if (posted.data) setHistPostedJobs(posted.data);
    if (worked.data) setHistWorkedJobs(worked.data);
    setHistoryLoading(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      full_name: fullName.trim(), phone: phone.trim(), location: location.trim(),
      bio: bio.trim(), skills: skills.trim(),
      hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
    }).eq("user_id", user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Profile updated!");
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  }

  const role = profile?.role || "customer";

  // Earnings calculations
  const completedJobs = earningsJobs.filter((j) => j.status === "completed");
  const inProgressJobs = earningsJobs.filter((j) => j.status === "in_progress");
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.budget - (j.platform_fee_amount || 0)), 0);
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

  // Schedule calculations
  const allScheduleJobs = [...schedulePostedJobs, ...scheduleAssignedJobs];
  const jobsByDate = new Map<string, Job[]>();
  allScheduleJobs.forEach((j) => {
    const key = j.date_needed;
    if (!jobsByDate.has(key)) jobsByDate.set(key, []);
    jobsByDate.get(key)!.push(j);
  });
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];
  const days: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);
  const getDateStr = (day: number) => `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const selectedJobs = selectedDate ? (jobsByDate.get(selectedDate) || []) : [];
  const upcomingJobs = allScheduleJobs.filter((j) => j.date_needed >= today).sort((a, b) => a.date_needed.localeCompare(b.date_needed)).slice(0, 10);

  // History calculations
  const getHistoryJobs = () => {
    let jobs: (Job & { _source: "posted" | "worked" })[] = [];
    if (histTab === "all" || histTab === "posted") jobs = [...jobs, ...histPostedJobs.map((j) => ({ ...j, _source: "posted" as const }))];
    if (histTab === "all" || histTab === "worked") jobs = [...jobs, ...histWorkedJobs.map((j) => ({ ...j, _source: "worked" as const }))];
    const seen = new Set<string>();
    jobs = jobs.filter((j) => { if (seen.has(j.id)) return false; seen.add(j.id); return true; });
    if (statusFilter !== "all") jobs = jobs.filter((j) => j.status === statusFilter);
    return jobs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };
  const historyJobs = getHistoryJobs();

  const tabItems: { key: Tab; label: string }[] = [
    { key: "profile", label: "Profile" },
    { key: "earnings", label: "Earnings" },
    { key: "schedule", label: "Schedule" },
    { key: "history", label: "History" },
    { key: "payment", label: "Payment" },
    { key: "legal", label: "Legal" },
  ];

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          </div>
          <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-4 h-4" /></Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4">
        <div className="max-w-lg mx-auto space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1 overflow-x-auto">
            {tabItems.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-2 py-2 rounded-md text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* PROFILE TAB */}
          {tab === "profile" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-2xl font-display font-bold text-foreground">Edit profile</h1>
                <p className="text-muted-foreground text-sm mt-1">Keep your info up to date</p>
              </div>
              <form onSubmit={handleSave} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 555 123 4567" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location (city or ZIP)</Label>
                  <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Louisiana" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bio">About you</Label>
                  <Textarea id="bio" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell people about yourself…" rows={3} />
                </div>
                {role === "helper" && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="skills">Skills & services</Label>
                      <Input id="skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="Cleaning, yard work, moving…" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rate">Hourly rate ($)</Label>
                      <Input id="rate" type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} placeholder="25" />
                    </div>
                  </>
                )}
                <Button type="submit" className="w-full" size="lg" disabled={saving}>
                  {saving ? "Saving…" : "Save profile"}
                </Button>
              </form>
            </div>
          )}

          {/* EARNINGS TAB */}
          {tab === "earnings" && (
            <div className="space-y-6">
              <h1 className="text-2xl font-display font-bold text-foreground">My Earnings</h1>
              {earningsLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Total</span>
                        <TrendingUp className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{completedJobs.length} jobs</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Tips</span>
                        <Gift className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">${totalTips.toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground mt-1">{tips.length} tips</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Briefcase className="w-4 h-4 text-primary" />
                      </div>
                      <p className="text-xl font-bold text-foreground">{inProgressJobs.length}</p>
                      <p className="text-xs text-muted-foreground mt-1">in progress</p>
                    </div>
                  </div>
                  <div>
                    <h2 className="text-lg font-display font-semibold text-foreground mb-3">Earning History</h2>
                    {earningsJobs.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground mb-4">No jobs yet.</p>
                        <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {earningsJobs.map((job) => {
                          const payout = job.status === "completed" ? job.budget - (job.platform_fee_amount || 0) : null;
                          const jobTips = tips.filter((t) => t.job_id === job.id);
                          const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
                          return (
                            <div key={job.id} className="rounded-xl border border-border bg-card p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-semibold text-foreground text-sm">{job.title}</h3>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{job.location} · {new Date(job.date_needed).toLocaleDateString()}</p>
                                </div>
                                <div className="text-right">
                                  {payout !== null && <p className="font-bold text-foreground text-sm">${payout.toFixed(2)}</p>}
                                  {tipTotal > 0 && <p className="text-xs text-primary flex items-center gap-1 justify-end"><Gift className="w-3 h-3" /> +${tipTotal.toFixed(2)}</p>}
                                  {job.status === "in_progress" && <p className="text-xs text-muted-foreground">${job.budget} budget</p>}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* SCHEDULE TAB */}
          {tab === "schedule" && (
            <div className="space-y-4">
              <h1 className="text-2xl font-display font-bold text-foreground">My Schedule</h1>
              {scheduleLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between mb-4">
                      <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month - 1, 1))}><ChevronLeft className="w-4 h-4" /></Button>
                      <h2 className="font-display font-semibold text-foreground text-sm">
                        {currentMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </h2>
                      <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(new Date(year, month + 1, 1))}><ChevronRight className="w-4 h-4" /></Button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-1">
                      {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                        <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {days.map((day, i) => {
                        if (day === null) return <div key={`e-${i}`} />;
                        const dateStr = getDateStr(day);
                        const hasJobs = jobsByDate.has(dateStr);
                        const isToday = dateStr === today;
                        const isSelected = dateStr === selectedDate;
                        return (
                          <button
                            key={day}
                            onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                            className={`relative aspect-square flex flex-col items-center justify-center rounded-lg text-sm transition-colors ${
                              isSelected ? "bg-primary text-primary-foreground" :
                              isToday ? "bg-primary/10 text-primary font-bold" :
                              "hover:bg-secondary text-foreground"
                            }`}
                          >
                            {day}
                            {hasJobs && (
                              <span className={`absolute bottom-1 w-1.5 h-1.5 rounded-full ${isSelected ? "bg-primary-foreground" : "bg-primary"}`} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedDate && (
                    <div className="space-y-3">
                      <h3 className="font-display font-semibold text-foreground text-sm">
                        {new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                      </h3>
                      {selectedJobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No jobs scheduled for this day.</p>
                      ) : (
                        selectedJobs.map((job) => (
                          <ScheduleCard key={job.id} job={job} isPosted={schedulePostedJobs.some((j) => j.id === job.id)} />
                        ))
                      )}
                    </div>
                  )}

                  {!selectedDate && (
                    <div className="space-y-3">
                      <h3 className="font-display font-semibold text-foreground text-sm">Upcoming</h3>
                      {upcomingJobs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No upcoming jobs.</p>
                      ) : (
                        upcomingJobs.map((job) => (
                          <ScheduleCard key={job.id} job={job} isPosted={schedulePostedJobs.some((j) => j.id === job.id)} />
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* HISTORY TAB */}
          {tab === "history" && (
            <div className="space-y-4">
              <h1 className="text-2xl font-display font-bold text-foreground">Job History</h1>
              {historyLoading ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <>
                  <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
                    {(["all", "posted", "worked"] as HistoryTab[]).map((t) => (
                      <button key={t} onClick={() => setHistTab(t)}
                        className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                          histTab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        }`}>
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(["all", "open", "in_progress", "completed", "cancelled"] as StatusFilter[]).map((s) => (
                      <button key={s} onClick={() => setStatusFilter(s)}
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                          statusFilter === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                        }`}>
                        {s === "in_progress" ? "In Progress" : s}
                      </button>
                    ))}
                  </div>
                  {historyJobs.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No jobs found.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">{historyJobs.length} job{historyJobs.length !== 1 ? "s" : ""}</p>
                      {historyJobs.map((job) => (
                        <div key={`${job.id}-${job._source}`} className="rounded-xl border border-border bg-card p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <h3 className="font-semibold text-foreground text-sm">{job.title}</h3>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[job.status] || ""}`}>{job.status.replace("_", " ")}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">{job._source === "posted" ? "Posted" : "Worked"}</span>
                              </div>
                              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
                                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(job.date_needed).toLocaleDateString()}</span>
                                <span className="flex items-center gap-1 font-medium text-foreground"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
                              </div>
                            </div>
                            <p className="text-xs text-muted-foreground whitespace-nowrap">{new Date(job.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* PAYMENT TAB */}
          {tab === "payment" && (
            <div className="space-y-6">
              <h1 className="text-2xl font-display font-bold text-foreground">Payment Settings</h1>

              {/* Account security */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" /> Account Security
                </h2>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Email</p>
                      <p className="text-xs text-muted-foreground">{user?.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const newEmail = prompt("Enter new email address:");
                        if (!newEmail) return;
                        const { error } = await supabase.auth.updateUser({ email: newEmail });
                        if (error) toast.error(error.message);
                        else toast.success("Confirmation sent to your new email!");
                      }}
                    >
                      <Mail className="w-4 h-4 mr-1" /> Change
                    </Button>
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-foreground">Password</p>
                      <p className="text-xs text-muted-foreground">••••••••</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        if (!user?.email) return;
                        const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
                          redirectTo: `${window.location.origin}/reset-password`,
                        });
                        if (error) toast.error(error.message);
                        else toast.success("Password reset link sent to your email!");
                      }}
                    >
                      <Lock className="w-4 h-4 mr-1" /> Reset
                    </Button>
                  </div>
                </div>
              </div>

              {/* Payment info */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" /> Payment Methods
                </h2>
                <p className="text-sm text-muted-foreground">
                  Payments are securely processed through Stripe. Your card details are saved with Stripe and never stored on our servers.
                </p>
                <div className="rounded-lg bg-secondary/30 border border-border p-4 text-center">
                  <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Your payment methods are managed securely through Stripe during checkout.</p>
                </div>
              </div>

              {/* Payment history summary */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-primary" /> Payment Summary
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground">Total Spent</p>
                    <p className="text-lg font-bold text-foreground">
                      ${earningsJobs.length > 0 ? earningsJobs.filter(j => j.status === "completed").reduce((s, j) => s + j.budget, 0).toFixed(2) : "0.00"}
                    </p>
                  </div>
                  <div className="rounded-lg bg-secondary/30 p-3">
                    <p className="text-xs text-muted-foreground">Total Earned</p>
                    <p className="text-lg font-bold text-foreground">${totalEarnings.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* LEGAL TAB */}
          {tab === "legal" && (
            <div className="space-y-6">
              <h1 className="text-2xl font-display font-bold text-foreground">Legal & Policies</h1>

              <div className="space-y-3">
                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4 text-primary" /> Terms of Service
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    By using Helpr, you agree to our Terms of Service. These terms govern your use of the platform, including posting tasks, applying for jobs, and processing payments.
                  </p>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account and all activity under it.</p>
                    <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helper, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
                    <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, or any conduct that violates the rights of others.</p>
                    <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" /> Privacy Policy
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Your privacy is important to us. Here's how we handle your data:
                  </p>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, location) and usage data to improve the platform.</p>
                    <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, and communicate important updates.</p>
                    <p><strong className="text-foreground">Data Sharing:</strong> We share limited information (first name, reviews) with other users. Payment data is handled securely by Stripe. We never sell your personal information.</p>
                    <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. You can request deletion by contacting support.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-primary" /> Payment & Refund Policy
                  </h2>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong className="text-foreground">Escrow System:</strong> All payments are held in escrow until both parties confirm the job is complete.</p>
                    <p><strong className="text-foreground">Platform Fee:</strong> Helpr charges a platform fee on each transaction. The fee percentage is visible before payment.</p>
                    <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 72 hours after one party marks it done, payment is automatically released.</p>
                    <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions before approving completion. Helpers are notified and given a chance to address concerns.</p>
                    <p><strong className="text-foreground">Disputes:</strong> If you have a payment dispute, contact support. We review cases on a case-by-case basis.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                  <h2 className="font-display font-semibold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" /> Community Guidelines
                  </h2>
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism.</p>
                    <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions.</p>
                    <p><strong className="text-foreground">Safety:</strong> Never share personal information like home addresses or financial details through messages.</p>
                    <p><strong className="text-foreground">Reporting:</strong> Report any suspicious or inappropriate behavior using the report feature.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const ScheduleCard = ({ job, isPosted }: { job: Job; isPosted: boolean }) => (
  <div className={`rounded-xl border p-3 ${
    job.status === "open" ? "bg-primary/10 text-primary border-primary/20" :
    job.status === "in_progress" || job.status === "accepted" ? "bg-accent/20 text-accent-foreground border-accent/30" :
    "border-border bg-card"
  }`}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <h4 className="font-semibold text-sm">{job.title}</h4>
          <span className="text-xs px-2 py-0.5 rounded-full bg-background/50 font-medium">{isPosted ? "Posted" : "Assigned"}</span>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {job.location}</span>
          <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" /> ${job.budget}</span>
          {job.start_time && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.start_time}</span>}
        </div>
      </div>
      <span className="text-xs font-medium capitalize">{job.status.replace("_", " ")}</span>
    </div>
  </div>
);

export default ProfilePage;
