import BackButton from "@/components/BackButton";
import { PageTitleBar } from "@/components/header/PageTitleBar";

/**
 * Every admin view's back arrow + title. ONE header row (owner, 2026-10-21,
 * and for admin 2026-10-27: "support and any other page title should be at the
 * top, not pushed down like that"): on the desktop website the row is drawn IN
 * the global top bar (DesktopTopNav), left-aligned and level with the bell and
 * photo, exactly as /jobs draws "Jobs". It used to render as its own row inside
 * the admin scroll container, ~100px below the bar with an empty band between.
 * Admin.tsx renders this once for every view (via AdminFrame), so no view has
 * a title row of its own. Guard: src/test/oneHeaderRow.test.ts and
 * src/test/adminTitleInTopBar.test.tsx.
 *
 * On a phone (and native) there is no desktop bar: AdminFrame hands this
 * header to the admin's own top bar (AdminTopBar `titleRow`), so the phone
 * form below sits IN that bar's row, left of the bell and menu, in place of
 * the emblem, the way AppTopBar draws "Jobs" on a phone. One row either way.
 */
const AdminSectionHeader = ({ title, phoneTitle, onBack }: {
  title: string;
  /** A shorter title for the phone bar when the full one would be cut (ADMIN_PHONE_TITLES, AUD31-48). */
  phoneTitle?: string;
  onBack: () => void;
}) => (
  <PageTitleBar
    title={title}
    back={{ onBack }}
    // The admin scroll container already pads its content from the bar
    // (lg:p-8), so the shared row's extra gap would stack a second band on it.
    desktopGap={false}
    phone={
      // gap-3, matching PageHeader and ProfileTabHeader — the project standard
      // names `flex items-center gap-3` as THE back+title row. Centred in the
      // bar's 56px row; no bottom margin, since the bar is not in the flow.
      <div className="flex items-center gap-3 min-w-0" data-admin-title-row="">
        <BackButton onClick={onBack} />
        <div className="flex flex-col leading-none min-w-0">
          <h1
            // THE SAME TITLE TYPE AS EVERY OTHER SCREEN — `font-display
            // font-bold text-headline-hero`, verbatim from ScreenHeaderRow
            // (owner: "title fonts are not correct in admin"; one page-title
            // size, Q236(e)). Admin is the same product, wearing the same
            // chrome, so it no longer sets a heading face of its own.
            className="font-display font-bold leading-tight truncate text-headline-hero"
            style={{
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {phoneTitle ?? title}
          </h1>
        </div>
      </div>
    }
  />
);

export default AdminSectionHeader;
