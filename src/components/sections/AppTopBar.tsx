import { MessageSquare, Plus, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import HelprMark from "@/components/HelprMark";
import NotificationPanel from "@/components/notificationPanel/NotificationBell";
import { UserAvatar } from "@/components/UserAvatar";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { Button } from "@/components/ui/button";
import { PageTitleBar } from "@/components/header/PageTitleBar";
import { sectionByKey, type SectionKey } from "./sectionsConfig";
import { useSharedUnreadCount } from "@/components/mobileNav/navUnreadStore";
import { setCreateSheetOpen } from "@/components/mobileNav/createSheetStore";
import { hapticMedium } from "@/lib/haptics";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import { avatarButtonLabel } from "@/lib/avatarImage";

/** The tabs row's icon controls (search, filters, map, gear): 40px ghost squares with a 20px glyph, centred on the 44px tabs. */
const TABS_ROW_ICON_CLASS = "h-10 w-10 shrink-0 self-center btn-press text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)] focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] [&>svg]:w-5 [&>svg]:h-5";

/** The soft create look (the light olive tint, the olive glyph) the desktop "+ Post a job" and the phone "+" share. */
const SECTION_ADD_TINT = "rounded-full shadow-none bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] ctl-tint-on-tint";

/** The section's soft "+ Post a job" (etc.) for the DESKTOP bar; the /jobs loading frame draws the same one so the bar
 *  does not change when the page settles (src/test/sectionLoadingHeaderIsSettled.test.tsx). */
export function SectionAddButton({ section }: { section: SectionKey }) {
  const navigate = useNavigate();
  const gate = useAgeGate();
  // DESKTOP WEBSITE ONLY: the section's own "+ Post a job" (etc.) beside the bell, in the LIGHTER green, a soft
  // olive tint, clearly second to the rail's solid "+ Create" (owner 2026-10-28: "add the post a job and post an
  // item or whatever buttons back on the top nav maybe just make it the lighter green"). A phone keeps the
  // bottom bar's center "+" and no "+" here. Guard: src/test/topBarAddMatchesBell.test.tsx.
  const add = sectionByKey(section).add;
  const isPost = add?.path === "/post-job";
  const go = () => add && navigate(add.path);
  if (!add) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={add.label}
      data-testid="section-add"
      onClick={isPost ? gate.gate("post", go) : go}
      {...(isPost ? gate.gatedProps("post") : {})}
      className={`${SECTION_ADD_TINT} px-4 gap-1.5 font-semibold [&>svg]:w-[18px] [&>svg]:h-[18px]`}
    >
      <Plus aria-hidden />
      {add.cta ?? add.label}
    </Button>
  );
}

/** What the phone top bar's "+" makes, read from the route: a section's own create, or ("sheet") the Create sheet,
 *  which is Dashboard's and every screen's outside a section (owner 11-06: the + is on every screen). */
export function phoneCreateTarget(pathname: string): SectionKey | "sheet" {
  if (pathname.startsWith("/jobs") || pathname.startsWith("/posts")) return "jobs";
  if (pathname.startsWith("/declutter")) return "declutter";
  if (pathname.startsWith("/shops")) return "shops";
  if (pathname.startsWith("/rentals")) return "homes";
  return "sheet";
}

/**
 * THE PHONE "+" (owner, nav redesign 2026-11-06): it left the bottom bar's centre for the top bar, per section. On
 * Jobs it posts a job, on Declutter it sells, on Shops and Homes it is their own create (sectionsConfig `add`), and on
 * Dashboard and every other screen it opens the Create sheet ("What are we doing?"). It wears the desktop bar's soft "+ Post a job" look
 * (SECTION_ADD_TINT: the light olive tint with the olive glyph; owner 2026-11-06: "light green background with the
 * primary green plus"), so the one create control looks the same on both. Guard: src/test/centerCreateNav.test.tsx.
 */
function PhoneCreateButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const gate = useAgeGate();
  const { t: tr } = useLanguage();
  const target = phoneCreateTarget(pathname);
  const add = target === "sheet" ? null : sectionByKey(target).add;
  const isPost = add?.path === "/post-job";
  const go = () => {
    hapticMedium();
    if (add) navigate(add.path);
    else setCreateSheetOpen((o) => !o);
  };
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconCompact"
      aria-label={add ? add.label : tr("nav.create")}
      {...(add ? {} : { "aria-haspopup": "dialog" as const })}
      data-testid="top-bar-create"
      data-create-target={target}
      onClick={isPost ? gate.gate("post", go) : go}
      {...(isPost ? gate.gatedProps("post") : {})}
      className={`${SECTION_ADD_TINT} [&>svg]:w-[22px] [&>svg]:h-[22px]`}
    >
      <Plus aria-hidden strokeWidth={2.5} />
    </Button>
  );
}

/** Messages, with its unread badge, beside You (owner, nav redesign 2026-11-06: it left the bottom bar). */
function PhoneMessagesButton() {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  // READ ONLY: MobileNav (on every phone page with this bar) fills the shared store; this never opens one.
  const unreadCount = useSharedUnreadCount(user?.id);
  const { t: tr } = useLanguage();
  const n = unreadCount > 9 ? "9+" : String(unreadCount);
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconCompact"
      // WCAG 2.5.3: the count first, then the word, as the dock's badge did ("3 Messages").
      aria-label={unreadCount > 0 ? `${n} ${tr("nav.messages")}` : tr("nav.messages")}
      data-testid="top-bar-messages"
      onClick={() => navigate("/messages")}
      className="relative text-muted-foreground hover:text-foreground [&>svg]:w-[22px] [&>svg]:h-[22px]"
    >
      <MessageSquare aria-hidden />
      {unreadCount > 0 && (
        <span
          data-top-bar-badge="messages"
          aria-hidden
          className="absolute top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1"
          // Count badges are --alert, never rust (spec v2 §1.1), as the dock's were.
          style={{ background: "hsl(var(--alert))", color: "#fff" }}
        >
          {n}
        </span>
      )}
    </Button>
  );
}

/**
 * The phone top bar (owner final decisions, 2026-10-19). Right side: the
 * NOTIFICATIONS bell, then the PROFILE avatar at the far right. Left: the logo
 * on Home, the section title elsewhere. Messages lives in the bottom nav.
 *
 * NO SECTION "+" ON A PHONE: the bottom bar's center "+" creates. The desktop
 * website's section bar carries the section's soft "+ Post a job" / "+ Sell an
 * item" / "+ Open a shop" / "+ Add a property" beside the bell (owner 2026-10-28,
 * reversing the same morning's removal). Guard: src/test/topBarAddMatchesBell.test.tsx.
 *
 * ON THE DESKTOP WEBSITE the app's own header already carries the logo and the
 * bell, and the rail carries Profile, so the bar keeps only the section title;
 * on Home (no title) it draws nothing (Q2221: two logos and two bells at 1440).
 * A section's settings gear is never here: it ends the section's tabs row on
 * every width (SectionSettingsButton; owner 2026-10-28, desktop: "move gear down
 * with the other icons"). Guard: src/test/desktopTopBarNoDuplicates.test.tsx.
 */
