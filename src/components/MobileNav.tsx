import { useLocation, useNavigate } from "react-router-dom";
import { Home, Briefcase, MessageSquare, DollarSign, User } from "lucide-react";

const navItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/post-job", icon: Briefcase, label: "Post" },
  { path: "/messages", icon: MessageSquare, label: "Messages" },
  { path: "/earnings", icon: DollarSign, label: "Earnings" },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Only show on authenticated pages
  const authPages = ["/dashboard", "/browse-jobs", "/post-job", "/my-jobs", "/profile", "/earnings", "/messages", "/admin", "/schedule", "/job-history"];
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden">
      <div className="flex items-center justify-around h-16 px-1">
        {navItems.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileNav;
