import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, User, Briefcase, Search, ClipboardList, Shield, Clock, XCircle } from "lucide-react";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Job = Database["public"]["Tables"]["jobs"]["Row"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      loadData(session.user.id);
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) {
        navigate("/login");
        return;
      }
      setUser(session.user);
      loadData(session.user.id);
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

  const loadData = async (userId: string) => {
    const [profileRes, jobsRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", userId).single(),
      supabase.from("jobs").select("*").eq("customer_id", userId).order("created_at", { ascending: false }).limit(5),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    if (profileRes.data) setProfile(profileRes.data);
    if (jobsRes.data) setMyJobs(jobsRes.data);
    setIsAdmin(rolesRes.data?.some((r) => r.role === "admin") ?? false);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const role = profile?.role || user?.user_metadata?.role || "customer";
  const fullName = profile?.full_name || user?.user_metadata?.full_name || "User";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">{fullName}</span>
            <Button variant="ghost" size="icon" onClick={handleLogout}>
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-3xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">
              Welcome, {fullName} 👋
            </h1>
            <p className="text-muted-foreground mt-1">
              You're signed in as a <span className="font-medium text-primary capitalize">{role}</span>.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <DashCard
              icon={<User className="w-5 h-5 text-primary" />}
              title="Edit profile"
              desc="Update your info, skills, and availability."
              onClick={() => navigate("/profile")}
            />

            {role === "customer" && (
              <>
                <DashCard
                  icon={<Briefcase className="w-5 h-5 text-primary" />}
                  title="Post a task"
                  desc="Create a new job listing for helpers to apply to."
                  onClick={() => navigate("/post-job")}
                />
                <DashCard
                  icon={<ClipboardList className="w-5 h-5 text-primary" />}
                  title="My posted tasks"
                  desc={`You have ${myJobs.length} task${myJobs.length !== 1 ? "s" : ""} posted.`}
                  onClick={() => navigate("/my-jobs")}
                />
              </>
            )}

            {role === "helper" && (
              <DashCard
                icon={<Search className="w-5 h-5 text-primary" />}
                title="Browse tasks"
                desc="Find available jobs in your area."
                onClick={() => navigate("/browse-jobs")}
              />
            )}

            {isAdmin && (
              <DashCard
                icon={<Shield className="w-5 h-5 text-destructive" />}
                title="Admin panel"
                desc="Manage users, jobs, payments, and platform settings."
                onClick={() => navigate("/admin")}
              />
            )}
          </div>

          {/* Recent jobs for customers */}
          {role === "customer" && myJobs.length > 0 && (
            <div>
              <h2 className="text-xl font-display font-semibold text-foreground mb-4">Recent tasks</h2>
              <div className="space-y-3">
                {myJobs.map((job) => (
                  <div key={job.id} className="rounded-lg border border-border bg-card p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-foreground">{job.title}</p>
                      <p className="text-sm text-muted-foreground capitalize">{job.status.replace("_", " ")} · ${job.budget}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

const DashCard = ({
  icon, title, desc, onClick,
}: {
  icon: React.ReactNode; title: string; desc: string; onClick?: () => void;
}) => (
  <button
    onClick={onClick}
    className="text-left p-5 rounded-xl bg-card border border-border hover:shadow-md transition-shadow"
  >
    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
      {icon}
    </div>
    <h3 className="font-semibold text-foreground mb-1">{title}</h3>
    <p className="text-sm text-muted-foreground">{desc}</p>
  </button>
);

export default Dashboard;
