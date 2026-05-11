import { useEffect, useState } from "react";
import { Sparkles, Check } from "lucide-react";
import { toast } from "sonner";
import {
  getAppIcon,
  setAppIcon,
  isAppIconSwitchingAvailable,
  type AppIconName,
} from "@/lib/appIcon";
import { APP_ICON_PICKER_ENABLED } from "@/lib/featureFlags";

interface IconOption {
  id: AppIconName;
  label: string;
  caption: string;
  previewSrc: string;
}

// Tile previews use the web-side raster assets. The 1024 is the
// primary; the alt is rendered from the SVG so we don't have to ship
// an extra PNG just for the picker UI.
const OPTIONS: IconOption[] = [
  {
    id: "default",
    label: "Garden District",
    caption: "Ornate ironwork H — the original.",
    previewSrc: "/app-icon-1024.png",
  },
  {
    id: "fleur",
    label: "Fleur",
    caption: "Bold mark, legible at notification size.",
    previewSrc: "/app-icon-alt.svg",
  },
];

export function AppIconPicker() {
  const [current, setCurrent] = useState<AppIconName>("default");
  const [pending, setPending] = useState<AppIconName | null>(null);
  const [hasSwitched, setHasSwitched] = useState(false);

  // Gate the read effect — but the hooks themselves must run on
  // every render to satisfy the Rules of Hooks. The early return
  // below short-circuits the JSX.
  const available = APP_ICON_PICKER_ENABLED && isAppIconSwitchingAvailable();

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    getAppIcon().then((name) => {
      if (!cancelled) setCurrent(name);
    });
    return () => {
      cancelled = true;
    };
  }, [available]);

  // The feature flag means this whole component renders nothing
  // until cowork flips it on. The runtime check catches web +
  // Android + the plugin-not-installed edge cases.
  if (!available) return null;

  const handleSelect = async (next: AppIconName) => {
    if (next === current || pending) return;
    setPending(next);
    try {
      await setAppIcon(next);
      // Re-read to confirm — iOS occasionally ignores the call if
      // the app is mid-background.
      const confirmed = await getAppIcon();
      setCurrent(confirmed);
      setHasSwitched(true);
      if (confirmed === next) {
        toast.success(
          next === "default"
            ? "Switched to Garden District"
            : "Switched to Fleur",
        );
      } else {
        toast.error("Could not change icon. Try again from the Home Screen.");
      }
    } catch {
      toast.error("Could not change icon.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="rounded-2xl liquid-glass p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="font-serif italic uppercase text-[0.6rem]"
            style={{
              color: "hsl(var(--burnt-sienna) / 0.78)",
              letterSpacing: "0.18em",
            }}
          >
            Appearance
          </p>
          <h2
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "1.05rem",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.015em",
            }}
          >
            App icon
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map((opt) => {
          const isActive = current === opt.id;
          const isPending = pending === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              disabled={!!pending}
              aria-pressed={isActive}
              aria-label={`Select ${opt.label} app icon`}
              className={[
                "relative flex flex-col items-center gap-2 rounded-2xl p-3 transition-all",
                "border border-border/40 bg-background/40",
                isActive
                  ? "ring-2 ring-primary shadow-sm"
                  : "hover:bg-background/60 active:scale-[0.98]",
                pending && !isPending ? "opacity-50" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <div className="relative w-20 h-20 rounded-[22%] overflow-hidden shadow-md bg-muted">
                <img
                  src={opt.previewSrc}
                  alt=""
                  className="w-full h-full object-cover"
                  draggable={false}
                />
                {isActive && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                    <Check className="w-3 h-3" strokeWidth={3} />
                  </div>
                )}
              </div>
              <div className="text-center">
                <p
                  className="font-display italic font-bold leading-tight"
                  style={{
                    fontSize: "0.95rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.015em",
                  }}
                >
                  {opt.label}
                </p>
                <p
                  className="text-[11px] font-serif italic mt-0.5"
                  style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                >
                  {opt.caption}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {hasSwitched && (
        <p
          className="text-[11px] font-serif italic pt-1"
          style={{ color: "hsl(var(--olivewood) / 0.7)" }}
        >
          A restart may be required for the new icon to appear everywhere
          on your Home Screen.
        </p>
      )}
    </div>
  );
}

export default AppIconPicker;
