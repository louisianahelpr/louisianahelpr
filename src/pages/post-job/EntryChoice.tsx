import { useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FileText, ChevronRight } from "lucide-react";
import { START_EMOJI } from "@/lib/categoryEmoji";
import { PostJobStepHeader } from "@/components/postjob/PostJobStepHeader";
import { sampleJobs } from "@/data/sampleJobs";
import { usePostedBefore, useRecentPostedJobs } from "@/hooks/useRecentPostedJobs";
import { track } from "@/lib/analytics";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { ChoiceCard } from "@/components/ui/ChoiceCard";
import { JobCategoryGroups } from "@/components/postjob/JobCategoryGroups";
import { AiJobBuilder } from "@/components/postjob/AiJobBuilder";
import { OfferToSavedHelpr, useSavedHelpersLite } from "./OfferToSavedHelpr";
import { OpenJobLimitNotice } from "./OpenJobLimitNotice";
import GiftCardTeaser from "./GiftCardTeaser";
import { useSpendableGiftCards } from "@/hooks/useSpendableGiftCards";
import { formatPrice, formatShortDate } from "@/lib/format";
import type { usePostJobForm } from "./usePostJobForm";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { useDraftCheckout } from "./useDraftCheckoutState";

/**
 * The entry column while its data rows settle: one collapsed-card shell per
 * real card, the shape and height (104px) of the real rows, so the column
 * holds its place and hands over to the real cards in one step.
 *
 * Five cards, always. Owner, 2026-10-01: "Offer It to a Saved Helpr" renders
 * for everyone, including an account with no saved Helprs (it used to hide
 * itself, so the real column was 4 or 5 cards and this placeholder could match
 * only one of them — a 122px jump on arrival at 375).
 *
 * DATA-AWARE (owner, 2026-10-03, Q722): the skeleton draws the column the
 * KNOWN data says will land, not the populated one. Four cards always render
 * (Start from scratch, Use a template, Offer to a saved Helpr, Get help from AI); "Pick Up Your Draft" and "Repost" are each drawn only once their
 * read has landed and says the card will show. While a read is in flight it
 * counts as absent: a cold visit (nothing cached) is mostly a new account,
 * which has neither, so its column holds 4 cards from first paint to last.
 * The fixed 5 drew the populated column and collapsed 112px at 375 on both
 * test accounts (2026-10-05).
 *
 * JOB HISTORY DECIDES THE REPOST CARD (owner, 2026-10-17): a poster with past
 * jobs gets five bones, everyone else four, so nobody sees a jump. Drawing
 * four until the read landed grew a returning poster's column by the Repost
 * card, inserted second (loading-states-refresh 39008870955, poster-e2e at
 * 375: 452px -> 574px). The answer comes from the read once it lands and,
 * before that, from what this device learned last visit (usePostedBefore).
 * On a device that has never asked (a returning poster on a new device, a
 * cleared cache) the column draws the first-time default of FOUR (lead,
 * 2026-10-17): a blank region during load is the defect class we avoid, and
 * only that rare case then sees the Repost card arrive.
 */
/*
 * JA-41 (owner pick, 2026-11-01): the first screen IS the group grid ("What do you need done?"), and the other
 * ways to start (template, saved Helpr, AI, repost) are small links under it, so a tap is saved before the first
 * field. The grid is static, so the skeleton draws the real grid (inert) and bones only for the data-dependent
 * rows: the three links always, plus "Pick up your draft" and "Repost a recent job" once known. The counting rule
 * above (job history decides Repost) is unchanged; the base is now the three links.
 */
export const ENTRY_BASE_CARD_COUNT = 3;

/** Data-dependent rows (links, plus the draft card) the column will hold, from what is known so far. */
export function entryCardCount(known: { draftCard: boolean; repostCard: boolean }): number {
  return ENTRY_BASE_CARD_COUNT + (known.draftCard ? 1 : 0) + (known.repostCard ? 1 : 0);
}

