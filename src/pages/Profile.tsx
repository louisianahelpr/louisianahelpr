import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, DollarSign, TrendingUp, Gift, Briefcase, LogOut } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Job = Database["public"]["Tables"]["jobs"]["Row"];

type Tab = "profile" | "earnings";

const ProfilePage = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("profile");

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [location, setLocation] = useState("");
  const [bio, setBio] = useState("");
  const [skills, setSkills] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  // Earnings state
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tips, setTips] = useState<{ amount: number; job_id: string; created_at: string }[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);

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

  const loadEarnings = async () => {
    if (!user) return;
    setEarningsLoading(true);
    const [jobsRes, tipsRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("helper_id", user.id).order("created_at", { ascending: false }),
      supabase.from("tips").select("amount, job_id, created_at").eq("helper_id", user.id).eq("payment_status", "pending"),
    ]);
    if (jobsRes.data) setJobs(jobsRes.data);
    if (tipsRes.data) setTips(tipsRes.data);
    setEarningsLoading(false);
  };

  useEffect(() => {
    if (tab === "earnings" && user) loadEarnings();
  }, [tab, user]);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background"><p className="text-muted-foreground">Loading...</p></div>;
  }

  const role = profile?.role || "customer";
  const completedJobs = jobs.filter((j) => j.status === "completed");
  const inProgressJobs = jobs.filter((j) => j.status === "in_progress");
  const totalEarnings = completedJobs.reduce((sum, j) => sum + (j.budget - (j.platform_fee_amount || 0)), 0);
  const totalTips = tips.reduce((sum, t) => sum + t.amount, 0);

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

      <main className="container mx-auto px-4 py-6">
        <div className="max-w-lg mx-auto space-y-6">
          {/* Tabs */}
          <div className="flex gap-1 bg-secondary/50 rounded-lg p-1">
            {([{ key: "profile", label: "Profile" }, { key: "earnings", label: "Earnings" }] as const).map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  tab === t.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "profile" && (
            <div className="space-y-6">
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground">Edit profile</h1>
                <p className="text-muted-foreground mt-1">Keep your info up to date</p>
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

          {tab === "earnings" && (
            <div className="space-y-6">
              <h1 className="text-3xl font-display font-bold text-foreground">My Earnings</h1>
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
                    <h2 className="text-lg font-display font-semibold text-foreground mb-3">Job History</h2>
                    {jobs.length === 0 ? (
                      <div className="text-center py-8">
                        <p className="text-muted-foreground mb-4">No jobs yet.</p>
                        <Button onClick={() => navigate("/dashboard")}>Browse tasks</Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {jobs.map((job) => {
                          const payout = job.status === "completed" ? job.budget - (job.platform_fee_amount || 0) : null;
                          const jobTips = tips.filter((t) => t.job_id === job.id);
                          const tipTotal = jobTips.reduce((s, t) => s + t.amount, 0);
                          return (
                            <div key={job.id} className="rounded-xl border border-border bg-card p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-semibold text-foreground text-sm">{job.title}</h3>
                                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                                      job.status === "completed" ? "bg-primary/10 text-primary"
                                      : job.status === "in_progress" ? "bg-accent/20 text-accent-foreground"
                                      : "bg-secondary text-secondary-foreground"
                                    }`}>{job.status.replace("_", " ")}</span>
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
        </div>
      </main>
    </div>
  );
};

export default ProfilePage;
