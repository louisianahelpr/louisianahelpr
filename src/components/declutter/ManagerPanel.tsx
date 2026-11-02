/**
 * Manager mode phase 3 (owner 11-01, "Manage my Declutter for me"): every manager card on Selling, one lazy chunk.
 *   - the seller with no manager: "Get help selling" -> pick a member, the parts on/off, % or flat $, a split preview;
 *   - the seller with an offer out or a manager: "Managed by Dana" with Change parts and End;
 *   - the manager with an offer: Accept / Decline;
 *   - the manager with an active grant: the "Managing" switcher (Mine | Kaci's) and Kaci's listings, offers and sales,
 *     plus "Set up payouts to get your share" until their own payout account is ready.
 * Green primary on the right; one-line labels; a NextStep line on each card with a step. The server has no offer
 * deadline, so the NextStep lines carry no "by" (none is invented). Loaded only while declutter_manager is on
 * (ManagerPanelGate).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NextStep } from "@/components/ui/NextStep";
import { formatPrice } from "@/lib/declutter/distance";
import { userFacingError } from "@/lib/userFacingError";
import { useStripeConnectStatus } from "@/hooks/useStripeConnectStatus";
import { usePayoutSetupBlock } from "@/hooks/usePayoutSetupPaused";
import { PayoutSetupPausedNotice } from "@/components/payouts/PayoutSetupPausedNotice";
import {
  MANAGER_PART_LABELS, answerManageOffer, endManaging, fetchManagedOverview, grantParts, offerToManage, searchMembers,
  setManagerParts, shareWords, splitOf, splitWords, useMyManagerGrants, useOrderManagerShares,
  type ManagerGrant, type ManagerPart, type ManagerParts, type MemberHit, type ShareType,
} from "@/lib/declutter/managerMode";

const PARTS: ManagerPart[] = ["list", "prices", "offers", "messages", "pickups"];
const NO_PARTS: ManagerParts = { list: false, prices: false, offers: false, messages: false, pickups: false };
/** The preview's example sale. */
const EXAMPLE_CENTS = 4000;
const GRANTS_KEY = ["declutter-manager-grants"] as const;

const card = "rounded-[20px] border border-border bg-card p-4";

function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] || full;
}

function PartsPicker({ id, value, onChange }: { id: string; value: ManagerParts; onChange: (p: ManagerParts) => void }) {
  return (
    <fieldset className="space-y-1" data-manager-parts={id}>
      <legend className="text-ds-13 font-medium">What they handle</legend>
      {PARTS.map((p) => (
        <label key={p} className="flex min-h-11 items-center gap-3 text-ds-15">
          <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--primary))]" checked={value[p]}
            onChange={(e) => onChange({ ...value, [p]: e.target.checked })} />
          {MANAGER_PART_LABELS[p]}
        </label>
      ))}
    </fieldset>
  );
}

