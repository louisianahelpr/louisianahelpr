import type { ReactNode } from "react";
import PublicLayout from "@/components/marketing/PublicLayout";
import PageHeader from "@/components/PageHeader";
import { PUBLIC_CONTAINER } from "@/lib/publicContainer";

interface PublicHeaderPageProps {
  title: string;
  backTo?: string;
  /** Forwarded to PageHeader: the arrow's own action (it then ignores history), e.g. always Home. */
  onBack?: () => void;
  /** Forwarded to PageHeader: the arrow's accessible name when it goes to one named place ("Go to Home"). */
  backLabel?: string;
  /** Matches PageHeader's `width` — the ladder that lines the title up with
   *  the body column beneath it. Defaults to "public"
   *  (`px-5 sm:px-8 lg:px-12` over `.page-measure`), the ladder every
   *  current call site (Legal, Help Center) uses; Jobs overrides to
   *  "default" (`page-measure px-5 lg:px-6 xl:px-6`) to match its own body. */
  width?: "public" | "default" | "none";
  /** Bottom padding for the body wrapper below the header — each page still
   *  owns its own closing rhythm (Jobs: `pb-safe-nav`, Legal/Help: `pb-8`+).
   *  Top padding is NOT a param: the header owns the full gap above AND
   *  below the title itself (`--shell-gap` = 12px on phone, 24px from `sm` up), so the body
   *  must never add its own — see the note on PageHeader's own padding. */
  bottomPaddingClassName: string;
  /** Optional wrapper class around just the <PageHeader> — e.g. Jobs' own
   *  entrance-fade animation. Adds no padding/max-width of its own, so it
   *  never touches the header's container geometry. */
  headerWrapperClassName?: string;
  /** Trailing controls on the title ROW itself — forwarded verbatim to
   *  PageHeader. Exists so a page with header actions (the guest /browse feed
   *  puts its search + filter icons here) can still use this shell instead of
   *  hand-rolling PublicLayout + PageHeader + a padded body, which is the
   *  drift this component exists to prevent. Omitted by Legal, Help Center
   *  and Support, which have no title-row actions, so their headers are
   *  byte-identical to before. */
  titleActions?: ReactNode;
  /** Forwarded to PageHeader: let a long title wrap instead of truncating. */
  wrapTitle?: boolean;
  /** Forwarded to PublicLayout's `footer`: false while the body is still
   *  loading (Q1312), so the page needs no screen-tall reserve under it. */
  footer?: boolean;
  /** A top-level page (guest /browse, F019 owner UI audit 11-09): no back arrow; there is nowhere "back" to go. */
  hideBack?: boolean;
  /** Forwarded to PageHeader: on a phone keep the h1 for screen readers only (the page paints the name itself; /u). */
  phoneHidesTitle?: boolean;
  /** Forwarded to PageHeader: keep the h1 for screen readers only at every width (the job link's not-found, error
   *  and loading states, whose card carries its own title; Jobs audit 11-21 P6). */
  hidesTitle?: boolean;
  /** Forwarded to PageHeader: "p" when the page's body holds its own h1 (the gift guides' banner title). */
  titleTag?: "h1" | "p";
  /** No header row at all: the page's body opens with its own h1 and has no back arrow or title-row actions (the
   *  /gift-guides landing, owner 11-20: one title, not "Gift guides" over "Holiday Gift Guides"). */
  hideHeader?: boolean;
  children: ReactNode;
}

/**
 * PublicHeaderPage — the one shell shared by every "back button + title,
 * then a body" public/marketing page (Legal, Help Center, Jobs).
 *
 * Before this, each page hand-rolled the same
 * `<PublicLayout><PageHeader .../><div className="px-5 ... pb-*">…</div></PublicLayout>`
 * skeleton with its own comment block re-explaining the same contract —
 * and the three copies drifted: Legal and Help Center both grew a stray
 * `pt-4` on their body wrapper that double-stacked onto PageHeader's own
 * `pb-6`, so the title-to-content gap silently became 40px on those two
 * pages while every other PageHeader page held to 24 (owner, 2026-08-30:
 * "legal help center and jobs should all be one component and share the
 * same shell"). One shell means that drift can't happen again — the gap
 * rule lives in exactly one place.
 */
export function PublicHeaderPage({
  title,
  backTo = "/",
  onBack,
  backLabel,
  width = "public",
  bottomPaddingClassName,
  headerWrapperClassName,
  titleActions,
  wrapTitle = false,
  footer = true,
  hideBack = false,
  phoneHidesTitle = false,
  hidesTitle = false,
  titleTag = "h1",
  hideHeader = false,
  children,
}: PublicHeaderPageProps) {
  const header = (
    <PageHeader
      title={title}
      backTo={backTo}
      onBack={onBack}
      backLabel={backLabel}
      hideBack={hideBack}
      phoneHidesTitle={phoneHidesTitle}
      hidesTitle={hidesTitle}
      titleTag={titleTag}
      width={width}
      topInsetHandled
      titleActions={titleActions}
      wrapTitle={wrapTitle}
    />
  );
  return (
    <PublicLayout footer={footer}>
      {/* F017 (owner UI audit 11-09): the title and body sit in the same 78rem container as the bar (Navbar
          PUBLIC_CONTAINER), so the logo, the title and the content share a left edge on every public page. */}
      {/* Holiday audit 1121 #1 (High, live): signed in, PublicLayout is AppShell, whose scroll area is a flex column, and
          `mx-auto` on a flex item turns stretch off, so this box shrank-to-fit its content's min-content: the gift guides'
          phone chip row (771px of nowrap chips) made every guide page 771px wide inside 375. `w-full min-w-0` keeps the
          box the column's width (max-w still caps it). Guard: src/test/signedInPhoneGuidesFit1121.test.tsx. */}
      <div data-public-container="" className={`${PUBLIC_CONTAINER} w-full min-w-0`}>
        {hideHeader ? null : headerWrapperClassName ? <div className={headerWrapperClassName}>{header}</div> : header}
        <div className={`px-5 sm:px-8 lg:px-12 ${bottomPaddingClassName}`}>
          {children}
        </div>
      </div>
    </PublicLayout>
  );
}
