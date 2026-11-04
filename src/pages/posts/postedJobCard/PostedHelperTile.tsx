import type { MouseEvent } from "react";
import { PersonTile } from "@/components/PersonTile";
import type { PostedJobCardProps } from "./types";

/* THE HELPR'S PROFILE TILE — built here, rendered DIRECTLY ABOVE THE ACTION
   ROW (owner, 2026-09-19: "the helpr or posted by should be right above the
   buttons"). Third position in five days; jobCardPerson.tsx carries the
   whole history and the reasoning.

   The card builds it because the card is what holds the id, the name and the
   avatar. WHERE it lands is no longer the card's business: it is published
   through `JobCardPersonContext` and the step shell (JobStepCard) renders it
   as the last thing before its one row.

   `stepCarriesTile` is the SHELL'S OWN ANSWER, not a second transcription of
   which statuses draw a step card. PostedJobActions returns null outright for
   `cancelled` and `pending_approval` (STATUS_RENDERS_ACTIONS), and an
   un-expanded card draws no actions at all — in exactly those states nothing
   claims the tile and the fallback below prints it, so the Helpr's profile
   cannot silently vanish from a card again.

   NOTHING WHILE COLLAPSED (V6, reaffirmed by the owner 2026-09-19): the tile
   is `null` unless `isExpanded`, gated HERE rather than downstream, because
   the card is the only thing that knows its own expand state (it passes it in).

   On THIS card that gate is defence-in-depth and says so honestly: both
   render sites (the step card and the fallback below) already sit behind
   `isExpanded`, so removing it changes nothing today — which is exactly why
   it stays. The tile has moved three times in five days, and the rule
   belongs to the tile rather than to wherever it currently happens to be
   mounted. On the HELPER card the same line IS load-bearing, because that
   card's step cards render while collapsed; the mutation register in
   src/test/jobCardPersonTileAboveRow.test.tsx records that asymmetry. */
export function postedHelperTile({ job, isExpanded, helperName, helperAvatars, offerUnanswered }: {
  job: PostedJobCardProps["job"];
  isExpanded: boolean;
  helperName: string;
  helperAvatars: PostedJobCardProps["helperAvatars"];
  offerUnanswered: boolean;
}) {
  return isExpanded && job.helper_id ? (
    <PersonTile
      userId={job.helper_id}
      to={`/user/${job.helper_id}`}
      name={helperName}
      avatarUrl={helperAvatars?.[job.helper_id] ?? null}
      eyebrow={offerUnanswered ? "Offered to" : "Helpr"}
      onClick={(e: MouseEvent) => e.stopPropagation()}
    />
  ) : null;
}
