import NotificationPanel from "@/components/NotificationPanel";
import HelprMark from "@/components/HelprMark";

/**
 * The signed-in app bar — emblem left, notification bell right.
 *
 * Only `DashboardBlockedScreen` (the banned / denied walls) still renders
 * this. Every regular signed-in screen dropped its app bar: Messages, My Jobs
 * and My Posts state their page name in the panel's own toolbar, and Home now
 * does the same, carrying the emblem + bell in PageScaffold's title card
 * (`DashboardTitleBar`) instead. The blocked screens keep a real bar because
 * they have no panel or toolbar to hang chrome from.
 *
 * It takes no props. It used to accept `title` / `titleAs` / `subtitle` for a
 * text title with an optional second line, and `onMenuClick` / `inProgressJob`
 * / `onViewInProgress` for header actions — every one of them was dead, and
 * the `titleAs` doc claimed "Activity, Messages … pass titleAs='h1'" when
 * neither screen has rendered this component in a long time (the app's only
 * `titleAs="h1"` is ConversationList's own toolbar heading). Renders no
 * heading element: the emblem's accessible name comes from its image `alt`, so
 * the consuming screen keeps exactly one `<h1>`.
 *
 * Sign-out intentionally lives on the Profile screen (ProfileLanding's
 * account-actions footer), not here — a one-tap logout sitting next to the
 * bell invited mis-taps and read as un-native. The admin panel shortcut moved
 * to Profile for the same reason: it is an account-level destination, not
 * per-screen chrome, and it now sits in the settings list gated on `isAdmin`.
 */
const DashboardHeader = () => (
  <header className="glass-header sticky top-0 z-50">
    <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
      <div className="flex items-center gap-2 min-w-0">
        <HelprMark to="/dashboard" size="sm" emblemOnly />
      </div>
      <div className="flex items-center gap-1.5 -mr-1">
        <NotificationPanel />
      </div>
    </div>
  </header>
);

export default DashboardHeader;
