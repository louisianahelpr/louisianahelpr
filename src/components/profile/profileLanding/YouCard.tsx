import { useNavigate } from "react-router-dom";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/UserAvatar";
import { hasIdBadge } from "@/lib/awardGate";
import type { Profile } from "./types";
import { PROFILE_NAME_HEADING_LEVEL } from "./headingContract";
import { memberProfilePath } from "@/lib/profileLink/memberProfilePath";
import "@/lib/i18n/enYourPage";
import { useLanguage } from "@/lib/i18n/language";
import { t } from "@/lib/i18n/language";
import "@/lib/i18n/enChatParts";

/** Edit profile: You > Settings > Your account > Edit profile, opened directly. */
export const EDIT_PROFILE_PATH = "/profile?tab=profile";

/** Spec v2 §9.8: the You header names an ID-verified member this way. */
export const VERIFIED_NEIGHBOR = "Verified neighbor";

/**
 * The line under the name on board 18: "Verified neighbor · 5.0 · 1 review".
 * Every part is real or absent (spec v2 §1.5): the seal words only when the ID
 * check passed, the rating only with at least one review.
 */
export function youCardFacts(verified: boolean, avgRating: number | null, reviewCount: number): string {
  const parts: string[] = [];
  // Area 08 H2: in the app language (the chat's job card read "Verified neighbor · 11 reviews" in Spanish).
  if (verified) parts.push(t("cp.verified"));
  if (reviewCount > 0 && avgRating != null) {
    parts.push(avgRating.toFixed(1));
    parts.push(t(reviewCount === 1 ? "cp.review" : "cp.reviews", { n: reviewCount }));
  }
  return parts.join(" · ");
}

/**
 * BOARD 18's slim profile card: photo with the verified seal, name, the facts
 * line and "View my public profile". The photo and the link both open the
 * public profile, the page other members see. "Edit" (app audit A3-C6,
 * 2026-10-29) opens Edit profile directly; it was reachable only through
 * You > Settings > Your account > Edit profile.
 */
export function YouCard({
  profile,
  userId,
  displayName,
  avgRating,
  reviewCount,
}: {
  profile: Profile | null;
  userId?: string | null;
  displayName: string;
  avgRating: number | null;
  reviewCount: number;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  // Stripe Identity only (owner 2026-10-21); payout setup never draws the seal.
  const verified = hasIdBadge(profile?.idv_status);
  const facts = youCardFacts(verified, avgRating, reviewCount);
  const Heading = `h${PROFILE_NAME_HEADING_LEVEL}` as "h2";
  const open = () => userId && navigate(memberProfilePath(userId));
  return (
    <div data-testid="you-card" className="liquid-glass shrink-0 w-full flex items-center gap-4 px-4 py-4 min-w-0">
      {/* The photo repeats the "View my public profile" button beside it, so it is out of the tab order and the
          accessibility tree: its only visible text is the monogram, which an aria-label could not contain
          (axe label-content-name-mismatch, WCAG 2.5.3; ui-sweep #3491). */}
      <button type="button" onClick={open} disabled={!userId} aria-label={t("yp.you.publicProfile")} className="btn-press relative shrink-0 rounded-full" aria-hidden="true" tabIndex={-1}>
        <UserAvatar userId={userId ?? undefined} src={profile?.avatar_url} name={displayName} pixelSize={128} alt="" className="w-16 h-16" />
        {verified && (
          <span
            data-testid="you-card-seal"
            aria-hidden
            className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--bark))", boxShadow: "0 0 0 2px hsl(var(--ivory-sand))" }}
          >
            <Check className="w-3 h-3" style={{ color: "hsl(var(--primary-foreground))" }} />
          </span>
        )}
      </button>
      <div className="min-w-0 flex flex-col items-start">
        {/* The member's name at PROFILE_NAME_HEADING_LEVEL: the sign-back-in journey reads it (headingContract.ts). */}
        <Heading className="max-w-full text-ds-18 font-bold text-foreground leading-tight truncate" title={displayName || t("yp.you.yourProfile")}>
          {displayName || t("yp.you.yourProfile")}
        </Heading>
        {facts && <p className="max-w-full text-ds-13 text-muted-foreground truncate mt-0.5" title={facts}>{facts}</p>}
        <Button type="button" variant="ghost" size="sm" onClick={open} disabled={!userId} className="-my-2 px-0 text-ds-13 tracking-normal disabled:opacity-100" style={{ color: "hsl(var(--bark))" }}>
          {t("yp.you.publicProfile")}
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="you-card-edit"
        aria-label={t("yp.you.editLabel")}
        onClick={() => navigate(EDIT_PROFILE_PATH)}
        className="btn-press ml-auto shrink-0 min-w-11 gap-1.5 px-2 text-ds-13 tracking-normal [&_svg]:size-4"
        style={{ color: "hsl(var(--bark))" }}
      >
        <Pencil aria-hidden />
        {/* Icon only on a phone: the word cost "View my public profile" its one line at 375. */}
        <span className="max-sm:hidden">{t("yp.you.edit")}</span>
      </Button>
    </div>
  );
}
