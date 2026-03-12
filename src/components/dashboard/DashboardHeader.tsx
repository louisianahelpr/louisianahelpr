import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Briefcase, Heart, Plus } from "lucide-react";
import NotificationPanel from "@/components/NotificationPanel";
import { supabase } from "@/integrations/supabase/client";

interface DashboardHeaderProps {
  isAdmin: boolean;
}

const DashboardHeader = ({ isAdmin }: DashboardHeaderProps) => {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-gradient-to-r from-primary/5 via-background to-accent/5 backdrop-blur-xl">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <Link to="/dashboard" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-md">
            <span className="text-primary-foreground font-bold text-sm">H</span>
          </div>
          <span className="text-xl font-display font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
            Helpr
          </span>
        </Link>
        <div className="flex items-center gap-1.5">
          {isAdmin && (
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin")} className="hover:bg-destructive/10">
              <Shield className="w-4 h-4 text-destructive" />
            </Button>
          )}
          <Button
            onClick={() => navigate("/post-job")}
            size="sm"
            className="hidden sm:flex gap-1.5 bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-md"
          >
            <Plus className="w-4 h-4" /> Post task
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate("/favorites")} title="Favorite Helprs" className="hover:bg-accent/20 hover:text-accent-foreground">
            <Heart className="w-4 h-4" />
          </Button>
          <NotificationPanel />
          <Button variant="ghost" size="icon" onClick={handleLogout} className="hover:bg-destructive/10 hover:text-destructive">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
