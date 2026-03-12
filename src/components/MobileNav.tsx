import { useLocation, useNavigate } from "react-router-dom";
import { Home, ClipboardList, MessageSquare, User, Plus } from "lucide-react";
import { motion } from "framer-motion";

const leftItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/activity", icon: ClipboardList, label: "Activity" },
];

const rightItems = [
  { path: "/messages", icon: MessageSquare, label: "Messages" },
  { path: "/profile", icon: User, label: "Profile" },
];

const MobileNav = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const authPages = ["/dashboard", "/activity", "/post-job", "/profile", "/messages", "/admin", "/support"];
  if (!authPages.some((p) => location.pathname.startsWith(p))) return null;

  const renderItem = ({ path, icon: Icon, label }: { path: string; icon: any; label: string }) => {
    const active = location.pathname === path;
    return (
      <button
        key={path}
        onClick={() => navigate(path)}
        className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs transition-all duration-200 btn-press ${
          active ? "text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon className={`w-5 h-5 transition-transform duration-200 ${active ? "scale-110" : ""}`} />
        <span className="font-medium">{label}</span>
        {active && (
          <motion.div
            layoutId="nav-indicator"
            className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary"
            transition={{ type: "spring", stiffness: 500, damping: 35 }}
          />
        )}
      </button>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50">
      <div className="mx-3 mb-2 flex items-end gap-2 max-w-lg md:max-w-xl lg:max-w-2xl md:mx-auto">
        {/* Main nav pill — glassmorphism */}
        <div className="flex-1 rounded-2xl glass shadow-[0_-4px_30px_-4px_hsl(158_45%_42%/0.1),0_4px_20px_-4px_hsl(0_0%_0%/0.08)]">
          <div className="flex items-center justify-around h-14 px-2">
            {leftItems.map(renderItem)}
            {rightItems.map(renderItem)}
          </div>
        </div>

      </div>
    </nav>
  );
};

export default MobileNav;
