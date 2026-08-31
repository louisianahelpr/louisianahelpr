import type { ReactNode } from "react";
import PublicLayout from "@/components/marketing/PublicLayout";
import PageHeader from "@/components/PageHeader";

interface PublicHeaderPageProps {
  title: string;
  backTo?: string;
  /** Matches PageHeader's `width` — the ladder that lines the title up with
   *  the body column beneath it. Defaults to "public"
   *  (`px-5 sm:px-8 lg:px-12` over `.page-measure`), the ladder every
   *  current call site (Legal, Help Center) uses; Jobs overrides to
   *  "default" (`page-measure px-5 lg:px-8 xl:px-12`) to match its own body. */
  width?: "public" | "default" | "none";
  /** Bottom padding for the body wrapper below the header — each page still
   *  owns its own closing rhythm (Jobs: `pb-safe-nav`, Legal/Help: `pb-8`+).
   *  Top padding is NOT a param: the header owns the full gap above AND
   *  below the title itself (16px on phone, 24px from `sm` up), so the body
   *  must never add its own — see the note on PageHeader's own padding. */
  bottomPaddingClassName: string;
  /** Optional wrapper class around just the <PageHeader> — e.g. Jobs' own
   *  entrance-fade animation. Adds no padding/max-width of its own, so it
   *  never touches the header's container geometry. */
  headerWrapperClassName?: string;
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
  width = "public",
  bottomPaddingClassName,
  headerWrapperClassName,
  children,
}: PublicHeaderPageProps) {
  const header = <PageHeader title={title} backTo={backTo} width={width} topInsetHandled />;
  return (
    <PublicLayout>
      {headerWrapperClassName ? <div className={headerWrapperClassName}>{header}</div> : header}
      <div className={`px-5 sm:px-8 lg:px-12 ${bottomPaddingClassName}`}>
        {children}
      </div>
    </PublicLayout>
  );
}