export function AppTopBar({
  title: sectionTitle,
  explore = false,
  section,
  showProfile = true,
  desktopGap = true,
}: {
  /** Omit on Home: the logo shows instead. */
  title?: string;
  /**
   * One of Explore's four sections (2026-10-20, mock-up 6 + HELPR-DESIGN-SPEC
   * §3): on a PHONE the bar reads "Explore" (the switcher under it names the
   * section). The desktop website keeps the section's title. Guard:
   * src/test/centerCreateNav.test.tsx.
   */
  explore?: boolean;
  /**
   * The Explore section this bar heads (owner, 2026-10-22, the Explore header): on a PHONE the bar is the four
   * section chips (ExploreSwitcher) on one line with the bell and the photo, and no visible title (the section's
   * name stays the page's one h1, for a screen reader). The section's gear moves to its tabs row (SectionTabs `end`).
   */
  section?: SectionKey;
  /** False on You itself (board 18): the bar keeps only the bell, since you are already on your profile. */
  showProfile?: boolean;
  /** False inside PageScaffold's title card (Jobs, Messages), which pads itself. */
  desktopGap?: boolean;
}) {
  const navigate = useNavigate();
  const { user, profile } = useCurrentUser();
  const isWebDesktop = useIsWebDesktop();
  const { t: tr } = useLanguage();
  // Nav redesign (owner 2026-11-06): the phone's section bars name their section; the Explore chips row left with
  // Explore (the bottom bar switches sections now). `explore` and `section` stay for the desktop bar.
  void explore;
  const title = sectionTitle;
  if (isWebDesktop && !title) return null;
  const actions = isWebDesktop && section && sectionByKey(section).add ? <SectionAddButton section={section} /> : undefined;
  // The phone bar's right side, in the owner's order (2026-11-06): the bell, Messages, the "+", You.
  // Help moved INTO You (You > Help, one tap); it is no longer on the bar.
  const personal = (
    <>
      {/* AUD31-74: a guest (Declutter Browse is open to them) has no notifications: no bell, as no photo. */}
      {user && !isWebDesktop && (
      <span data-testid="top-bar-bell">
        <NotificationPanel triggerClassName="h-11 w-11 [&>svg]:w-[22px] [&>svg]:h-[22px] [&>span]:top-0.5 [&>span]:-right-0.5" />
      </span>
      )}
      {user && !isWebDesktop && <PhoneMessagesButton />}
      {user && !isWebDesktop && <PhoneCreateButton />}
      {user && !isWebDesktop && showProfile && (
        <Button
          type="button"
          variant="ghost"
          size="iconCompact"
          aria-label={avatarButtonLabel(tr("nav.profile"), profile?.full_name)}
          data-testid="top-bar-profile"
          onClick={() => navigate("/profile")}
        >
          <UserAvatar userId={user.id} src={profile?.avatar_url} name={profile?.full_name} pixelSize={72} alt="" className="w-9 h-9" />
        </Button>
      )}
    </>
  );
  // ONE header row (owner 2026-10-21): on the desktop website the title goes into
  // the global top bar beside the bell and photo.
  return (
    <PageTitleBar
      title={title ?? ""}
      actions={actions}
      desktopGap={desktopGap}
      phone={
        <header className="app-top-bar flex items-center justify-between gap-2 h-16" data-testid="app-top-bar">
          {title ? (
            <h1 className="min-w-0 truncate text-page-title text-foreground" title={title}>{title}</h1>
          ) : (
            <HelprMark size="sm" emblemOnly to="/home" />
          )}
          <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
            {personal}
          </div>
        </header>
      }
    />
  );
}

/**
 * The section's settings GEAR (owner, 2026-10-21: Jobs settings moved from a card at the foot of Posted / Working into
 * the header): the LAST control at the right end of the section's tabs row, on every tab and every width (phone, owner
 * 2026-10-22: the chips row has no room; desktop, owner 2026-10-28: "move gear down with the other icons"), so it
 * never jumps between tabs. The same 40px ghost square as the row's search, filters and map.
 * Guard: src/test/profileIsAccountMoneyHelp.test.tsx.
 */
export function SectionSettingsButton({ settings }: { settings: { label: string; labelKey?: MsgKey; path: string } }) {
  const navigate = useNavigate();
  const { t: tr } = useLanguage();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={settings.labelKey ? tr(settings.labelKey) : settings.label}
      data-testid="section-settings"
      onClick={() => navigate(settings.path, { replace: false })}
      className={TABS_ROW_ICON_CLASS}
    >
      <Settings aria-hidden />
    </Button>
  );
}
