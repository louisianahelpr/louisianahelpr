import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { FUN_WORDS as W } from "@/content/giftGuideFun1120";
import { setSecretSantaWishList } from "@/lib/giftGuideFunApi";
import { getSharedList, shareGiftLists, wishErrorCopy, type SharedList } from "@/lib/giftWishListApi";
import { AnyStoreAdd } from "../AnyStoreAdd";
import { SharedPerson } from "../GiftGuideSharedList";
import { useGiftList } from "../giftList";
import { privateIdeas, shareListOf } from "../saveForPeople";
import { useOurLinkSync } from "../wishLinkSync";
import { markSent, santaKey, santaWishActions, useSantaWish, useSentSignature } from "./santaWishStore";

/**
 * Secret Santa wish lists (owner 2026-11-21: "the person should list what they want from their Secret Santa; once they
 * have their list we create the links").
 *   - MyList (on the person's own reveal page): type what they would like or paste a link from any store (AnyStoreAdd:
 *     our picks when close, our Amazon link, everything else sent to us to make our link), or add the gifts they saved
 *     in the guides. "Send my list to my Santa" shares it (gift_wish_lists_share: names and refs only) and attaches the
 *     code to their row (secret_santa_set_wish_list, through their own token; the token is never stored or sent with
 *     the list). Changed since: "Send the update".
 *   - TheirList (on their Santa's reveal page): the match's list in place, read by its share code, with our links as
 *     we make them (gift_wish_list_get reads them live) and "Link coming soon" until then.
 * Guard: src/test/santaWishList1121.test.tsx.
 */
export function SantaMyList({ code, token, me, sentCode, onSent }: { code: string; token: string; me: string; sentCode: string | null; onSent: (listCode: string) => void }) {
  // One list per group AND person (a shared device never mixes two people of one group; lh-authz-rls review).
  const key = santaKey(code, me);
  const person = useSantaWish(key, me);
  const actions = useMemo(() => santaWishActions(key, me), [key, me]);
  useOurLinkSync({ people: [person], updatedAt: 0 }, true, actions);
  const saved = useGiftList();
  // The share always goes under the person's own name from their reveal.
  const share = { ...shareListOf(person), n: me };
  const signature = JSON.stringify(share.items);
  const lastSent = useSentSignature(key);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // A list already shared but not yet attached (the attach failed): sent again as is, not shared a second time.
  const made = useRef<{ signature: string; listCode: string } | null>(null);
  const notReady = privateIdeas([person]);
  const fromSaved = saved.picks.filter((s) => !person.ideas.some((i) => i.href === s.href));
  const addSaved = () => {
    let left = 0;
    for (const s of fromSaved) {
      if (!actions.addIdea(person.id, { name: s.name, href: s.href, ...(s.guide ? { guide: s.guide } : {}), ...(s.id ? { item: s.id } : {}) })) left++;
    }
    setMsg(left > 0 ? W.revealListFull(left) : null);
  };
  const send = async () => {
    if (!share.items.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const listCode = made.current?.signature === signature ? made.current.listCode : await shareGiftLists([share]);
      made.current = { signature, listCode };
      const ok = await setSecretSantaWishList(code, token, listCode);
      if (ok) {
        made.current = null;
        markSent(key, signature);
        onSent(listCode);
      }
      setMsg(ok ? W.revealShared : W.revealShareFailed);
    } catch (e) {
      console.warn("secret santa: send list failed", e);
      setMsg(wishErrorCopy(e) ?? W.revealShareFailed);
    } finally {
      setBusy(false);
    }
  };
  const isSent = !!sentCode && lastSent === signature;
  return (
    <div className="gg-fun-card" data-santa-my-list="">
      <p className="m-0 font-semibold">{W.revealMyList}</p>
      <p className="gg-fun-note mt-1">{W.revealMyListHelp}</p>
      {person.ideas.length > 0 && (
        <ul className="gg-fun-list mt-2" aria-label={W.revealMyList}>
          {person.ideas.map((i) => (
            <li key={i.id} className="gg-plan-idea" data-santa-wish-item={i.id}>
              {/* Your own wishes: names only (the buying links are for your Santa, on their reveal). */}
              <span className="gg-plan-iname">
                <span className="gg-plan-iname-t">{i.name}</span>
              </span>
              <RoundIconButton className="gg-fun-x" aria-label={W.plannerRemoveIdea(i.name)} onClick={() => actions.removeIdea(person.id, i.id)} data-santa-wish-remove={i.id}>
                <span aria-hidden="true">×</span>
              </RoundIconButton>
            </li>
          ))}
        </ul>
      )}
      <AnyStoreAdd person={person} actions={actions} />
      {fromSaved.length > 0 && (
        <Button type="button" variant="link" size="inline" className="gg-link mt-2" onClick={addSaved} data-santa-add-saved="">{W.revealAddSaved(fromSaved.length)}</Button>
      )}
      <div className="gg-fun-actions">
        {share.items.length > 0 && (
          <Button type="button" className={isSent ? "h-auto max-w-full whitespace-normal text-center" : "btn-grad-primary h-auto max-w-full whitespace-normal text-center"} variant={isSent ? "outline" : "default"}
            disabled={busy || isSent} onClick={() => void send()} data-reveal-share-mine="">
            {isSent ? W.revealSent : sentCode ? W.revealSendUpdate : W.revealShareMine}
          </Button>
        )}
      </div>
      {notReady > 0 && <p className="gg-fun-note" data-santa-not-ready="">{W.revealNotReady(notReady)}</p>}
      {msg && <p className="gg-fun-note" role="status" data-reveal-share-msg="">{msg}</p>}
    </div>
  );
}

/** The match's list, in place on their Santa's reveal page (a lists share; an older single wish list keeps its link). */
export function SantaTheirList({ listCode, read = getSharedList }: { listCode: string; read?: (code: string) => Promise<SharedList | null> }) {
  const [list, setList] = useState<SharedList | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    read(listCode).then(
      (l) => live && setList(l),
      (e: unknown) => {
        // The "See their wish list" button above still opens it; only the in-place copy is missing.
        console.warn("secret santa: their list read failed", e);
        if (live) setList(null);
      },
    );
    return () => {
      live = false;
    };
  }, [listCode, read]);
  if (!list?.lists?.length) return null;
  return <div className="gg-fun-card" data-santa-their-list="">{list.lists.map((l, k) => <SharedPerson key={`${k} ${l.name}`} list={l} index={k} />)}</div>;
}