/** The seller asks one member to manage her Declutter. */
function GrantSetup() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<MemberHit | null>(null);
  const [parts, setParts] = useState<ManagerParts>({ ...NO_PARTS, list: true, messages: true });
  const [type, setType] = useState<ShareType>("percent");
  const [value, setValue] = useState("20");
  const hits = useQuery({
    queryKey: ["declutter-manager-member-search", query.trim()],
    queryFn: () => searchMembers(query),
    enabled: open && !picked && query.trim().length >= 2,
    staleTime: 30_000,
  });
  const num = Number(value);
  const shareValue = type === "percent" ? Math.round(num) : Math.round(num * 100);
  const valueOk = Number.isFinite(num) && num > 0 && (type === "percent" ? shareValue >= 1 && shareValue <= 100 : shareValue >= 1);
  const anyPart = PARTS.some((p) => parts[p]);
  const name = picked ? firstName(picked.full_name) : "them";
  const split = splitOf(EXAMPLE_CENTS, { type, value: valueOk ? shareValue : 0 });
  const send = useMutation({
    mutationFn: () => offerToManage(picked!.user_id, type, shareValue, parts),
    onSuccess: () => { toast(`Asked ${name}.`); setOpen(false); void qc.invalidateQueries({ queryKey: GRANTS_KEY }); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't send that. Try again.")),
  });

  if (!open) {
    return (
      <section className={card} data-manager-setup="closed">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[12rem] flex-1">
            <h2 className="text-base font-semibold">Get help selling</h2>
            <p className="text-ds-13 text-muted-foreground">Someone you trust lists and answers for you, for a share.</p>
          </div>
          <Button className="rounded-full" onClick={() => setOpen(true)}>Ask someone</Button>
        </div>
      </section>
    );
  }

  return (
    <section className={card} aria-labelledby="manager-setup-title" data-manager-setup="open">
      <h2 id="manager-setup-title" className="text-base font-semibold">Get help selling</h2>
      <NextStep className="mt-1" value={{ who: "you", text: picked ? "Choose what they handle and their share" : "Pick who helps you" }} />
      <form className="mt-3 space-y-4" onSubmit={(e) => { e.preventDefault(); if (picked && anyPart && valueOk) send.mutate(); }}>
        {picked ? (
          <div className="flex items-center gap-3" data-manager-picked={picked.user_id}>
            <p className="flex-1 text-ds-15 font-medium">{picked.full_name}</p>
            <Button type="button" variant="outline" className="rounded-full" onClick={() => setPicked(null)}>Change</Button>
          </div>
        ) : (
          <div>
            <label htmlFor="manager-search" className="block text-ds-13 font-medium">Member's name</label>
            <input id="manager-search" type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-input bg-background px-3 text-ds-15" placeholder="Search by name" />
            {hits.data && hits.data.length > 0 && (
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border" aria-label="Members">
                {hits.data.map((m) => (
                  <li key={m.user_id}>
                    <button type="button" className="min-h-11 w-full px-3 text-left text-ds-15" onClick={() => setPicked(m)} data-member-hit={m.user_id}>
                      {m.full_name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {/* The shared search copy offers an email box this picker has not got, so it says its own line. */}
            {hits.isError && <p className="mt-2 text-ds-13 text-muted-foreground" role="status">Search is busy. Try again in a minute.</p>}
            {hits.data && hits.data.length === 0 && query.trim().length >= 2 && (
              <p className="mt-2 text-ds-13 text-muted-foreground">No member by that name.</p>
            )}
          </div>
        )}
        <PartsPicker id="setup" value={parts} onChange={setParts} />
        <fieldset>
          <legend className="text-ds-13 font-medium">Their share</legend>
          <div className="mt-1 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Share type">
            {(["percent", "flat"] as ShareType[]).map((t) => (
              <Button key={t} type="button" role="radio" aria-checked={type === t} variant={type === t ? "default" : "outline"} className="rounded-full"
                onClick={() => { setType(t); setValue(t === "percent" ? "20" : "5"); }}>
                {t === "percent" ? "% of each sale" : "$ per item"}
              </Button>
            ))}
            <label htmlFor="manager-share" className="sr-only">{type === "percent" ? "Percent" : "Dollars per item"}</label>
            <input id="manager-share" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)}
              className="h-11 w-24 rounded-xl border border-input bg-background px-3 text-ds-15" />
          </div>
          {/* The preview: what one $40 sale pays each person. */}
          <p className="mt-2 text-ds-14" data-manager-split-preview="">{splitWords(EXAMPLE_CENTS, split.manager, picked ? name : "them")}</p>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" className="rounded-full" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit" className="rounded-full" disabled={!picked || !anyPart || !valueOk || send.isPending}>Send offer</Button>
        </div>
      </form>
    </section>
  );
}

/** The seller's card while an offer is out or a manager is active. */
function ManagedBy({ g }: { g: ManagerGrant }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [parts, setParts] = useState<ManagerParts>(grantParts(g));
  const name = g.manager_first_name;
  const refresh = () => void qc.invalidateQueries({ queryKey: GRANTS_KEY });
  const save = useMutation({
    mutationFn: () => setManagerParts(g.id, parts),
    onSuccess: () => { toast("Saved."); setEditing(false); refresh(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't save that. Try again.")),
  });
  const end = useMutation({
    mutationFn: () => endManaging(g.id),
    onSuccess: () => { toast(g.status === "offered" ? "Offer taken back." : `${name} can't manage your Declutter now.`); refresh(); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't do that. Try again.")),
  });
  const on = PARTS.filter((p) => g[`can_${p}` as const]).map((p) => MANAGER_PART_LABELS[p]);
  const offered = g.status === "offered";
  return (
    <section className={card} aria-labelledby="managed-by-title" data-manager-managed-by={g.status}>
      <h2 id="managed-by-title" className="text-base font-semibold">{offered ? `Asked ${name} to help` : `Managed by ${name}`}</h2>
      <NextStep className="mt-1" value={offered
        ? { who: "them", text: `Waiting on ${name} to accept` }
        : { who: "info", text: `${name} drafts; you approve before anything posts` }} />
      <p className="mt-2 text-ds-14 text-muted-foreground">{shareWords(g)} · {on.join(", ")}</p>
      {editing ? (
        <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <PartsPicker id="change" value={parts} onChange={setParts} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="rounded-full" onClick={() => { setParts(grantParts(g)); setEditing(false); }}>Cancel</Button>
            <Button type="submit" className="rounded-full" disabled={!PARTS.some((p) => parts[p]) || save.isPending}>Save</Button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="outline" className="rounded-full" disabled={end.isPending} onClick={() => end.mutate()}>
            {offered ? "Take back" : "End access"}
          </Button>
          <Button className="rounded-full" onClick={() => setEditing(true)}>Change parts</Button>
        </div>
      )}
    </section>
  );
}

/** The manager's offer card. */
function OfferCard({ g }: { g: ManagerGrant }) {
  const qc = useQueryClient();
  const answer = useMutation({
    mutationFn: (accept: boolean) => answerManageOffer(g.id, accept),
    onSuccess: (r) => { toast(r === "active" ? `You're managing for ${g.seller_first_name}.` : "Declined."); void qc.invalidateQueries({ queryKey: GRANTS_KEY }); },
    onError: (e: unknown) => toast(userFacingError(e, "We couldn't answer that. Try again.")),
  });
  const on = PARTS.filter((p) => g[`can_${p}` as const]).map((p) => MANAGER_PART_LABELS[p]);
  return (
    <section className={card} aria-labelledby={`offer-${g.id}`} data-manager-offer={g.id}>
      <h2 id={`offer-${g.id}`} className="text-base font-semibold">{g.seller_first_name} asked you to help sell</h2>
      <NextStep className="mt-1" value={{ who: "you", text: "Accept or decline" }} />
      <p className="mt-2 text-ds-14">You get {shareWords(g)}. {g.seller_first_name} approves each listing before it posts.</p>
      <p className="mt-1 text-ds-13 text-muted-foreground">You handle: {on.join(", ")}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="outline" className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate(false)}>Decline</Button>
        <Button className="rounded-full" disabled={answer.isPending} onClick={() => answer.mutate(true)}>Accept</Button>
      </div>
    </section>
  );
}

/** "Set up payouts to get your share", shown to an active manager until their own payout account is ready. */
function ManagerPayoutPrompt() {
  const paused = usePayoutSetupBlock() === "paused";
  const { payoutPrompt } = useStripeConnectStatus();
  if (payoutPrompt.kind !== "setup") return null;
  if (paused) return <PayoutSetupPausedNotice />;
  return (
    <div className="mt-3 rounded-2xl bg-muted/50 p-3" data-manager-payout-prompt="">
      <NextStep value={{ who: "you", text: "Set up payouts to get your share" }} />
      <div className="mt-2 flex justify-end">
        <Button asChild className="rounded-full"><Link to="/profile?tab=payment">Set up payouts</Link></Button>
      </div>
    </div>
  );
}

const PAYOUT_WORDS = { pending: "on its way", succeeded: "sent", failed: "didn't go through; we'll try again", nothing_due: "nothing due after a refund" } as const;

/** The manager's payout screen: their share of each of the seller's sales. */
function MyShares({ g }: { g: ManagerGrant }) {
  const { data } = useOrderManagerShares();
  const mine = (data ?? []).filter((s) => s.manager_id === g.manager_id && s.seller_id === g.seller_id);
  return (
    <div className="mt-2" data-manager-shares="">
      <p className="text-ds-14 text-muted-foreground">Your share of {g.seller_first_name}'s sales: {shareWords(g)}.</p>
      {mine.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {mine.map((s) => (
            <li key={s.order_id} className="py-2 text-ds-14" data-manager-share={s.order_id}>
              {s.paid_cents != null && s.payout_status
                ? `${formatPrice(s.paid_cents)} · ${PAYOUT_WORDS[s.payout_status]}`
                : "Sold · your share is paid once the sale is final"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The manager's switcher: their own Selling, or the seller's. */
function Managing({ g }: { g: ManagerGrant }) {
  const [view, setView] = useState<"mine" | "theirs">("mine");
  const ov = useQuery({
    queryKey: ["declutter-managed-overview", g.seller_id],
    queryFn: () => fetchManagedOverview(g.seller_id),
    enabled: view === "theirs",
  });
  const o = ov.data;
  const waitingOffers = o?.offers.filter((x) => x.awaiting === "seller").length ?? 0;
  const openQuestions = o?.questions.filter((x) => !x.answer).length ?? 0;
  return (
    <section className={card} aria-labelledby={`managing-${g.id}`} data-manager-managing={g.seller_id}>
      <h2 id={`managing-${g.id}`} className="text-base font-semibold">Managing</h2>
      <div className="mt-2 inline-flex rounded-full border border-border p-1" role="tablist" aria-label="Whose Selling">
        {(["mine", "theirs"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v}
            className={`min-h-11 rounded-full px-4 text-ds-14 font-medium ${view === v ? "bg-primary text-primary-foreground" : ""}`}
            onClick={() => setView(v)}>
            {v === "mine" ? "Mine" : `${g.seller_first_name}'s`}
          </button>
        ))}
      </div>
      {view === "mine" ? (
        <MyShares g={g} />
      ) : !o ? (
        <p className="mt-2 text-ds-14 text-muted-foreground">{ov.isError ? "We couldn't load that. Try again." : "Loading…"}</p>
      ) : (
        <div className="mt-3 space-y-2" data-managed-overview="">
          <NextStep value={waitingOffers > 0
            ? { who: "you", text: `Answer ${waitingOffers === 1 ? "1 offer" : `${waitingOffers} offers`} for ${g.seller_first_name}`,
                by: o.offers.find((x) => x.awaiting === "seller")?.respond_by
                  ? new Date(o.offers.find((x) => x.awaiting === "seller")!.respond_by).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })
                  : null }
            : openQuestions > 0
              ? { who: "you", text: `Answer ${openQuestions === 1 ? "1 question" : `${openQuestions} questions`} for ${g.seller_first_name}` }
              : { who: "info", text: `Nothing waiting for ${g.seller_first_name} right now` }} />
          <ul className="divide-y divide-border">
            {o.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2" data-managed-item={i.id}>
                <span className="min-w-0 flex-1 truncate text-ds-15">{i.title}</span>
                <span className="text-ds-13 text-muted-foreground">{i.price_cents === 0 ? "Free" : formatPrice(i.price_cents)}</span>
              </li>
            ))}
            {o.items.length === 0 && <li className="py-2 text-ds-14 text-muted-foreground">No listings yet.</li>}
          </ul>
        </div>
      )}
      <ManagerPayoutPrompt />
    </section>
  );
}

export default function ManagerPanel() {
  const { data: grants } = useMyManagerGrants();
  if (!grants) return null;
  const open = grants.filter((g) => g.status === "offered" || g.status === "active");
  const mineAsSeller = open.find((g) => g.role === "seller");
  const offers = open.filter((g) => g.role === "manager" && g.status === "offered");
  const managing = open.filter((g) => g.role === "manager" && g.status === "active");
  return (
    <div className="space-y-4" data-manager-panel="">
      {offers.map((g) => <OfferCard key={g.id} g={g} />)}
      {managing.map((g) => <Managing key={g.id} g={g} />)}
      {mineAsSeller ? <ManagedBy g={mineAsSeller} /> : <GrantSetup />}
    </div>
  );
}
