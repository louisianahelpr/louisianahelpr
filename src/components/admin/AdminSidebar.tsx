import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Shield, Home, LogOut, Pin, PinOff } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { safeStorage } from "@/lib/safeStorage";

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

// localStorage key for pinned admin tabs. v1 schema: string[] of nav IDs.
const PINNED_KEY = "helpr.admin_pinned_tabs.v1";

const loadPins = (): string[] => {
  try {
    const raw = safeStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
};

const savePins = (pins: string[]) => {
  try { safeStorage.setItem(PINNED_KEY, JSON.stringify(pins)); } catch { /* noop */ }
};

const AdminSidebar = ({
  navGroups, activeView, onSelect, getBadge, getBadgeColor, onLogout,
}: AdminSidebarProps) => {
  const { state, setOpen, setOpenMobile, isMobile } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";
  const [pinned, setPinned] = useState<Set<string>>(() => new Set(loadPins()));

  useEffect(() => {
    // Persist whenever the set changes.
    savePins(Array.from(pinned));
  }, [pinned]);

  const togglePin = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    if (isMobile) setOpenMobile(false);
    else setOpen(false);
  };

  // Build the flat "Pinned" group from current navGroups so pinned items
  // always reflect the canonical icon/label (no stale snapshot).
  const allItems = navGroups.flatMap((g) => g.items);
  const pinnedItems = Array.from(pinned)
    .map((id) => allItems.find((it) => it.id === id))
    .filter((it): it is AdminNavItem => !!it);

  const renderItem = (item: AdminNavItem) => {
    const badge = getBadge?.(item.id);
    const badgeColor = getBadgeColor?.(item.id) ?? "bg-primary text-primary-foreground";
    const isPinned = pinned.has(item.id);
    return (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton
          onClick={() => handleSelect(item.id)}
          isActive={activeView === item.id}
          tooltip={item.label}
          className="font-medium relative group/item group-data-[collapsible=icon]:!justify-center"
        >
          <item.icon className="w-4 h-4" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && (
            // role="button" span, NOT a nested <button>: SidebarMenuButton
            // already renders a <button>, and <button> inside <button> is
            // invalid HTML (fires validateDOMNesting and confuses AT). A
            // labelled role=button span is valid nested markup and stays
            // keyboard-operable via onKeyDown; stopPropagation keeps a pin
            // toggle from also selecting the row.
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => togglePin(item.id, e)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  togglePin(item.id, e as unknown as React.MouseEvent);
                }
              }}
              aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
              title={isPinned ? "Unpin" : "Pin to top"}
              className={cn(
                "shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md transition-opacity cursor-pointer",
                isPinned
                  ? "opacity-100 text-primary hover:bg-primary/10"
                  : "opacity-0 group-hover/item:opacity-60 hover:opacity-100 text-muted-foreground hover:bg-muted",
              )}
            >
              {isPinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
            </span>
          )}
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

        {/* Pinned items — float to the top of the menu. Hidden when nothing
            is pinned. The hover-revealed pin icon in each row controls
            membership; the entire set persists to localStorage. */}
        {pinnedItems.length > 0 && (
          <SidebarGroup className="py-1">
            {!collapsed && (
              <SidebarGroupLabel className="text-ds-10 font-semibold uppercase tracking-widest text-muted-foreground px-3 h-6 flex items-center gap-1">
                <Pin className="w-3 h-3" /> Pinned
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {pinnedItems.map(renderItem)}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {navGroups.map((group) => {
          // Hide items that are already shown in the Pinned group so the
          // visual list doesn't double-up.
          const remaining = group.items.filter((it) => !pinned.has(it.id));
          if (remaining.length === 0) return null;
          return (
            <SidebarGroup key={group.title} className="py-1">
              {!collapsed && (
                <SidebarGroupLabel className="text-ds-10 font-semibold uppercase tracking-widest text-muted-foreground px-3 h-6">
                  {group.title}
                </SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {remaining.map(renderItem)}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-2 gap-1">
        {/* Back to the normal app — the admin console previously had no exit
            except Log out, stranding admins in the console (couldn't reach
            home / post / messages / profile without signing out). This returns
            to the app shell WITHOUT logging out. */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className={cn(
            "justify-start gap-2",
            collapsed && "justify-center px-0"
          )}
        >
          <Link to="/dashboard" aria-label="Back to the app">
            <Home className="w-4 h-4" />
            {!collapsed && <span>Back to app</span>}
          </Link>
        </Button>
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
