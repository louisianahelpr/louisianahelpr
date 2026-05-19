import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Shield, Home, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  id: string;
  label: string;
  icon: React.ElementType;
}

interface AdminSidebarProps {
  navGroups: { title: string; items: AdminNavItem[] }[];
  activeView: string;
  onSelect: (id: string) => void;
  getBadge?: (id: string) => number | undefined;
  getBadgeColor?: (id: string) => string;
  onLogout: () => void;
}

const AdminSidebar = ({
  navGroups, activeView, onSelect, getBadge, getBadgeColor, onLogout,
}: AdminSidebarProps) => {
  const { state, setOpen, setOpenMobile, isMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";

  const handleSelect = (id: string) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  };

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border h-14 flex flex-row items-center px-4 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-8 h-8 rounded-ds-md flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, hsl(var(--ink-deep)) 0%, hsl(var(--bark)) 100%)",
            }}
          >
            <Shield className="w-4 h-4" style={{ color: "hsl(var(--parchment))" }} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p
                className="font-display italic font-bold leading-tight truncate"
                style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.01em" }}
              >
                Helpr Admin
              </p>
              <p
                className="font-serif italic uppercase leading-tight"
                style={{
                  fontSize: "0.58rem",
                  color: "hsl(var(--burnt-sienna) / 0.78)",
                  letterSpacing: "0.18em",
                  marginTop: "1px",
                }}
              >
                Operations
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2 gap-0 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => handleSelect("home")}
                  isActive={activeView === "home"}
                  tooltip="Dashboard"
                  className="font-medium group-data-[collapsible=icon]:!justify-center"
                >
                  <Home className="w-4 h-4" />
                  {!collapsed && <span>Dashboard</span>}
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {navGroups.map((group) => (
          <SidebarGroup key={group.title} className="py-1">
            {!collapsed && (
              <SidebarGroupLabel className="text-ds-10 font-semibold uppercase tracking-widest text-muted-foreground px-3 h-6">
                {group.title}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const badge = getBadge?.(item.id);
                  const badgeColor = getBadgeColor?.(item.id) ?? "bg-primary text-primary-foreground";
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => handleSelect(item.id)}
                        isActive={activeView === item.id}
                        tooltip={item.label}
                        className="font-medium relative group-data-[collapsible=icon]:!justify-center"
                      >
                        <item.icon className="w-4 h-4" />
                        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                        {badge !== undefined && (
                          <span className={cn(
                            "text-ds-10 min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-1",
                            badgeColor,
                            collapsed && "absolute top-1 right-1"
                          )}>
                            {badge > 99 ? "99+" : badge}
                          </span>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onLogout}
          className={cn(
            "justify-start gap-2 hover:bg-destructive/10 hover:text-destructive",
            collapsed && "justify-center px-0"
          )}
        >
          <LogOut className="w-4 h-4" />
          {!collapsed && <span>Log out</span>}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AdminSidebar;
