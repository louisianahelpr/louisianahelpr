import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut, User, Briefcase, LayoutDashboard } from "lucide-react";
import type { User as SupaUser } from "@supabase/supabase-js";

const Dashboard = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SupaUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session?.user) navigate("/login");
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
      if (!session?.user) navigate("/login");
    });

    return () => subscription.unsubscribe();
  }, [navigate]);

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

  const metadata = user?.user_metadata;
  const role = metadata?.role || "customer";
  const fullName = metadata?.full_name || "User";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">
            Helpr
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground hidden sm:block">
              {fullName}
            </span>
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
              icon={<LayoutDashboard className="w-5 h-5 text-primary" />}
              title="Your dashboard"
              desc={role === "helper" ? "View jobs you've applied to and upcoming work." : "Manage your posted tasks and applicants."}
            />
            <DashCard
              icon={<User className="w-5 h-5 text-primary" />}
              title="Edit profile"
              desc="Update your info, skills, and availability."
              onClick={() => navigate("/profile")}
            />
            {role === "customer" && (
              <DashCard
                icon={<Briefcase className="w-5 h-5 text-primary" />}
                title="Post a task"
                desc="Create a new job listing for helpers to apply to."
              />
            )}
            {role === "helper" && (
              <DashCard
                icon={<Briefcase className="w-5 h-5 text-primary" />}
                title="Browse tasks"
                desc="Find available jobs in your area."
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

const DashCard = ({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick?: () => void;
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
