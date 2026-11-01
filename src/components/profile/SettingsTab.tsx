import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronRight, Download, Loader2 } from "lucide-react";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";
import { ProfileTabBody } from "@/components/profile/ProfileTabBody";
import { Switch } from "@/components/ui/switch";
import { useDarkMode, type Theme } from "@/hooks/useDarkMode";
import { KEEP_ONE_OPEN_TOAST, useSectionPrefs } from "@/components/sections/useSectionPrefs";
import { useOpenSectionKeys, useSectionTabs } from "@/components/mobileNav/useSectionTabs";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { useProfileLandingDerived } from "@/components/profile/profileLanding/useProfileLandingDerived";
import type { MenuItem, Profile } from "@/components/profile/profileLanding/types";
import { TAB_TITLES } from "@/pages/profile/types";
import { useDataExport } from "@/hooks/useDataExport";
import { supabase } from "@/integrations/supabase/client";
import { unwrapMutation, mutationErrorMessage } from "@/lib/mutationResult";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { identityView, openIdentityCheck, type IdentityView } from "@/lib/identityCheck";
import { SHARE_JOB_PHOTOS_LABEL } from "@/lib/jobPhotosConsent";
import { SoonPill } from "@/components/sections/SoonPill";
import { PreviewPill } from "@/components/sections/PreviewPill";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useLanguage } from "@/lib/i18n/language";
import { ProfileLinkRow } from "@/components/profile/ProfileLinkRow";

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
/** "you@example.com · Password, Google": the account row's line, or null when nothing is known. */
export function accountLine(email: string | null | undefined, identities: { provider: string }[] | null | undefined): string | null {
  const NAMES: Record<string, string> = { email: "Password", google: "Google", apple: "Apple" };
  const methods = [...new Set((identities ?? []).map((i) => NAMES[i.provider]).filter(Boolean))];
  const parts = [email || null, methods.length ? methods.join(", ") : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function Row({ label, badge, sub, onClick, right, testId, danger = false, busy = false }: { label: string; badge?: ReactNode; sub?: string; onClick?: () => void; right?: ReactNode; testId?: string; danger?: boolean; busy?: boolean }) {
  const name = (
    <span className={`block text-ds-15 font-semibold leading-tight ${danger ? "" : "text-foreground"}`} style={danger ? { color: "hsl(var(--alert-ink))" } : undefined}>{label}</span>
  );
  const body = (
    <>
      <span className="flex-1 min-w-0">
        {badge ? <span className="flex items-center gap-2">{name}{badge}</span> : name}
        {sub && <span className="block text-ds-13 text-muted-foreground mt-0.5">{sub}</span>}
      </span>
      {right ?? (onClick && <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />)}
    </>
  );
  const cls = "w-full min-h-[56px] flex items-center gap-3 px-4 py-3 text-left";
  return onClick ? (
    <button type="button" data-settings-row={testId} onClick={onClick} aria-busy={busy || undefined} className={`glass-press ${cls} ctl-tint transition-colors`}>
      {body}
    </button>
  ) : (
    <div data-settings-row={testId} className={cls}>{body}</div>
  );
}

/**
 * "Let Helpr share my job photos": profiles.share_job_photos (default on; the
 * member's own row). A job's photos are used only when the poster AND every
 * Helpr on it leave this on (job_photos_shareable, 20261021001940). The write is
 * checked (`.select` + unwrapMutation); a refused write puts the switch back.
 */
function ShareJobPhotosRow({ profile }: { profile: Profile | null }) {
  const { refresh } = useCurrentUser();
  const [on, setOn] = useState<boolean>(profile?.share_job_photos ?? true);
  const [saving, setSaving] = useState(false);
  // The profile can arrive (or refresh) after first paint: follow it unless a write is in flight.
  const stored = profile?.share_job_photos;
  useEffect(() => { if (!saving && typeof stored === "boolean") setOn(stored); }, [stored, saving]);
  if (!profile) return null;
  const change = async (next: boolean) => {
    setOn(next);
    setSaving(true);
    try {
      unwrapMutation(
        await supabase.from("profiles").update({ share_job_photos: next }).eq("user_id", profile.user_id).select("user_id"),
        { action: next ? "let Helpr share your job photos" : "stop Helpr sharing your job photos", context: { userId: profile.user_id } },
      );
      void refresh();
    } catch (err) {
      setOn(!next);
      toast.error(mutationErrorMessage(err, "Couldn't save that setting. Please try again."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Row
      testId="share-job-photos"
      label={SHARE_JOB_PHOTOS_LABEL}
      sub="Before and after photos may show what Helprs do. Faces and addresses are hidden."
      right={<Switch checked={on} disabled={saving} onCheckedChange={(v) => void change(v)} aria-label={SHARE_JOB_PHOTOS_LABEL} />}
    />
  );
}

/**
 * YOU › SETTINGS (board 52, spec v2 §9.17): Look (color mode, bigger text and
 * buttons), Your sections (a switch per open section, "Soon" for a closed one),
 * Alerts (notifications, and saved searches since Q2275, board 91), Your
 * account, More, and Log out. Text messages join Alerts when they exist
 * (board 88); nothing here is a placeholder.
 */
export function SettingsTab({
  profile,
  seniorMode,
  onToggleSeniorMode,
  onSelectTab,
  onRequestLogout,
  onRequestDelete,
  onBack,
}: {
  profile: Profile | null;
  seniorMode: boolean;
  onToggleSeniorMode?: (enabled: boolean) => void;
  onSelectTab: (key: string) => void;
  onRequestLogout: () => void;
  /** Board 120: Delete account sits at the foot of Your account (its dialog does the warning). */
  onRequestDelete?: () => void;
  onBack: () => void;
}) {
  const idOn = useIdentityCheckOnStore();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const dataExport = useDataExport(user?.id);
  const { theme } = useDarkMode();
  const { prefs, setHidden } = useSectionPrefs();
  const live = useSectionTabs();
  const openKeys = useOpenSectionKeys();
  const { menuGroups } = useProfileLandingDerived({ profile });
  const byKey = new Map<string, MenuItem>(menuGroups.flatMap((g) => g.items).map((i) => [i.key, i]));
  const open = (item: MenuItem) => (item.href ? navigate(item.href) : onSelectTab(item.key));
  const more = MORE_KEYS.map((k) => byKey.get(k)).filter((i): i is MenuItem => !!i);
  const { t } = useLanguage();

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
        {/* Spanish language option (2026-10-29): the ONE shared switch, remembered on this device. Guard: src/test/settingsLanguageSwitch.test.tsx. */}
        <Row testId="language" label={t("lang.label")} right={<LanguageToggle />} />
      </Group>

      <Group title="Your sections">
        {/* In the iPhone app a section not open to everyone is not listed (owner 10-31, hideUnopenedInApp). */}
        {SECTIONS.filter((s) => live.find((t) => t.path === s.path)?.listed !== false).map((s) => {
          const tab = live.find((t) => t.path === s.path);
          const on = s.feature === null || !!tab?.on;
          const preview = s.feature !== null && !!tab?.preview;
          return (
            <Row
              key={s.key}
              testId={`section-${s.key}`}
              label={s.label}
              // Beside the name, not the switch: there it squeezed the blurb onto two lines at 375 (looked, 2026-10-21).
              badge={preview ? <PreviewPill data-section-preview={s.key} /> : undefined}
              sub={on ? SECTION_BLURB[s.key] : "Coming soon"}
              right={
                on ? (
                  <Switch
                    checked={!prefs.hidden.includes(s.key)}
                    aria-label={`Show ${s.label}`}
                    onCheckedChange={(next) => {
                      if (!setHidden(s.key, !next, openKeys)) toast(KEEP_ONE_OPEN_TOAST, { id: "customize-last" });
                    }}
                  />
                ) : (
                  <SoonPill variant="short" />
                )
              }
            />
          );
        })}
      </Group>

      <Group title="Updates">
        <Row testId="notifications" label={TAB_TITLES.notifications} sub="What we tell you, and how" onClick={() => onSelectTab("notifications")} />
        <Row testId="saved-searches" label={TAB_TITLES.saved_searches} sub="Get told when something new matches" onClick={() => onSelectTab("saved_searches")} />
      </Group>

      <Group title="Your account">
        {/* Only what Edit profile can change (app audit A3-C4: the name is shown there, not editable). Guard: src/test/settingsProfileHintMatchesForm.test.ts. */}
        <Row testId="profile" label={TAB_TITLES.profile} sub="Photo, about you, what you help with" onClick={() => onSelectTab("profile")} />
        {/* LEAD-PROFILE-LINK (owner 2026-10-31): the one shareable link; fetched only when opened. */}
        {profile && <ProfileLinkRow name={profile.full_name?.trim().split(/\s+/)[0] ?? null} changedOnce={!!profile.handle_changed_at} />}
        {/* Board 120: the row shows what is true now (your email and how you
            sign in) instead of a list of what is inside; each part only when known. */}
        <Row testId="security" label={TAB_TITLES.security} sub={accountLine(user?.email, user?.identities) ?? "Email, password, sign-in"} onClick={() => onSelectTab("security")} />
        {/* Stripe Identity: the row says where a check stands, only once there is one to report.
            Settings never asks an unverified member (owner 2026-10-30). A test account has no check. */}
        {idOn && profile && profile.is_seed !== true && ["verified", "checking", "with_team"].includes(identityView(profile.idv_status)) && (
          <Row testId="id" label="ID" sub={ID_ROW_SUB[identityView(profile.idv_status)]} onClick={() => openIdentityCheck("general")} />
        )}
        {/* A3-I4: downloads here, through the same export as the Privacy policy's card (useDataExport), instead of opening the whole policy. */}
        <Row
          testId="download-data"
          label="Download my data"
          sub={dataExport.exporting ? "Preparing your file…" : "A copy of what Helpr holds about you"}
          busy={dataExport.exporting}
          onClick={() => void dataExport.startExport()}
          right={dataExport.exporting
            ? <Loader2 className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
            : <Download className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden />}
        />
        <ShareJobPhotosRow profile={profile} />
        {/* A3-C16: unblock without having to find the person's profile first. */}
        <Row testId="blocked" label={TAB_TITLES.blocked} sub="People you blocked, and unblock" onClick={() => onSelectTab("blocked")} />
        <Row testId="warnings" label={TAB_TITLES.warnings} sub="Your account standing" onClick={() => onSelectTab("warnings")} />
        {onRequestDelete && <Row testId="delete-account" label="Delete account" sub="Permanent" danger onClick={onRequestDelete} />}
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

/** The ID row's status line, from the same states as the ID sheet. */
const ID_ROW_SUB: Record<IdentityView, string> = {
  start: "Not verified yet",
  continue: "Not finished",
  checking: "Stripe is checking",
  with_team: "With our team",
  failed: "Couldn't verify",
  verified: "Verified",
};
