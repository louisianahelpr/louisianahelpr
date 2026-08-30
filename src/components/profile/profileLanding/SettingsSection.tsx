import {
  LogOut, Trash2, AlertTriangle,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import type { MenuItem } from "./types";

interface SettingsSectionProps {
  menuGroups: { title: string; items: MenuItem[] }[];
  onSelectTab: (key: string) => void;
  onNavigate: (path: string) => void;
  onRequestLogout: () => void;
  onRequestDelete: () => void;
}

export function SettingsSection({
  menuGroups,
  onSelectTab,
  onNavigate,
  onRequestLogout,
  onRequestDelete,
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
        {/* Unified list-of-rows navigation, grouped by section. */}
        {menuGroups.map((group) => {
          return (
            <section key={group.title}>
              {/* Card eyebrow (owner, 2026-08-24: "better organization") — the
                  groups always HAD titles in the data; they were just never
                  painted, so four look-alike cards ran together. Quiet gray
                  sans, same recipe the filter sheet settled on. */}
              <p className="px-1 pb-1.5 text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
                {group.title}
              </p>
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
                          {(item.needsAction || item.incompleteLabel) && (() => {
                            const blocking = !!item.needsAction;
                            /* TINT and INK are separate tokens. Both branches
                               used the SAME raw brand hue for the fill and the
                               label, and neither --destructive nor
                               --burnt-sienna has a dark sibling — so on the
                               dark canvas "Action Needed" measured 3.64:1 and
                               "Set up" 3.84:1 at 10px, both under AA, on the
                               chips whose whole job is to be noticed.
                               --danger-ink is the theme-adaptive red the app
                               already mints for exactly this. */
                            const tint = blocking
                              ? "var(--destructive)"
                              : "var(--burnt-sienna)";
                            return (
                              <span
                                className="inline-flex items-center gap-1 text-ds-10 font-bold rounded-full px-1.5 py-0.5"
                                style={{
                                  background: `hsl(${tint} / 0.12)`,
                                  color: "hsl(var(--danger-ink))",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                <AlertTriangle className="w-2.5 h-2.5" strokeWidth={2.5} />
                                {blocking ? "Action Needed" : item.incompleteLabel}
                              </span>
                            );
                          })()}
                        </p>
                        <p className="text-ds-11 text-muted-foreground mt-0.5 line-clamp-2">{item.desc}</p>
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
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--bark) / 0.32)",
              fontFamily: "Montserrat, system-ui, sans-serif",
              fontWeight: 600,
            }}
          >
            <LogOut className="w-4 h-4" /> Sign Out
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
            <Trash2 className="w-4 h-4" /> Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
