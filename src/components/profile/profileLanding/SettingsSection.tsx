import {
  LogOut, ShieldCheck, Trash2, AlertTriangle,
  ChevronRight as ChevronRightIcon,
  TrendingUp, MoreHorizontal, Type, CheckCircle2,
  Sun, Moon, Monitor,
} from "lucide-react";
import { type Theme } from "@/hooks/useDarkMode";
import type { MenuItem, Profile } from "./types";

interface SettingsSectionProps {
  profile: Profile | null;
  stripeConnectStatus: { connected: boolean; details_submitted: boolean; payouts_enabled: boolean } | null;
  menuGroups: { title: string; items: MenuItem[] }[];
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
  onRequestLogout: () => void;
  onRequestDelete: () => void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export function SettingsSection({
  profile,
  stripeConnectStatus,
  menuGroups,
  onSelectTab,
  onNavigate,
  seniorMode,
  onToggleSeniorMode,
  onRequestLogout,
  onRequestDelete,
  theme,
  setTheme,
}: SettingsSectionProps) {
  return (
    <div
      className="liquid-glass"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      <div className="px-4 pt-3 pb-4 space-y-4">
        {/* Payout banner — slim single-row alert. The whole row taps
            through to Payment Settings. */}
        {profile?.approval_status === "approved" && stripeConnectStatus && !stripeConnectStatus.payouts_enabled && (
          <button
            type="button"
            onClick={() => onSelectTab("payment")}
            className="w-full flex items-center gap-2.5 rounded-ds-md border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-left active:scale-[0.99] transition-all"
          >
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
            <p className="flex-1 min-w-0 text-ds-11 text-foreground leading-snug">
              <span className="font-semibold">Set up your payout account</span> to accept jobs and get paid.
            </p>
            <span className="shrink-0 text-ds-11 font-semibold text-destructive inline-flex items-center gap-0.5">
              Set up <ChevronRightIcon className="w-3.5 h-3.5" strokeWidth={2.25} />
            </span>
          </button>
        )}

        {/* Unified list-of-rows navigation, grouped by section. */}
        {menuGroups.map((group) => {
          const groupNeedsAction = group.items.some((i) => i.needsAction);
          return (
            <section key={group.title}>
              <div className="flex items-center gap-2 px-1 mb-1.5">
                <h2
                  className="font-serif italic uppercase text-ds-9"
                  style={{
                    color: "hsl(var(--burnt-sienna))",
                    letterSpacing: "0.18em",
                  }}
                >
                  {group.title}
                </h2>
                {groupNeedsAction && (
                  // Decorative red dot — purely a visual cue that one of
                  // the rows below needs action. Each row that needs
                  // action already renders the visible text "Action
                  // needed" (see below), so the dot adds no information
                  // for AT users. `aria-hidden` keeps it out of the a11y
                  // tree and avoids the aria-prohibited-attr violation
                  // that an `aria-label` on a generic <span> would
                  // produce.
                  <span
                    aria-hidden="true"
                    className="w-1.5 h-1.5 rounded-full bg-destructive"
                  />
                )}
              </div>
              <div className="rounded-ds-lg liquid-glass overflow-hidden">
                {group.items.map((item, idx) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      if (item.href) onNavigate(item.href);
                      else onSelectTab(item.key);
                    }}
                    className="glass-press group/row w-full flex items-center justify-between gap-4 pl-4 pr-3.5 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left relative"
                  >
                    {idx > 0 && (
                      <span
                        aria-hidden
                        className="hairline pointer-events-none absolute top-0 left-[60px] right-[14px]"
                      />
                    )}
                    <div className="flex items-center gap-3.5 min-w-0">
                      {/* Icon tile — the per-icon red corner-dot was
                          removed; "Action needed" inline text below
                          (plus the group-level dot in the section
                          header) is the readable signal, and three
                          stacked reds was visual noise. */}
                      <div className="shrink-0">
                        <div
                          className="w-10 h-10 rounded-ds-md flex items-center justify-center transition-all group-hover/row:shadow-sm"
                          style={{
                            color: `hsl(${item.tint ?? "var(--olivewood)"})`,
                            background: `hsl(${item.tint ?? "var(--olivewood)"} / 0.12)`,
                          }}
                        >
                          {item.icon}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <p className="text-ds-13 font-semibold text-foreground leading-tight flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span>{item.label}</span>
                          {item.needsAction && (
                            <span className="text-ds-10 font-bold uppercase tracking-wider text-destructive">
                              Action needed
                            </span>
                          )}
                          {/* Soft amber completeness pill — distinct from the
                              louder "Action needed" red text so a payout
                              blocker still stands out next to a friendly
                              "Add a photo" nudge. Uses burnt-sienna at low
                              opacity so it reads as warm-warning, not
                              destructive. */}
                          {!item.needsAction && item.incompleteLabel && (
                            <span
                              className="inline-flex items-center gap-1 text-ds-10 font-bold rounded-full px-1.5 py-0.5"
                              style={{
                                background: "hsl(var(--burnt-sienna) / 0.12)",
                                color: "hsl(var(--burnt-sienna))",
                                letterSpacing: "0.04em",
                              }}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.5} />
                              {item.incompleteLabel}
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
            </section>
          );
        })}

        {/* Display & accessibility — color mode + senior mode grouped
            under one section so the two display preferences read as a
            pair instead of an "Appearance" header followed, two cards
            later, by an unlabeled senior-mode toggle. */}
        <section>
          <div className="flex items-center gap-2 px-1 mb-1.5">
            <h2
              className="font-serif italic uppercase text-ds-9"
              style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
            >
              Display
            </h2>
          </div>
          <div className="space-y-2">
            {/* Color mode — Light / Auto / Dark segmented control */}
            <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 flex flex-col gap-2">
              <p className="text-ds-12 font-semibold text-foreground leading-tight">
                Color mode
              </p>
              <div
                className="flex rounded-ds-md overflow-hidden"
                style={{ border: "0.5px solid hsl(var(--bark) / 0.2)" }}
                role="group"
                aria-label="Color mode"
              >
                {(
                  [
                    { value: "light" as Theme, Icon: Sun, label: "Light" },
                    { value: "system" as Theme, Icon: Monitor, label: "Auto" },
                    { value: "dark" as Theme, Icon: Moon, label: "Dark" },
                  ] as const
                ).map(({ value, Icon, label }) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={theme === value}
                    onClick={() => setTheme(value)}
                    className="flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors"
                    style={{
                      background:
                        theme === value
                          ? "hsl(var(--bark) / 0.12)"
                          : "transparent",
                      color:
                        theme === value
                          ? "hsl(var(--bark))"
                          : "hsl(var(--olivewood) / 0.8)",
                    }}
                  >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                    <span
                      className="text-ds-10 font-sans font-semibold uppercase"
                      style={{ letterSpacing: "0.06em" }}
                    >
                      {label}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Senior mode toggle — enlarges text and tap targets. Lives
                beside Color mode since both are display preferences. */}
            {onToggleSeniorMode && (
              <div className="rounded-ds-lg liquid-glass overflow-hidden">
                <button
                  type="button"
                  role="switch"
                  aria-checked={seniorMode}
                  onClick={() => onToggleSeniorMode(!seniorMode)}
                  className="glass-press w-full flex items-center justify-between gap-4 pl-4 pr-3.5 py-3 hover:bg-secondary/40 active:bg-secondary/60 transition-colors text-left"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="shrink-0">
                      <div
                        className="w-10 h-10 rounded-ds-md flex items-center justify-center"
                        style={{
                          background: "hsl(var(--stormy-sky) / 0.12)",
                          color: "hsl(var(--stormy-sky))",
                        }}
                      >
                        <Type className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-ds-13 font-semibold text-foreground leading-tight">
                        Senior mode
                      </p>
                      <p className="text-ds-11 text-muted-foreground mt-0.5 truncate">
                        Larger text and bigger tap targets
                      </p>
                    </div>
                  </div>
                  {/* Toggle pill */}
                  <div
                    className="shrink-0 w-11 h-6 rounded-full relative transition-colors duration-200"
                    style={{
                      background: seniorMode
                        ? "hsl(var(--stormy-sky))"
                        : "hsl(var(--sand) / 0.8)",
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                      style={{
                        transform: seniorMode ? "translateX(22px)" : "translateX(2px)",
                      }}
                    />
                  </div>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Worker protections card — static info card reassuring helpers
            that Helpr has their back on late cancellations and payment
            disputes. Shown on every helper's own profile. */}
        <div
          className="rounded-ds-lg overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--pif-tint) / 0.06) 0%, hsl(var(--pif-tint) / 0.02) 100%)",
            border: "0.5px solid hsl(var(--pif-tint) / 0.18)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.40), 0 2px 8px -2px hsl(var(--olivewood) / 0.06)",
          }}
        >
          <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-2">
            <ShieldCheck
              className="w-4 h-4 shrink-0"
              style={{ color: "hsl(var(--pif-green))" }}
            />
            <p
              className="text-ds-13 font-semibold leading-tight"
              style={{ color: "hsl(var(--pif-ink))" }}
            >
              Your protections
            </p>
          </div>
          <div className="px-4 pb-3.5 space-y-2">
            {([
              "Late-cancellation credit ($10) if a poster cancels < 24h before start",
              "Payment within 48h of confirmed completion — even during disputes",
              "Your rating stays protected if a job is cancelled through no fault of yours",
            ] as const).map((line) => (
              <div key={line} className="flex items-start gap-2">
                <CheckCircle2
                  className="w-3.5 h-3.5 mt-0.5 shrink-0"
                  style={{ color: "hsl(var(--pif-tint))" }}
                  strokeWidth={2.25}
                />
                <p
                  className="font-serif italic text-ds-12 leading-snug"
                  style={{ color: "hsl(var(--pif-green))" }}
                >
                  {line}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Helpr Wrapped banner — year-in-review shortcut. Year-round
            because the data is always there; links into /wrapped which
            handles its own auth gate. */}
        <button
          type="button"
          onClick={() => onNavigate("/wrapped")}
          aria-label="View your year so far on Helpr"
          className="w-full rounded-ds-lg overflow-hidden active:scale-[0.99] transition-transform text-left"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--bark) / 0.10) 0%, hsl(var(--burnt-sienna) / 0.12) 100%)",
            border: "0.5px solid hsl(var(--bark) / 0.20)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255,255,255,0.40), 0 2px 8px -2px hsl(var(--olivewood) / 0.10)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3.5">
            <TrendingUp
              className="w-5 h-5 shrink-0"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            />
            <div className="flex-1 min-w-0">
              <p
                className="text-ds-13 font-semibold leading-tight"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                Your year so far
              </p>
              <p
                className="text-ds-11 font-serif italic mt-0.5"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                See your year on Helpr
              </p>
            </div>
            <MoreHorizontal
              className="w-4 h-4 shrink-0"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            />
          </div>
        </button>

        {/* Account actions — two stacked pills of the same shape so the
            footer reads as a finished pair. Sign out is a soft muted
            fill in brand bark; Delete account is the same pill outlined
            in burnt-sienna — the brand's destructive tone. */}
        <div className="pt-1 space-y-2.5">
          <button
            type="button"
            onClick={onRequestLogout}
            className="glass-press w-full rounded-ds-lg bg-card py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
            style={{
              color: "hsl(var(--bark))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
          <button
            type="button"
            onClick={onRequestDelete}
            className="w-full rounded-ds-lg py-3.5 inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-all"
            style={{
              background: "transparent",
              border: "1px solid hsl(var(--burnt-sienna) / 0.32)",
              color: "hsl(var(--burnt-sienna))",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            <Trash2 className="w-4 h-4" /> Delete account
          </button>
        </div>
      </div>
    </div>
  );
}
