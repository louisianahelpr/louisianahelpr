import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Plus } from "lucide-react";
import NotificationPanel from "@/components/NotificationPanel";
import FavoritesPanel from "@/components/FavoritesPanel";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface DashboardHeaderProps {
  showBack?: boolean;
  onBack?: () => void;
  title?: string;
}

const DashboardHeader = ({ showBack, onBack, title }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const { isAdmin } = useCurrentUser();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 glass border-b border-border/30">
      <div className="container mx-auto flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2">
          {showBack && (
            <Button variant="ghost" size="icon" onClick={onBack || (() => navigate("/dashboard"))} className="rounded-xl h-9 w-9">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </Button>
          )}
          {title ? (
            <span className="text-lg font-display font-bold text-foreground">{title}</span>
          ) : (
            <Link to="/dashboard" className="flex items-center gap-2 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md transition-transform duration-200 group-hover:scale-105">
                <span className="text-primary-foreground font-bold text-sm">H</span>
              </div>
              <span className="text-lg font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                Helpr
              </span>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="hover:bg-destructive/10 btn-press rounded-xl h-9 w-9">
              <Shield className="w-4 h-4 text-destructive" />
            </Button>
          )}
          <Button
            onClick={() => navigate("/post-job")}
            size="sm"
            className="hidden sm:flex gap-1.5 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-md btn-press rounded-xl h-9"
          >
            <Plus className="w-4 h-4" /> Post task
          </Button>
          <FavoritesPanel />
          <ThemeToggle />
          <NotificationPanel />
          <Button variant="ghost" size="icon" onClick={handleLogout} className="hover:bg-destructive/10 hover:text-destructive btn-press rounded-xl h-9 w-9">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
