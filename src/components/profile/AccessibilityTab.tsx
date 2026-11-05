import { BIGGER_TEXT_LABEL, BIGGER_TEXT_SUB } from "@/components/profile/biggerTextWords";
import { useDarkMode } from "@/hooks/useDarkMode";
import type { Theme } from "@/hooks/useDarkMode";
import { Sun, Moon, Monitor, Type } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { Switch } from "@/components/ui/switch";

/** "Auto" is the visible label for `system` because the track is three cells
 *  wide on a phone; the accessible name spells it out. */
const COLOR_MODES: SegmentedOption<Theme>[] = [
  { value: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
  { value: "system", label: "Auto", ariaLabel: "Match system", icon: <Monitor className="w-4 h-4" /> },
  { value: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
];

interface AccessibilityTabProps {
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
  onBack: () => void;
}

export function AccessibilityTab({ seniorMode, onToggleSeniorMode, onBack }: AccessibilityTabProps) {
  const { theme, setTheme } = useDarkMode();

  return (
    <ProfileTabBody>
      <ProfileTabHeader title="Accessibility" onBack={onBack} />

      <div className="rounded-ds-lg liquid-glass overflow-hidden px-4 py-3 flex flex-col gap-2">
        <p className="text-ds-12 font-semibold text-foreground leading-tight">Color mode</p>
        {/* The app's shared segmented control. This was the outlier of four:
            a flat 12% bark tint at 0px radius, its type classes on an inner
            <span> so the button itself reported the browser default — three
            ways of being different from the identical control on Analytics and
            Earnings. Nothing about "which colour mode" justified its own
            language. */}
        <SegmentedControl
          ariaLabel="Color mode"
          iconPosition="top"
          layout="grid"
          gridClassName="grid-cols-3"
          options={COLOR_MODES}
          value={theme}
          onChange={setTheme}
        />
      </div>

      {onToggleSeniorMode && (
        <div className="rounded-ds-lg liquid-glass overflow-hidden">
          {/* The whole row still toggles (the label is the Switch's), and the switch is the shared one: its 44px hit
              area, haptic and track colours (Q2709, 11-05; it was a hand-made role=switch). */}
          <label
            htmlFor="a11y-bigger-text"
            className="glass-press w-full flex cursor-pointer items-center justify-between gap-4 pl-4 pr-3.5 py-3 ctl-tint transition-colors text-left"
          >
            <span className="flex items-center gap-3.5 min-w-0">
              <span className="shrink-0">
                <span
                  className="w-10 h-10 rounded-ds-md flex items-center justify-center"
                  style={{
                    background: "hsl(var(--stormy-sky) / 0.12)",
                    color: "hsl(var(--stormy-sky))",
                  }}
                >
                  <Type className="w-5 h-5" />
                </span>
              </span>
              <span className="block min-w-0">
                {/* One name for the one setting (audit #34): Settings calls it the same. */}
                <p className="text-ds-13 font-semibold text-foreground leading-tight">{BIGGER_TEXT_LABEL}</p>
                <p className="text-ds-11 text-muted-foreground mt-0.5">{BIGGER_TEXT_SUB}</p>
              </span>
            </span>
            <Switch id="a11y-bigger-text" checked={seniorMode} onCheckedChange={onToggleSeniorMode} aria-label={BIGGER_TEXT_LABEL} />
          </label>
        </div>
      )}
    </ProfileTabBody>
  );
}
