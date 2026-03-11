import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Users, Briefcase, Settings, BarChart3, ClipboardCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AdminUsers from "@/components/admin/AdminUsers";
import AdminJobs from "@/components/admin/AdminJobs";
import AdminSettings from "@/components/admin/AdminSettings";
import AdminAnalytics from "@/components/admin/AdminAnalytics";
import AdminReviews from "@/components/admin/AdminReviews";

type Tab = "analytics" | "reviews" | "users" | "jobs" | "settings";

const Admin = () => {
  const { loading } = useAdminAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>("analytics");

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "reviews", label: "Reviews", icon: <ClipboardCheck className="w-4 h-4" /> },
    { id: "users", label: "Users", icon: <Users className="w-4 h-4" /> },
    { id: "jobs", label: "Jobs", icon: <Briefcase className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
            <span className="text-xs font-medium bg-destructive/10 text-destructive px-2 py-0.5 rounded-full uppercase tracking-wide">Admin</span>
          </div>
          <Button variant="ghost" size="icon" onClick={async () => { await supabase.auth.signOut(); navigate("/"); }}>
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6">
        {/* Tab navigation */}
        <div className="flex gap-1 mb-8 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "analytics" && <AdminAnalytics />}
        {activeTab === "users" && <AdminUsers />}
        {activeTab === "jobs" && <AdminJobs />}
        {activeTab === "settings" && <AdminSettings />}
      </div>
    </div>
  );
};

export default Admin;
