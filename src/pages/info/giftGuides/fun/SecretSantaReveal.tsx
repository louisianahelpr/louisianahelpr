import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FUN_WORDS as W, SANTA_PATH } from "@/content/giftGuideFun1120";
import { revealSecretSanta, type SantaReveal } from "@/lib/giftGuideFunApi";
import { sharedListPath } from "@/lib/giftWishListApi";
import { FunBody, funHeader } from "./FunPage";
import { SantaMyList, SantaTheirList } from "./SantaWishList";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { track } from "@/lib/analytics";
import { useAuthReady } from "@/hooks/useAuthReady";
import { useSantaIdeas, type SantaFor } from "./santaIdeas";
import { GiftOut } from "../GiftOut";

/**
 * /gift-guides/secret-santa/<code>/<token> (owner 2026-11-20): one person's private reveal. It shows ONLY their match,
 * the budget and the day (secret_santa_reveal answers that token's row and nothing else), a link to the match's shared
 * wish list when the match attached one, and a way for this person to share their own list with their Secret Santa.
 * noindex; the URL holds no name. Guard: src/test/giftGuideFun1120.test.tsx.
 */
type State = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ok"; r: SantaReveal };

const niceDay = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

export default function SecretSantaReveal() {
  const { code = "", token = "" } = useParams<{ code: string; token: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const { pathname } = useLocation();
  const { user } = useAuthReady();
  const ideas = useSantaIdeas(code);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    revealSecretSanta(code, token).then(
      (r) => {
        setState(r ? { kind: "ok", r } : { kind: "missing" });
        track("secret_santa_reveal_opened", { found: Boolean(r), match_list: Boolean(r?.matchWishList) });
      },
      (e: unknown) => {
        console.warn("secret santa: reveal failed", e);
        setState({ kind: "error" });
      },
    );
  }, [code, token]);
  useEffect(load, [load]);

  return (
    <PublicHeaderPage {...funHeader(W.revealTitle)}>
      <FunBody title={W.revealTitle} path={SANTA_PATH} noindex>
      {state.kind === "loading" && <p className="gg-fun-lead" role="status" data-reveal-loading="">{W.revealLoading}</p>}
      {state.kind === "missing" && (
        <div className="gg-fun-card" data-reveal-missing="">
          <p className="m-0">{W.revealMissing}</p>
          <Link to={SANTA_PATH} className="gg-link">{W.santaTitle} ›</Link>
        </div>
      )}
      {state.kind === "error" && (
        <div className="gg-fun-card" data-reveal-error="">
          <p className="m-0">{W.revealLoadFailed}</p>
          <Button type="button" variant="outline" size="sm" className="mt-2" onClick={load}>{W.revealRetry}</Button>
        </div>
      )}
      {state.kind === "ok" && (
        <section aria-labelledby="reveal-title" data-reveal="">
          <div className="gg-fun-card text-center">
            <p className="m-0" id="reveal-title">{W.revealHi(state.r.name)}</p>
            <p className="gg-fun-big" data-reveal-match="">{state.r.match}</p>
            {state.r.budget !== null && <p className="m-0 text-sm font-semibold" data-reveal-budget="">{W.revealBudget(state.r.budget)}</p>}
            {state.r.exchangeOn && <p className="m-0 text-sm" data-reveal-day="">{W.revealDate(niceDay(state.r.exchangeOn))}</p>}
            <div className="gg-fun-actions justify-center">
              {state.r.matchWishList ? (
                <Button asChild className="btn-grad-primary h-auto max-w-full whitespace-normal text-center">
                  <Link to={sharedListPath(state.r.matchWishList)} data-reveal-their-list="">{W.revealTheirList}</Link>
                </Button>
              ) : (
                <p className="gg-fun-note w-full" data-reveal-no-list="">{W.revealNoList(state.r.match)}</p>
              )}
              <Button asChild variant="outline" className="h-auto max-w-full whitespace-normal text-center">
                <Link to="/gift-guides/swipe" state={{ santa: { code, match: state.r.match, budget: state.r.budget, back: pathname } satisfies SantaFor }} data-reveal-find="">{W.revealFindGifts}</Link>
              </Button>
            </div>
          </div>
          {/* Owner 11-21: their list in place, with our links as we make them. */}
          {state.r.matchWishList && <SantaTheirList listCode={state.r.matchWishList} />}
          {(ideas.length > 0 || user) && (
            <div className="gg-fun-card" data-reveal-ideas="">
              <p className="m-0 font-semibold">{W.revealIdeasTitle(state.r.match)}</p>
              {ideas.length > 0 && (
                <ul className="gg-fun-list mt-2">
                  {ideas.map((i) => <li key={i.href} className="text-sm"><GiftOut href={i.href} className="gg-link">{i.name}<span className="sr-only"> (opens in a new tab)</span></GiftOut></li>)}
                </ul>
              )}
              {user && <Link to="/gift-guides/planner" className="gg-link mt-2 inline-block text-sm" data-reveal-ideas-planner="">{W.revealIdeasPlanner} ›</Link>}
            </div>
          )}
          {/* Owner 11-21 ("the person should list what they want from their Secret Santa; once they have their list we
              create the links"): their own list, typed or pasted from any store, sent to their Santa. */}
          <SantaMyList code={code} token={token} me={state.r.name} sentCode={state.r.myWishList}
            onSent={(listCode) => setState((s) => (s.kind === "ok" ? { kind: "ok", r: { ...s.r, myWishList: listCode } } : s))} />
          <p className="gg-fun-note">
            <Link to="/gift-guides" className="gg-link" data-reveal-make-list="">{W.revealBrowse} ›</Link>
          </p>
        </section>
      )}
      </FunBody>
    </PublicHeaderPage>
  );
}
