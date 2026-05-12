import { Button } from "@/components/ui/button";
import {
  DollarSign, LogOut, MapPin,
  CreditCard, Shield,
  Star, Edit, CalendarDays, Clock, Gavel,
  ChevronRight as ChevronRightIcon,
  HelpCircle, Bell, AlertTriangle, Heart, Crown,
  ShieldCheck, Trash2,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  desc: string;
  href?: string;
  /** Render a small "Action needed" red dot when true. */
  needsAction?: boolean;
}

interface ProfileLandingProps {
  profile: Profile | null;
  displayName: string;
  initials: string;
  avatarBroken: boolean;
  setAvatarBroken: (v: boolean) => void;
  avgRating: number | null;
  reviewCount: number;
  postedCount: number;
  completedCount: number;
  stripeConnectStatus: { connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null;
  activeMenuGroup: string | null;
  setActiveMenuGroup: (v: string | null) => void;
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  onLoadInlineJobs: () => void;
  onRequestDelete: () => void;
  onRequestLogout: () => void;
}

export function ProfileLanding({
  profile,
  displayName,
  initials,
  avatarBroken,
  setAvatarBroken,
  avgRating,
  reviewCount,
  postedCount,
  completedCount,
  stripeConnectStatus,
  activeMenuGroup,
  setActiveMenuGroup,
  onSelectTab,
  onNavigate,
  onLoadInlineJobs,
  onRequestDelete,
  onRequestLogout,
}: ProfileLandingProps) {
  // Derived state — drives "Action needed" dots on menu items so the
  // user sees blockers at a glance without having to navigate into each
  // tab to discover them.
  const tier = (profile?.subscription_tier ?? "free") as string;
  const stripeNeedsAction =
    profile?.approval_status === "approved" &&
    stripeConnectStatus !== null &&
    !stripeConnectStatus.payouts_enabled;
  const idvNeedsAction =
    profile?.idv_status === "not_started" || profile?.idv_status === "failed";

  const subscriptionDesc =
    tier === "elite"
      ? "Elite plan — top visibility"
      : tier === "pro"
        ? "Pro plan — bump to Elite for max reach"
        : "Free plan — upgrade for more visibility";

  const menuGroups: { title: string; items: MenuItem[] }[] = [
    {
      title: "Account",
      items: [
        { key: "credentials", label: "Licensed & Insured", icon: <ShieldCheck className="w-5 h-5" />, desc: "Add your license and insurance" },
        { key: "schedule", label: "Schedule", icon: <CalendarDays className="w-5 h-5" />, desc: "Calendar and upcoming jobs" },
        { key: "availability", label: "Availability", icon: <Clock className="w-5 h-5" />, desc: "Set your weekly working hours" },
        { key: "landing", label: "Saved Helprs", icon: <Heart className="w-5 h-5" />, desc: "Rebook favorites with a direct offer", href: "/saved-helpers" },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-5 h-5" />, desc: "Choose what alerts you get" },
      ],
    },
    {
      title: "Money",
      items: [
        { key: "payment", label: "Payout & Payments", icon: <CreditCard className="w-5 h-5" />, desc: "Bank account, payment methods & summary", needsAction: stripeNeedsAction },
        { key: "subscription", label: "Subscription", icon: <Crown className="w-5 h-5" />, desc: subscriptionDesc },
        { key: "referral", label: "Referrals", icon: <Heart className="w-5 h-5" />, desc: "Invite friends & earn credits" },
      ],
    },
    {
      title: "Settings & Support",
      items: [
        { key: "security", label: "Account Security", icon: <Shield className="w-5 h-5" />, desc: "Email, password & login", needsAction: idvNeedsAction },
        { key: "warnings", label: "Warnings & Strikes", icon: <AlertTriangle className="w-5 h-5" />, desc: "View violations, strikes & history" },
        { key: "support", label: "Help & Support", icon: <HelpCircle className="w-5 h-5" />, desc: "Get help & contact us" },
        { key: "legal", label: "Legal & Policies", icon: <Gavel className="w-5 h-5" />, desc: "Terms, privacy & guidelines" },
      ],
    },
  ];

  return (
    <>
      {/* Top box — hero with avatar + name + stats. Same radial
          Sienna→Verdigris backdrop as the Dashboard greeting card. */}
      <div
        className="relative liquid-glass shrink-0 p-3.5 overflow-hidden"
        style={{
          backgroundImage:
            "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
            "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
            "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
        }}
      >
        <button
          onClick={() => onSelectTab("profile")}
          aria-label="Edit profile"
          className="absolute top-2.5 right-2.5 w-9 h-9 rounded-full bg-secondary/60 hover:bg-secondary active:scale-95 flex items-center justify-center text-foreground/70 hover:text-foreground transition-all"
        >
          <Edit className="w-4 h-4" />
        </button>
        <div className="flex flex-row items-center gap-3.5 pr-10">
          {/* Avatar — 70px squircle, left */}
          <div className="w-[75px] h-[75px] rounded-[22px] squircle bg-primary/10 text-primary flex items-center justify-center text-ds-20 font-bold overflow-hidden shrink-0">
            {profile?.avatar_url && !avatarBroken ? (
              <img
                loading="lazy"
                decoding="async"
                src={profile.avatar_url}
                alt=""
                className="w-full h-full object-cover"
                onError={() => setAvatarBroken(true)}
              />
            ) : initials}
          </div>
          {/* Identity + integrated stats, all stacked tight on the right */}
          <div className="flex-1 min-w-0 text-left">
            <h1
              className="font-display italic font-bold truncate leading-tight"
              style={{
                fontSize: "clamp(1.4rem, 2vw + 0.4rem, 1.75rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              {displayName || "Welcome back"}
            </h1>
            {profile?.location && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{profile.location}</span>
              </p>
            )}
            {/* Integrated stats — single inline line directly under location */}
            <div className="flex items-center gap-3 mt-1.5 text-[11px]">
              <button
                onClick={() => onSelectTab("reviews")}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <Star className="w-3 h-3 text-primary fill-primary" />
                <span className="font-bold text-foreground">{avgRating ? avgRating.toFixed(1) : "5.0"}</span>
                <span className="text-muted-foreground">({reviewCount})</span>
              </button>
              <span className="w-px h-3 bg-border/60" />
              <button
                onClick={() => { if (postedCount > 0) { onLoadInlineJobs(); onSelectTab("posted_jobs"); } }}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <span className="font-bold text-foreground">{postedCount}</span>
                <span className="text-muted-foreground">Posted</span>
              </button>
              <span className="w-px h-3 bg-border/60" />
              <button
                onClick={() => { if (completedCount > 0) { onLoadInlineJobs(); onSelectTab("completed_jobs"); } }}
                className="flex items-center gap-1 hover:opacity-70 active:opacity-50 transition-opacity"
              >
                <span className="font-bold text-foreground">{completedCount}</span>
                <span className="text-muted-foreground">Done</span>
              </button>
            </div>
            {!profile?.full_name?.trim() && (
              <button
                onClick={() => onSelectTab("profile")}
                className="mt-1 text-[11px] font-semibold text-primary hover:underline"
              >
                + Add your name
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bottom box — menu groups + account actions. Extends
          to viewport bottom with flat bottom corners. AppShell
          handles vertical scroll (scrollable=true on landing),
          so this card just stacks naturally. */}
      <div
        className="liquid-glass min-h-[60vh]"
        style={{
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderBottom: "none",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06), " +
            "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
            "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
        }}
      >
        <div className="px-4 pt-3 pb-4 space-y-3">
          {/* Payout Banner */}
          {profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
            <div className="rounded-[24px] border-2 border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-ds-13 font-semibold text-foreground">Set up your payout account</p>
                  <p className="text-ds-11 text-muted-foreground mt-1">
                    Add a bank account in Payment Settings to accept jobs and receive payments.
                  </p>
                </div>
              </div>
              <Button onClick={() => onSelectTab("payment")} className="w-full" size="sm">
                <CreditCard className="w-4 h-4 mr-2" /> Go to Payment Settings
              </Button>
            </div>
          )}

          {/* Category buttons replace the old always-expanded long list. */}
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2.5">
              {menuGroups.map((group) => {
                const isActive = activeMenuGroup === group.title;
                const GroupIcon = group.title === "Account" ? Edit : group.title === "Money" ? DollarSign : HelpCircle;

                return (
                  <button
                    key={group.title}
                    type="button"
                    onClick={() => setActiveMenuGroup(isActive ? null : group.title)}
                    className={`min-h-[78px] rounded-[20px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] px-2 py-2.5 flex flex-col items-center justify-center gap-1.5 transition-all active:scale-[0.98] ${isActive ? "ring-2 ring-primary/30 text-primary" : "text-foreground hover:bg-secondary/40"}`}
                    aria-expanded={isActive}
                  >
                    <span className={`w-9 h-9 rounded-ds-md flex items-center justify-center ${isActive ? "bg-primary/10 text-primary" : "bg-muted/60 text-muted-foreground"}`}>
                      <GroupIcon className="w-4.5 h-4.5" />
                    </span>
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.05em] leading-tight text-center">
                      {group.title === "Settings & Support" ? "Support" : group.title}
                    </span>
                  </button>
                );
              })}
            </div>

            {activeMenuGroup && (() => {
              const group = menuGroups.find((menuGroup) => menuGroup.title === activeMenuGroup);
              if (!group) return null;

              return (
                <div>
                  <div className="rounded-[24px] bg-white shadow-[0_2px_4px_hsl(160_10%_12%/0.04),0_12px_32px_-12px_hsl(160_10%_12%/0.14)] overflow-hidden">
                    {group.items.map((item, idx) => (
                      <button
                        key={item.label}
                        onClick={() => {
                          if (item.href) onNavigate(item.href);
                          else onSelectTab(item.key);
                        }}
                        className="group/row w-full flex items-center justify-between gap-4 pl-5 pr-4 py-3.5 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                      >
                        {idx > 0 && (
                          <span
                            aria-hidden
                            className="pointer-events-none absolute top-0 left-[68px] right-[15px] h-px bg-border/60"
                          />
                        )}
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="relative shrink-0">
                            <div className="w-10 h-10 rounded-ds-md bg-muted/60 text-muted-foreground flex items-center justify-center transition-colors group-hover/row:bg-primary/10 group-hover/row:text-primary">
                              {item.icon}
                            </div>
                            {item.needsAction && (
                              <span
                                aria-label="Action needed"
                                className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-destructive ring-2 ring-white"
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-ds-13 font-semibold text-foreground leading-tight">
                              {item.label}
                              {item.needsAction && (
                                <span className="ml-2 text-ds-10 font-bold uppercase tracking-wider text-destructive">
                                  Action needed
                                </span>
                              )}
                            </p>
                            <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">{item.desc}</p>
                          </div>
                        </div>
                        <span className="w-5 flex items-center justify-center shrink-0">
                          <ChevronRightIcon className="w-4 h-4 text-muted-foreground/70" strokeWidth={2.25} />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Account actions — compact pair */}
          <div className="pt-1 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={onRequestDelete}
              className="rounded-[20px] bg-destructive/10 border border-destructive/40 hover:bg-destructive/15 hover:border-destructive/60 py-3 inline-flex items-center justify-center gap-2 text-ds-13 font-semibold text-destructive shadow-[0_1px_2px_hsl(0_60%_30%/0.06),0_8px_28px_-12px_hsl(0_60%_30%/0.18)] active:opacity-90 transition-colors"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
            <button
              type="button"
              onClick={onRequestLogout}
              className="rounded-[20px] bg-white shadow-[0_1px_2px_hsl(160_10%_12%/0.04),0_8px_28px_-12px_hsl(160_10%_12%/0.10)] py-3 inline-flex items-center justify-center gap-2 text-ds-13 font-semibold text-foreground hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ProfileLanding;
