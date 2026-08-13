import { useDarkMode } from "@/hooks/useDarkMode";
import type { Theme } from "@/hooks/useDarkMode";
import { Sun, Moon, Monitor, Type } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

interface AccessibilityTabProps {
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
  onBack: () => void;
}

export function AccessibilityTab({ seniorMode, onToggleSeniorMode, onBack }: AccessibilityTabProps) {
  const { theme, setTheme } = useDarkMode();

  return (
    <div className="space-y-4">
      <ProfileTabHeader title="Accessibility" onBack={onBack} />

      <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 flex flex-col gap-2">
        <p className="text-ds-12 font-semibold text-foreground leading-tight">Color mode</p>
        <div
          className="flex rounded-ds-md overflow-hidden"
          style={{ border: "0.5px solid hsl(var(--bark) / 0.2)" }}
          role="group"
          aria-label="Color mode"
        >
          {([
            { value: "light" as Theme, Icon: Sun, label: "Light" },
            { value: "system" as Theme, Icon: Monitor, label: "Auto" },
            { value: "dark" as Theme, Icon: Moon, label: "Dark" },
          ] as const).map(({ value, Icon, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
              className="flex-1 py-2.5 flex flex-col items-center gap-0.5 transition-colors"
              style={{
                background: theme === value ? "hsl(var(--bark) / 0.12)" : "transparent",
                color: theme === value ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.8)",
              }}
            >
              <Icon className="w-4 h-4" strokeWidth={2} />
              <span className="text-ds-10 font-sans font-semibold uppercase" style={{ letterSpacing: "0.06em" }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

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
                <p className="text-ds-13 font-semibold text-foreground leading-tight">Senior mode</p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">Larger text and bigger tap targets</p>
              </div>
            </div>
            <div
              className="shrink-0 w-11 h-6 rounded-full relative transition-colors duration-200"
              style={{ background: seniorMode ? "hsl(var(--stormy-sky))" : "hsl(var(--sand) / 0.8)" }}
            >
              <div
                className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                style={{ transform: seniorMode ? "translateX(22px)" : "translateX(2px)" }}
              />
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
