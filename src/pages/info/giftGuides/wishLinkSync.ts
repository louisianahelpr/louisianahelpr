import { useEffect } from "react";
import type { GiftPlan, PlanIdea } from "@/content/giftGuideFun1120";
import { readWishLinks, requestWishLink } from "@/lib/giftWishListApi";
import { planActions } from "./fun/plannerStore";

/**
 * Our links for gifts from any store (owner 2026-11-21: "we see the list, create the links if we don't have it ...
 * they buy with our link").
 *   - askForLink: send one gift to us (wish_link_request_add). The gift keeps the request id (`req`) and our link when
 *     the server already has one. A refusal that will never pass (a web address in its name, a link we can't use)
 *     stops the asking (`ask` cleared); anything else (offline, too many just now) keeps `ask`, to try again.
 *   - useOurLinkSync: when a list opens, asks again for gifts still waiting to be sent (5 at a time), and reads every
 *     request the gifts carry: our link replaces the pasted one once made; a request that no longer exists is forgotten.
 *     A failed read changes nothing and is tried again the next time a list opens.
 * Guard: src/test/wishLinkQueue1121.test.tsx.
 */
export interface IdeaWriter {
  setIdea: (personId: string, ideaId: string, patch: Partial<Omit<PlanIdea, "id">>) => void;
}

const NEVER_PASSES = /(^|[^a-z0-9_])invalid_(words|url|list|kind)($|[^a-z0-9_])/;

/** Gifts being sent right now (so the sync never sends one the box has just sent). */
const sending = new Set<string>();

export async function askForLink(person: { id: string; name: string }, idea: Pick<PlanIdea, "id" | "name" | "href">, write: IdeaWriter = planActions): Promise<void> {
  if (sending.has(idea.id)) return;
  sending.add(idea.id);
  try {
    const a = await requestWishLink(idea.href ? "link" : "idea", idea.name, idea.href ?? null, person.id, person.name);
    write.setIdea(person.id, idea.id, { req: a.id, ask: undefined, ...(a.link ? { href: a.link } : {}) });
  } catch (e) {
    if (NEVER_PASSES.test(e instanceof Error ? e.message : "")) write.setIdea(person.id, idea.id, { ask: undefined });
    throw e;
  } finally {
    sending.delete(idea.id);
  }
}

/** A list the sync can update: the gift planner (default) or a Secret Santa wish list. */
export interface LinkWriter extends IdeaWriter {
  applyOurLinks: (asked: readonly string[], found: ReadonlyMap<string, string | null>) => void;
}

const RETRY_PER_OPEN = 5;

export function useOurLinkSync(plan: GiftPlan, on = true, write: LinkWriter = planActions) {
  const reqs = [...new Set(plan.people.flatMap((p) => p.ideas.flatMap((i) => (i.req ? [i.req] : []))))].sort();
  const waiting = plan.people.flatMap((p) => p.ideas.filter((i) => i.ask && !i.req).map((i) => ({ person: p, idea: i }))).slice(0, RETRY_PER_OPEN);
  const key = reqs.join(",");
  const waitKey = waiting.map((w) => w.idea.id).join(",");
  useEffect(() => {
    if (!on || !key) return;
    let live = true;
    const asked = key.split(",");
    readWishLinks(asked).then(
      (found) => { if (live) write.applyOurLinks(asked, found); },
      (e: unknown) => {
        // Not shown: the gifts keep the links they have, and the next open asks again.
        console.warn("wish links: read failed", e);
      },
    );
    return () => {
      live = false;
    };
  }, [key, on]);
  useEffect(() => {
    if (!on || !waitKey) return;
    for (const w of waiting) {
      askForLink(w.person, w.idea, write).catch((e: unknown) => {
        // Not shown here (the list is just opening): it stays waiting and is tried again the next time.
        console.warn("wish links: send again failed", e);
      });
    }
    // Only when the set of waiting gifts changes, not on every render.
  }, [waitKey, on]);
}