function EntryChoiceSkeleton({ draftCard, links, grid }: { draftCard: boolean; links: number; grid: ReactNode }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-busy="true" data-testid="entry-choice-skeleton">
      <span className="sr-only">Loading…</span>
      {draftCard && (
        <div data-entry-bone="" className="rounded-2xl border border-border bg-card p-card flex items-center" style={{ minHeight: "104px" }} aria-hidden>
          <div className="flex items-center gap-4 w-full">
            <Skeleton className="w-11 h-11 rounded-full shrink-0" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-3 w-28 rounded mt-1.5" />
            </div>
          </div>
        </div>
      )}
      {/* The real grid, inert until the column lands: same tiles, same place, no jump. */}
      <div inert aria-hidden>{grid}</div>
      <div className="flex flex-col">
        {Array.from({ length: links }).map((_, i) => (
          <div key={i} data-entry-bone="" className="flex min-h-[44px] items-center" aria-hidden>
            <Skeleton className="h-4 w-44 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface EntryChoiceProps {
  form: ReturnType<typeof usePostJobForm>;
}

/** Short relative date phrase for the Repost tile labels. */
function shortRelativeDate(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  // Long enough ago — show a month + day.
  return formatShortDate(then);
}

/**
 * EntryChoice — Post a Job step 0, "How do you want to start?" (owner 2026-10-21; mock-up
 * helpr-postjob-flow-mockup.png): Start from scratch, Use a template, Offer to a saved Helpr, Get help
 * from AI, each a card with an olive-circle icon. Scratch goes to screen 1; the other three open in
 * place of the cards (usePostJobForm `entryPanel`), and back returns to the cards. A returning
 * poster's kept draft and recent jobs follow as the same card.
 *
 * Purely presentational — all transitions/handlers come from usePostJobForm.
 */
export function EntryChoice({ form }: EntryChoiceProps) {
  /* NO UNPAID JOBS HERE (owner, 2026-09-27): "Finish paying should not even
     be a thing." A job exists for the poster only once it is paid; a checkout
     they back out of returns them to their own local draft (useJobSubmit keeps
     it until /payment-success), never to a server row to pay for. */
  // Q769: the kept draft's last checkout — paid hides "Load Draft", a live
  // session warns that the poster may already have paid.
  const { state: draftCheckout, settled: draftCheckoutSettled } = useDraftCheckout(form.hasDraft);
  // Quick-start templates pre-fill the form in one tap. We show the first
  // four by default and reveal the rest on "Show all" — the full set now
  // lives entirely on this entry step (the in-form template picker was
  // removed), so there's no longer a link that pushed into an empty form.
  const quickTemplates = sampleJobs.slice(0, 4);
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const visibleTemplates = showAllTemplates ? sampleJobs : quickTemplates;

  // Last 3 jobs this poster has created — shown as "Repost" tiles so a
  // returning user can spin up a near-duplicate request in one tap. The
  // hook returns `null` while loading and `[]` when the user has never
  // posted, so the row hides itself for first-time posters.
  const recentPosted = useRecentPostedJobs(3);
  const navigate = useNavigate();
  // The entry screen can be reached WITH state already in the URL — most
  // importantly `gift_card` (and its `budget`), because a gift recipient
  // lands here from "Use This Gift" and then picks how to start their post.
  // Rebuilding the query string from scratch silently dropped all of it, so
  // choosing "Repost" spent no gift and charged full price. Preserve what's
  // there and only ADD the new intent.
  const [searchParams] = useSearchParams();

  // Repost + template lists are collapsed by default so "Start fresh" reads
  // as the primary action — the user opens a section only when they want it.
  /**
   * ONE section open at a time (owner: "I only used a template and the other
   * opened"). Each collapsible card used to own an independent boolean, so
   * opening Templates left Repost — and the AI builder — expanded underneath,
   * and in the two-column grid an open section stretched its neighbour to
   * match. A radio, not three checkboxes: these are alternative ways to start
   * the SAME post, so at most one can be the one you are using.
   */
  // Step 0's chosen way to start lives on the form (usePostJobForm `entryPanel`), so the page's back
  // arrow returns to the four cards. `?start=ai` opens the AI builder there.
  const panel = form.entryPanel;

  // Tap a Repost tile → reuse the existing `?rebook=<id>` deep-link the
  // form already handles, which prefills every field and skips the entry
  // step. Keeps this entry-screen logic thin.
  const handleRepost = (jobId: string) => {
    track("post_job_entry_choice", { choice: "repost_recent" });
    const next = new URLSearchParams(searchParams);
    next.set("rebook", jobId);
    // The rebook prefill supplies its own budget from the previous job, so a
    // `budget` seeded by a gift link would be overwritten a moment later
    // anyway. Drop it rather than leave a stale number racing the prefill.
    next.delete("budget");
    navigate(`/post-job?${next.toString()}`);
  };

  const hasRecent = recentPosted && recentPosted.length > 0;
  const postedBefore = usePostedBefore(recentPosted);
  // Same predicate FormStep uses; `null` means the preflight count has not
  // landed yet, which must read as "not at the limit", never as a refusal.
  const atOpenJobLimit = form.openJobCount !== null && form.openJobCount >= 5;

  // ONE PAINT (Q169). Two rows here depend on data — the open-job cap notice
  // and "Repost" — and both sit ABOVE the static cards. Painted as each query
  // landed, measured at 375 on prod, rows arriving late shoved the static cards
  // down (CLS 0.32). The column holds a card-shaped skeleton until both have
  // settled, then renders once in its final order.
  // HOLD UNTIL DATA (owner, 2026-09-30, Q1654 P1): every read that adds,
  // removes or reshapes a card here (the kept draft and its checkout state,
  // the recent jobs, the open-job count, the saved helprs) is PRIMARY, so the
  // skeleton stays until all of them are in and the ARRIVAL_CAP_MS cap (which
  // only bounds secondary data) never paints a half-built column. Each read
  // settles on an error too, so a failure cannot hold the skeleton forever.
  // The saved-helprs card always renders now (owner, 2026-10-01), but the gate
  // still waits on its list so the card never opens onto "Loading…" (a
  // disabled query, no user, counts as settled). Same cache entry the card
  // reads, so no second request.
  const savedHelpers = useSavedHelpersLite();
  const savedHelpersSettled = savedHelpers.fetchStatus === "idle" || savedHelpers.status !== "pending";
  // The gift card banner sits at the very top of the column, so whether it is
  // there is primary data too (owner, 2026-10-01: moved here from /home).
  const giftCards = useSpendableGiftCards();
  const giftCardsSettled = giftCards.settled;
  // Already spending a gift (`?gift_card=` from "Use This Gift"): telling the
  // user a gift is waiting is noise, so the banner stays out of the way.
  const showGiftBanner = !!giftCards.userId && giftCards.ids.length > 0 && !searchParams.has("gift_card");
  const entryReady = useArrivalGate(
    form.draftLoaded && draftCheckoutSettled && recentPosted !== null && form.openJobCount !== null && savedHelpersSettled && giftCardsSettled,
    true,
  );
  // Job history not known yet on this device (postedBefore null): the
  // first-time default of four, never an empty column (see
  // ENTRY_BASE_CARD_COUNT).
  // The question paints with the screen; only the cards wait for their data.
  const startHeader = (
    <div className="mb-3">
      <PostJobStepHeader screen="groups" question="What do you need done?" helper="Search, or pick a category." />
    </div>
  );
  // JA-41: a group tap starts the form at that group's kinds (screen 2); a one-category group or a search
  // match is the category and goes on to Details. The 5-open-job cap stops it here (its notice sits above).
  const groupGrid = (
    <JobCategoryGroups
      category={form.category}
      setCategory={form.setCategory}
      group={null}
      setGroup={(g) => {
        if (atOpenJobLimit || !g) return;
        form.startFresh();
        form.setFormPage(1);
        form.setCategoryGroup(g);
      }}
      onPicked={() => {
        if (atOpenJobLimit) return;
        form.startFresh();
        form.setFormPage(2);
      }}
    />
  );
  if (!entryReady) {
    const draftCard = form.draftLoaded && draftCheckoutSettled && form.hasDraft && draftCheckout !== "paid";
    const count = entryCardCount({
      draftCard,
      repostCard: postedBefore === true,
    });
    return (
      <div className="flex flex-col gap-3">
        {startHeader}
        <EntryChoiceSkeleton draftCard={draftCard} links={count - (draftCard ? 1 : 0)} grid={groupGrid} />
      </div>
    );
  }

  // The shared first-step card (owner 2026-10-30: Declutter's "What do you want to sell?" uses the same one).
  const startCard = (key: string, icon: ReactNode, title: string, line: string, onClick: () => void, extra?: ReactNode) => (
    <ChoiceCard key={key} icon={icon} title={title} line={line} onClick={onClick} extra={extra} />
  );

  // A small link under the grid (JA-41): 44px tall, one line, the way-to-start emoji before it.
  const entryLink = (key: string, emoji: string, label: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      data-entry-link={key}
      onClick={onClick}
      className="flex min-h-[44px] w-fit items-center gap-2 font-sans text-ds-14 font-semibold text-[hsl(var(--bark))] underline-offset-2 hover:underline"
    >
      <span aria-hidden className="text-ds-15 leading-none">{emoji}</span>
      {label}
    </button>
  );

  // A way to start, opened in place of the cards (owner 2026-10-21: "tapping goes straight on"). The
  // page's back arrow returns to the cards (handlePostJobBack).
  if (panel) {
    const head = {
      templates: { q: "Pick a template", h: "Start from a common job, then edit anything." },
      offer: { q: "Pick a saved Helpr", h: "They get first refusal for a window you set, before it opens to everyone." },
      ai: { q: "Describe the job", h: "In your own words. AI fills in the form, and you check it." },
      repost: { q: "Repost a recent job", h: "The quickest way to ask for the same help again." },
    }[panel];
    return (
      <div className="space-y-section">
        <PostJobStepHeader screen="groups" question={head.q} helper={head.h} />
        {panel === "templates" && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {visibleTemplates.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => {
                    // A template fills category, title and description (never the price): it lands on Details (4 of 7).
                    form.useTemplate(() => form.applyTemplateFields(sample));
                    form.setFormPage(2);
                  }}
                  aria-label={`Use template: ${sample.title}`}
                  className="w-full min-w-0 rounded-[20px] border border-border bg-card p-3 text-left transition-transform active:scale-[0.97]"
                >
                  {/* No "typical $45 · ~1 hr": that was a number typed into
                      src/data/sampleJobs.ts, not one measured from jobs (truth
                      rule, #54), so it is not shown. The emoji stays (owner
                      2026-10-21: one emoji per way to start / category). */}
                  <span className="mb-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--bark)/0.12)] text-base" aria-hidden>
                    {sample.icon}
                  </span>
                  <p className="font-sans text-ds-14 font-semibold leading-tight text-foreground">{sample.title}</p>
                </button>
              ))}
            </div>
            {sampleJobs.length > quickTemplates.length && (
              <button
                type="button"
                onClick={() => setShowAllTemplates((v) => !v)}
                aria-expanded={showAllTemplates}
                className="min-h-[44px] font-sans text-ds-13 font-semibold text-[hsl(var(--bark))]"
              >
                {showAllTemplates ? "Show fewer" : `Show all ${sampleJobs.length} templates`}
              </button>
            )}
          </>
        )}
        {panel === "repost" && !hasRecent && (
          <p className="text-ds-14 text-muted-foreground">No recent jobs to repost yet.</p>
        )}
        {panel === "repost" && hasRecent && (
          <ul className="space-y-2">
            {recentPosted!.map((job) => (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => handleRepost(job.id)}
                  aria-label={`Repost ${job.title}`}
                  className="flex w-full items-center gap-3 rounded-[20px] border border-border bg-card p-3 text-left transition-transform active:scale-[0.98]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]">
                    <CategoryIcon category={job.category} aria-hidden className="h-4 w-4" strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-ds-14 font-semibold leading-tight text-foreground">{job.title}</span>
                    <span className="mt-0.5 block font-sans text-ds-12 tabular-nums text-muted-foreground">
                      {shortRelativeDate(job.created_at)} · <span className="font-semibold text-[hsl(var(--accent-ink))]">${formatPrice(job.budget)}</span>
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {panel === "offer" && <OfferToSavedHelpr open headless onOpenChange={(next) => form.setEntryPanel(next ? "offer" : null)} />}
        {panel === "ai" && (
          <AiJobBuilder
            open
            headless
            onOpenChange={(next) => form.setEntryPanel(next ? "ai" : null)}
            locationContext=""
            onGenerated={(job) => {
              form.applyAiJob(job);
              form.setEntryPanel(null);
              form.setStep("form");
              // The AI fills the details: it lands on Details (4 of 7).
              form.setFormPage(2);
            }}
          />
        )}
      </div>
    );
  }

  return (
    // Step 0 (owner 2026-10-21, mock-up helpr-postjob-flow-mockup.png): "How do you want to start?",
    // four cards, sentence case, an olive-circle icon each. A returning poster's kept draft and recent
    // jobs follow as the same card (counted by the skeleton above, so the column lands once).
    <div className="flex flex-col gap-3">
      {startHeader}
      {showGiftBanner && giftCards.userId && <GiftCardTeaser userId={giftCards.userId} ids={giftCards.ids} />}

      {/* AT THE DOOR, not at the end of the wizard: the 5-open-job cap, before any work is done. */}
      {atOpenJobLimit && <OpenJobLimitNotice count={form.openJobCount ?? 5} />}


      {/* 5 — LOAD DRAFT: only when a saved draft exists, and never for a draft whose job is already paid;
          Q769 warns while its checkout is live. Above the grid: picking up where you left off saves the most. */}
      {form.hasDraft && draftCheckout !== "paid" && (
        startCard(
          "draft",
          <FileText className="h-5 w-5" />,
          "Pick up your draft",
          draftCheckout === "open"
            ? "You started paying for this one. If you finished, it will show in Posts shortly, so check there before paying again."
            : "Continue the request you saved earlier. A draft keeps your words, so add your photos and video again.",
          () => {
            // F25: a draft with its category picked opens at Details, as a template does.
            if (form.loadDraftAndContinue()) form.setFormPage(2);
          },
        )
      )}

      {/* 1 — START FRESH (the group grid; a tap starts the form) */}
      {/* JA-41 (owner pick 2026-11-01): the group grid is the first screen. */}
      {groupGrid}

      {/* The other ways to start, as small links (owner pick: "small links on that screen"). Each opens in place of
          the grid; the page's back arrow returns here (handlePostJobBack). */}
      <nav aria-label="Other ways to start" className="flex flex-col" data-testid="entry-start-links">
        {/* 2 — USE A TEMPLATE */}
        {entryLink("templates", START_EMOJI.templates, "Use a template", () => {
          track("post_job_entry_choice", { choice: "use_template_open" });
          form.setEntryPanel("templates");
        })}
        {/* 3 — OFFER TO A SAVED HELPR */}
        {entryLink("offer", START_EMOJI.offer, "Hire a saved Helpr", () => form.setEntryPanel("offer"))}
        {/* 4 — AI JOB BUILDER */}
        {entryLink("ai", START_EMOJI.ai, "Describe it with AI", () => form.setEntryPanel("ai"))}
        {/* 6 — REPOST A RECENT TASK */}
        {hasRecent && entryLink("repost", "🔁", "Repost a recent job", () => {
          track("post_job_entry_choice", { choice: "repost_open" });
          form.setEntryPanel("repost");
        })}
      </nav>
    </div>
  );
}
