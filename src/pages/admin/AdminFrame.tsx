import type { ComponentProps, ReactNode } from "react";
import { Suspense } from "react";
import { SignOutConfirmDialog } from "@/components/auth/SignOutConfirmDialog";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminTopBar from "@/components/admin/AdminTopBar";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import { ADMIN_PHONE_TITLES } from "@/components/admin/adminNavGroups";
import { AdminCommandPalette } from "@/components/admin/AdminCommandPalette";
import { HelprSpinner } from "@/components/ui/HelprSpinner";

/** What /admin renders inside its page wrapper: the mobile top bar, the scroll
 *  container, the section header, the mobile rail and the sign-out confirm.
 *  Moved verbatim out of Admin.tsx (component-size ratchet, Q806). Admin.tsx
 *  keeps the <SidebarProvider> and the document-scroll wrapper div (the shell
 *  shellConsistency checks), and the view content arrives as `children`
 *  instead of a `renderContent()` call. Every value read here is still
 *  computed in Admin.tsx and passed in under its original name. */
export function AdminFrame({
  isWebDesktop,
  view,
  viewLabels,
  handleViewChange,
  navGroups,
  getBadge,
  getBadgeColor,
  showLogoutDialog,
  setShowLogoutDialog,
  navigate,
  children,
}: {
  isWebDesktop: boolean;
  view: string;
  viewLabels: Record<string, string>;
  handleViewChange: (view: string) => void;
  navGroups: ComponentProps<typeof AdminSidebar>["navGroups"];
  getBadge: (id: string) => number | undefined;
  getBadgeColor: (id: string) => string;
  showLogoutDialog: boolean;
  setShowLogoutDialog: (open: boolean) => void;
  navigate: (to: string) => void;
  children: ReactNode;
}) {
  // ONE header row for every admin view (owner, 2026-10-27: "support and any
  // other page title should be at the top, not pushed down like that"). On the
  // desktop website AdminSectionHeader portals itself into the global top bar
  // (PageTitleBar); on a phone AdminTopBar draws it in its own row. It used to
  // be a row of its own inside the scroll container, ~100px under the bar.
  // Guard: src/test/adminTitleInTopBar.test.tsx.
  const header = view !== "home"
    ? <AdminSectionHeader title={viewLabels[view]} phoneTitle={ADMIN_PHONE_TITLES[view]} onBack={() => handleViewChange("home")} />
    : null;
  return (
    <>
      {/* Top padding ONLY below `lg`, where admin renders its own fixed bar.
          On the desktop website the global bar's height is already reserved
          by `html.web-desktop.desktop-rail:not(.app-shell) #root
          { padding-top: 3.5rem }` — /admin is a document-scroll route — so a
          pt-14 here would stack a second 56px on top of it. */}
      <div
        className="flex-1 flex flex-col min-w-0"
        style={
          isWebDesktop
            ? undefined
            : // `3.5rem + var(--safe-area-top)`, not a bare `pt-14`.
              //
              // AdminTopBar is `fixed` and pads ITSELF by the safe-area top
              // inset, so on a device its real height is inset + 56px — 118px
              // on an iPhone 17 Pro (62 + 56). This spacer reserved only the
              // 56px, so every admin screen sat 62px too high UNDER the bar.
              // Measured in the simulator's WKWebView on 2026-08-31: the
              // AdminSectionHeader <h1> ("Users", "Disputes", "Analytics", …)
              // had its top at y=72 while the bar's bottom was at y=118 — the
              // page title was occluded by the chrome on all 24 views, and
              // the Dashboard's "Welcome back" with it. Chrome never showed
              // it because `--safe-area-top` is 0 in a desktop browser, which
              // is exactly why this needed the device pass to catch.
              { paddingTop: "calc(3.5rem + var(--safe-area-top, 0px))" }
        }
      >
        {/* NO SECOND TOP BAR ON THE DESKTOP WEBSITE.
            App.tsx mounts DesktopTopNav and DesktopSidebarNav unconditionally
            for every signed-in user, and neither hides on /admin — so this
            page was rendering TWO top bars and TWO rails stacked on top of
            each other. That is the actual reason the admin chrome kept
            reading as wrong no matter how many times its own bar was
            adjusted: the bar being fixed was not the bar being seen.

            Below `lg` the global pair is `hidden lg:flex`, so admin still
            needs its own — hence the split rather than a plain delete. */}
        {!isWebDesktop && <AdminTopBar titleRow={header} />}

        {/* A <div>, not a <main>: App.tsx already wraps every route in
            <main id="main-content">, and a second one nested inside it
            failed axe's landmark-main-is-top-level / -no-duplicate-main /
            -unique on all 26 admin screens (Q211). This is only the admin
            scroll container. Guarded by src/test/oneMainLandmark.test.ts. */}
        <div data-admin-scroll
          className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8 pb-[calc(2rem_+_var(--safe-area-bottom,0px))]"
        >
          {/* Mounted once, inside admin only: the shortcut should not exist
              on the rest of the app, where there are no sections to jump
              between. It routes through handleViewChange so a jump behaves
              exactly like a rail click — same seen-marking, same URL write. */}
          <AdminCommandPalette onSelect={handleViewChange} />
          {/* Renders nothing here: it portals into the desktop bar. */}
          {isWebDesktop && header}
          {/* The app's one loading mark (HelprSpinner, which carries its own
              role="status"), not a hand-rolled border spinner (Q191). */}
          <Suspense fallback={<div className="flex items-center justify-center py-12"><HelprSpinner size={32} /></div>}>
            {children}
          </Suspense>
        </div>
      </div>

      {/* Same split as the top bar. On the desktop website the GLOBAL side
          panel carries admin — "Admin" with every section nested under it
          (owner: "the side panel should be identical to a non-admin user,
          just add the admin sections under the Admin in the sidebar"), so a
          second rail here is the other half of the double chrome.
          Below `lg` this is the only rail there is, and it keeps its own
          Back to App / Sign Out rows. */}
      {!isWebDesktop && <AdminSidebar
        navGroups={navGroups}
        activeView={view}
        onSelect={handleViewChange}
        getBadge={getBadge}
        getBadgeColor={getBadgeColor}
        onLogout={() => setShowLogoutDialog(true)}
      />}

      {/* ONE verb: "sign out". The app says Sign Out on nine screens
          (Profile settings, Security, Account Pending/Denied/Banned,
          Complete Profile, the blocked-dashboard state) and "log out" on
          almost nothing, so the odd ones out were the two confirm dialogs and
          the admin sidebar that opens this one — the control read "Log Out",
          the dialog said "Log out", and the cancel offered "Stay logged in",
          while every other surface in the product said sign. Title Case per
          the app-wide Apple-HIG rule for buttons and alert titles. */}
      <SignOutConfirmDialog
        open={showLogoutDialog}
        onOpenChange={setShowLogoutDialog}
        title="Sign out?"
        description="You'll need to sign back in next time. Your posts and messages stay safe."
        label="Sign Out"
        after={() => navigate("/")}
      />
    </>
  );
}
