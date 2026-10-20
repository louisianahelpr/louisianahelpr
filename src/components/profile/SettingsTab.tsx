import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { Switch } from "@/components/ui/switch";
import { useDarkMode, type Theme } from "@/hooks/useDarkMode";
import { useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { useProfileLandingDerived } from "@/components/profile/profileLanding/useProfileLandingDerived";
import type { MenuItem, Profile } from "@/components/profile/profileLanding/types";

/** Both sides of each section, the spec v2 §11 wording. */
export const SECTION_BLURB: Record<SectionKey, string> = {
  jobs: "Hire help or find work",
  declutter: "Sell or find a deal",
  shops: "Shop local or open a shop",
  homes: "Find a place or list one",
};

const COLOR_MODE_LABEL: Record<Theme, string> = { light: "Light", dark: "Dark", system: "Match my phone" };

/** Rows that moved here off the You tab when it became board 18's four rows. */
const MORE_KEYS = ["subscription", "referral", "gift-card", "report_bug", "legal", "admin"] as const;

/** Sentence case for a row label that is Title Case at its source ("Gift Card" -> "Gift card"). */
export function sentenceCase(label: string): string {
  return label.split(" ").map((w, i) => (i === 0 || w === "Helpr" || w === "Helprs" ? w : w.toLowerCase())).join(" ");
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="liquid-glass overflow-hidden" aria-label={title}>
      <h2 className="px-4 pt-3.5 pb-1 text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{title}</h2>
      <div className="flex flex-col [&>*+*]:border-t [&>*+*]:border-[hsl(var(--sand))]">{children}</div>
    </section>
  );
}

/** One settings row: label, a muted line under it, and either a chevron (it opens something) or a control. */
function Row({ label, sub, onClick, right, testId }: { label: string; sub?: string; onClick?: () => void; right?: ReactNode; testId?: string }) {
  const body = (
    <>
      <span className="flex-1 min-w-0">
        <span className="block text-ds-15 font-semibold text-foreground leading-tight">{label}</span>
        {sub && <span className="block text-ds-13 text-muted-foreground mt-0.5">{sub}</span>}
      </span>
      {right ?? (onClick && <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />)}
    </>
  );
  const cls = "w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left";
  return onClick ? (
    <button type="button" data-settings-row={testId} onClick={onClick} className={`glass-press ${cls} hover:bg-secondary/40 active:bg-secondary/60 transition-colors`}>
      {body}
    </button>
  ) : (
    <div data-settings-row={testId} className={cls}>{body}</div>
  );
}

/**
 * YOU › SETTINGS (board 52, spec v2 §9.17): Look (color mode, bigger text and
 * buttons), Your sections (a switch per open section, "Soon" for a closed one),
 * Alerts, Your account, More, and Log out. Text messages and saved searches
 * join Alerts when they exist (boards 88, 91); nothing here is a placeholder.
 */
export function SettingsTab({
  profile,
  seniorMode,
  onToggleSeniorMode,
  onSelectTab,
  onRequestLogout,
  onBack,
}: {
  profile: Profile | null;
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
  onSelectTab: (key: string) => void;
  onRequestLogout: () => void;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { theme } = useDarkMode();
  const { prefs, setHidden } = useSectionPrefs();
  const live = useSectionTabs();
  const { menuGroups } = useProfileLandingDerived({ profile });
  const byKey = new Map<string, MenuItem>(menuGroups.flatMap((g) => g.items).map((i) => [i.key, i]));
  const open = (item: MenuItem) => (item.href ? navigate(item.href) : onSelectTab(item.key));
  const more = MORE_KEYS.map((k) => byKey.get(k)).filter((i): i is MenuItem => !!i);

  return (
    <ProfileTabBody>
      <ProfileTabHeader title="Settings" onBack={onBack} />

      <Group title="Look">
        <Row testId="color-mode" label="Color mode" sub={COLOR_MODE_LABEL[theme]} onClick={() => onSelectTab("accessibility")} />
        {onToggleSeniorMode && (
          <Row
            testId="bigger-text"
            label="Bigger text and buttons"
            sub="Easier reading everywhere"
            right={<Switch checked={seniorMode} onCheckedChange={onToggleSeniorMode} aria-label="Bigger text and buttons" />}
          />
        )}
      </Group>

      <Group title="Your sections">
        {SECTIONS.map((s) => {
          const on = s.feature === null || !!live.find((t) => t.path === s.path)?.on;
          return (
            <Row
              key={s.key}
              testId={`section-${s.key}`}
              label={s.label}
              sub={on ? SECTION_BLURB[s.key] : "Opening soon"}
              right={
                on ? (
                  <Switch
                    checked={!prefs.hidden.includes(s.key)}
                    aria-label={`Show ${s.label}`}
                    onCheckedChange={(next) => {
                      if (!setHidden(s.key, !next)) toast("Keep at least one section on", { id: "customize-last" });
                    }}
                  />
                ) : (
                  <span className="shrink-0 text-ds-13 font-semibold text-muted-foreground">Soon</span>
                )
              }
            />
          );
        })}
      </Group>

      <Group title="Alerts">
        <Row testId="notifications" label="Notifications" sub="What we tell you, and how" onClick={() => onSelectTab("notifications")} />
      </Group>

      <Group title="Your account">
        <Row testId="profile" label="Edit profile" sub="Photo, name, about you" onClick={() => onSelectTab("profile")} />
        <Row testId="security" label="Account and security" sub="Email, password, sign-in" onClick={() => onSelectTab("security")} />
        <Row testId="warnings" label="Warnings and strikes" sub="Your account standing" onClick={() => onSelectTab("warnings")} />
      </Group>

      {more.length > 0 && (
        <Group title="More">
          {more.map((item) => (
            <Row key={item.key} testId={item.key} label={sentenceCase(item.label)} sub={item.desc} onClick={() => open(item)} />
          ))}
        </Group>
      )}

      <section className="liquid-glass overflow-hidden">
        <Row testId="logout" label="Log out" onClick={onRequestLogout} right={<span />} />
      </section>
    </ProfileTabBody>
  );
}
