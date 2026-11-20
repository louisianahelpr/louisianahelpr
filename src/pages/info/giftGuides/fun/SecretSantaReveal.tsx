import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { FUN_WORDS as W, SANTA_PATH } from "@/content/giftGuideFun1120";
import { revealSecretSanta, setSecretSantaWishList, type SantaReveal } from "@/lib/giftGuideFunApi";
import { saveWishList, sharedListPath } from "@/lib/giftWishListApi";
import { listName, listRefs, useGiftList } from "../giftList";
import { FunPage } from "./FunPage";

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
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const list = useGiftList();
  const refs = listRefs(list);

  const load = useCallback(() => {
    setState({ kind: "loading" });
    revealSecretSanta(code, token).then(
      (r) => setState(r ? { kind: "ok", r } : { kind: "missing" }),
      (e: unknown) => {
        console.warn("secret santa: reveal failed", e);
        setState({ kind: "error" });
      },
    );
  }, [code, token]);
  useEffect(load, [load]);

  const shareMine = async () => {
    if (!refs.length) return setShareMsg(W.revealEmptyList);
    setSharing(true);
    setShareMsg(null);
    try {
      const listCode = await saveWishList(listName(list), refs);
      const ok = await setSecretSantaWishList(code, token, listCode);
      setShareMsg(ok ? W.revealShared : W.revealShareFailed);
      if (ok && state.kind === "ok") setState({ kind: "ok", r: { ...state.r, myWishList: listCode } });
    } catch (e) {
      console.warn("secret santa: share list failed", e);
      setShareMsg(W.revealShareFailed);
    } finally {
      setSharing(false);
    }
  };

  return (
    <FunPage title={W.revealTitle} path={SANTA_PATH} noindex>
      {state.kind === "loading" && <p className="gg-fun-lead" role="status" data-reveal-loading="">{W.revealLoading}</p>}
      {state.kind === "missing" && (
        <div className="gg-fun-card" data-reveal-missing="">
          <p className="m-0">{W.revealMissing}</p>
          <Link to={SANTA_PATH} className="gg-link">{W.santaTitle} ›</Link>
        </div>
      )}
      {state.kind === "error" && (
        <div className="gg-fun-card" data-reveal-error="">
          <p className="m-0">{W.santaFailed}</p>
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
                <Button asChild className="btn-grad-primary h-auto min-h-11 max-w-full whitespace-normal text-center">
                  <Link to={sharedListPath(state.r.matchWishList)} data-reveal-their-list="">{W.revealTheirList(state.r.match)}</Link>
                </Button>
              ) : (
                <p className="gg-fun-note w-full" data-reveal-no-list="">{W.revealNoList(state.r.match)}</p>
              )}
              <Button asChild variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-center">
                <Link to="/gift-guides/swipe" data-reveal-find="">{W.revealFindGifts}</Link>
              </Button>
            </div>
          </div>
          <div className="gg-fun-card">
            <p className="m-0 font-semibold">{W.revealMyList}</p>
            <p className="gg-fun-note mt-1">{W.revealMyListHelp}</p>
            <div className="gg-fun-actions">
              <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal text-center" disabled={sharing} onClick={() => void shareMine()} data-reveal-share-mine="">{W.revealShareMine}</Button>
              <Button asChild variant="link" size="inline" className="gg-link">
                <Link to="/gift-guides" data-reveal-make-list="">{W.revealMyList} ›</Link>
              </Button>
            </div>
            {shareMsg && <p className="gg-fun-note" role="status" data-reveal-share-msg="">{shareMsg}</p>}
          </div>
        </section>
      )}
    </FunPage>
  );
}
