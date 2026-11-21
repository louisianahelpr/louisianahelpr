import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { RoundIconButton } from "@/components/ui/RoundIconButton";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { report } from "@/lib/errorLogger";
import { track } from "@/lib/analytics";
import {
  FUN_WORDS as W, SANTA_BUDGET_MAX, SANTA_DAY_MAX_DAYS, SANTA_MAX, SANTA_MIN, SANTA_NAME_MAX, SANTA_PATH, cleanName, cleanNames, drawSecretSanta, duplicateName,
  louisianaYmd, nameProblem, parseDollars, revealPath,
} from "@/content/giftGuideFun1120";
import { SantaSaveError, cancelSecretSanta, createSecretSanta } from "@/lib/giftGuideFunApi";
import { clearSantaLast, readSantaLast, saveSantaLast, santaExpiry, type SantaLastDraw } from "./santaLastDraw";
import { Hint } from "../GiftHint";
import { FunBody, funHeader } from "./FunPage";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";

/**
 * /gift-guides/secret-santa (owner 2026-11-20): the organizer types first names (and optionally a budget, a day and
 * "can't draw" pairs), we draw in the browser (drawSecretSanta: nobody gets themselves, pairs respected), the server
 * checks and stores the draw (secret_santa_create), and the organizer sends each person their own private link by
 * text, Messenger or copy. No email, phone or account. Guard: src/test/giftGuideFun1120.test.tsx.
 *
 * Holiday audit C2 (11-20): the draw is kept on this device (santaLastDraw.ts), so a reload shows "Your last draw"
 * with every Send and Copy again; each link is marked Sent once sent or copied; leaving with an unsent link warns
 * first. "Start a new group" warns that the links already sent will stop working, and turns the old draw off on the
 * server (secret_santa_cancel with every token) before the form comes back, so a group never has two live draws.
 * Guard: src/test/secretSantaLastDraw1120.test.tsx.
 */
const linkFor = (code: string, token: string) => `${getPublicOrigin()}${revealPath(code, token)}`;
const drawnOn = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

export default function SecretSanta() {
  const [names, setNames] = useState<string[]>(["", "", ""]);
  const [budget, setBudget] = useState("");
  const [day, setDay] = useState("");
  const [pairs, setPairs] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SantaLastDraw | null>(() => readSantaLast());
  // True when the draw on screen was read back from this device (a reload), not made just now.
  const [restored, setRestored] = useState(() => done !== null);
  const [copied, setCopied] = useState<number | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState(false);
  const firstNew = useRef<number | null>(null);
  const nameRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Holiday audit C15a: "Add a name" moves focus to the new field.
  useEffect(() => {
    if (firstNew.current === null) return;
    nameRefs.current[firstNew.current]?.focus();
    firstNew.current = null;
  }, [names.length]);

  // Leaving with a link not yet sent or copied asks first (the links are also kept on this device).
  const unsent = done ? done.names.length - new Set(done.sent).size : 0;
  useEffect(() => {
    if (!unsent) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsent]);

  const markSent = (i: number) => {
    setDone((d) => {
      if (!d || d.sent.includes(i)) return d;
      const next = { ...d, sent: [...d.sent, i] };
      saveSantaLast(next);
      return next;
    });
  };

  const typed = names.map(cleanName);
  const filled = typed.map((n, i) => ({ n, i })).filter((x) => x.n);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = cleanNames(names);
    if (clean.length < SANTA_MIN) return setError(W.santaNeed(SANTA_MIN));
    const bad = clean.find((n) => nameProblem(n));
    if (bad) return setError(W.santaBadName(bad));
    const dup = duplicateName(clean);
    if (dup) return setError(W.santaDup(dup));
    let b: number | undefined;
    if (budget.trim()) {
      const v = parseDollars(budget);
      if (v === undefined || !Number.isInteger(v) || v < 1 || v > SANTA_BUDGET_MAX) return setError(W.santaBudgetMax(SANTA_BUDGET_MAX));
      b = v;
    }
    // The pairs point at the typed rows; map them onto the cleaned (blank-free) list.
    const at = new Map(filled.map((x, k) => [x.i, k]));
    const avoid = pairs.flatMap(([a, c]): [number, number][] => (at.has(a) && at.has(c) && a !== c ? [[at.get(a)!, at.get(c)!]] : []));
    const givesTo = drawSecretSanta(clean.length, avoid);
    if (!givesTo) return setError(W.santaImpossible);
    setBusy(true);
    try {
      const { code, tokens } = await createSecretSanta({ names: clean, givesTo, avoid, budget: b, day: day || undefined });
      const now = new Date();
      const draw: SantaLastDraw = { code, names: clean, tokens, createdAt: now.toISOString(), expiresAt: santaExpiry(now, day || undefined).toISOString(), sent: [] };
      saveSantaLast(draw);
      setRestored(false);
      setDone(draw);
      track("secret_santa_drawn", { size: clean.length, pairs: avoid.length, budget: b !== undefined, day: Boolean(day) });
    } catch (err) {
      const limited = err instanceof SantaSaveError && err.kind === "rateLimited";
      // A rate limit is expected and told to the organizer; anything else is reported too.
      if (!limited) report(err, { tags: { feature: "secret-santa", step: "create" } });
      setError(limited ? W.santaRateLimited : err instanceof SantaSaveError && err.words ? err.words : W.santaFailed);
    } finally {
      setBusy(false);
    }
  };

  const send = (i: number) => {
    if (!done) return;
    void shareNative({ title: W.santaTitle, text: W.santaShareText(done.names[i]), url: linkFor(done.code, done.tokens[i]) });
    markSent(i);
  };
  const copy = async (i: number) => {
    if (!done) return;
    if (await copyToClipboard(linkFor(done.code, done.tokens[i]))) {
      setCopied(i);
      markSent(i);
    }
  };
  const startOver = () => {
    clearSantaLast();
    setDone(null);
    setRestored(false);
    setConfirmReset(false);
    setResetError(false);
    setNames(["", "", ""]);
    setPairs([]);
    setCopied(null);
  };
  // Turn the old draw off on the server first, so links already sent stop working instead of conflicting.
  const cancelAndStartOver = async () => {
    if (!done) return;
    setResetBusy(true);
    setResetError(false);
    try {
      await cancelSecretSanta(done.code, done.tokens);
      track("secret_santa_redraw", { size: done.names.length });
      startOver();
    } catch (err) {
      report(err, { tags: { feature: "secret-santa", step: "cancel" } });
      setResetError(true);
    } finally {
      setResetBusy(false);
    }
  };

  return (
    <PublicHeaderPage {...funHeader(W.santaTitle)}>
      <FunBody title={W.santaTitle} path={SANTA_PATH}>
      {done ? (
        <section aria-labelledby="santa-done" data-santa-done="">
          <h2 id="santa-done">{restored ? W.santaLastDraw(drawnOn(done.createdAt)) : W.santaDoneTitle}</h2>
          <p className="gg-fun-lead">{W.santaDoneLead}</p>
          <p className="gg-fun-note" data-santa-kept="">{W.santaKept}</p>
          <p className="gg-fun-lead font-semibold" data-santa-no-peek="">{W.santaNoPeek}</p>
          <div className="gg-fun-card">
            {done.names.map((n, i) => (
              <div key={done.tokens[i]} className="gg-santa-link" data-santa-person={i}>
                <b>{n}</b>
                {done.sent.includes(i) && <span className="gg-fun-note m-0" data-santa-sent={i}>{W.santaSent}</span>}
                <span className="gg-fun-row">
                  <Button type="button" size="sm" className="btn-grad-primary h-auto max-w-full whitespace-normal text-center" onClick={() => send(i)} data-santa-send={i}>{W.santaSend(n)}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copy(i)} data-santa-copy={i}>{copied === i ? W.santaCopied : W.santaCopy}</Button>
                </span>
              </div>
            ))}
          </div>
          <p className="gg-fun-note">{W.santaKeepNote}</p>
          {confirmReset ? (
            <div className="gg-fun-card" role="group" aria-labelledby="santa-reset-q" data-santa-reset-confirm="">
              <p id="santa-reset-q" className="m-0 font-semibold">{W.santaResetQ}</p>
              <p className="gg-fun-note mt-1">{W.santaResetWarn}</p>
              {resetError && <p className="gg-fun-err" role="alert" data-santa-reset-error="">{W.santaResetFailed}</p>}
              <span className="gg-fun-row mt-2">
                <Button type="button" size="sm" className="btn-grad-primary h-auto whitespace-normal" disabled={resetBusy} onClick={() => void cancelAndStartOver()} data-santa-reset-yes="">{resetBusy ? W.santaResetting : W.santaResetYes}</Button>
                <Button type="button" size="sm" variant="outline" disabled={resetBusy} onClick={() => { setConfirmReset(false); setResetError(false); }} data-santa-reset-no="">{W.santaResetNo}</Button>
              </span>
            </div>
          ) : (
            <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => setConfirmReset(true)} data-santa-again="">
              {W.santaStartOver}
            </Button>
          )}
        </section>
      ) : (
        <form onSubmit={(e) => void submit(e)} onChange={() => setError(null)} noValidate data-santa-form="">
          <p className="gg-fun-lead">{W.santaLead}</p>
          <Hint id="fun-santa">{W.hintSanta}</Hint>
          <div className="gg-fun-card">
            <fieldset>
              <legend className="text-sm font-semibold">{W.santaNames}</legend>
              <ul className="gg-fun-list mt-2">
                {names.map((n, i) => (
                  <li key={i} className="gg-fun-row">
                    <Input ref={(el) => { nameRefs.current[i] = el; }} aria-label={W.santaNamePlaceholder(i + 1)} placeholder={W.santaNamePlaceholder(i + 1)} value={n} maxLength={SANTA_NAME_MAX} autoComplete="off"
                      onChange={(e) => setNames(names.map((x, k) => (k === i ? e.target.value : x)))} data-santa-name={i} />
                    {names.length > SANTA_MIN && (
                      <RoundIconButton className="gg-fun-x" aria-label={W.santaRemoveName(n)} data-santa-remove={i}
                        onClick={() => {
                          setNames(names.filter((_, k) => k !== i));
                          setPairs(pairs.filter(([a, c]) => a !== i && c !== i).map(([a, c]) => [a > i ? a - 1 : a, c > i ? c - 1 : c]));
                        }}>
                        <span aria-hidden="true">×</span>
                      </RoundIconButton>
                    )}
                  </li>
                ))}
              </ul>
            </fieldset>
            {names.length < SANTA_MAX && (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => { firstNew.current = names.length; setNames([...names, ""]); }} data-santa-add="">{W.santaAddName}</Button>
            )}
            <label htmlFor="santa-budget">{W.santaBudget}</label>
            <Input id="santa-budget" inputMode="decimal" placeholder={W.santaBudgetPlaceholder} value={budget} onChange={(e) => setBudget(e.target.value)} data-santa-budget="" />
            <label htmlFor="santa-day">{W.santaDate}</label>
            <Input id="santa-day" type="date" className="min-w-0" min={louisianaYmd(new Date())} max={louisianaYmd(new Date(Date.now() + SANTA_DAY_MAX_DAYS * 86400000))} value={day} onChange={(e) => setDay(e.target.value)} data-santa-day="" />
          </div>
          <div className="gg-fun-card">
            <p className="m-0 text-sm font-semibold">{W.santaAvoidTitle}</p>
            <p className="gg-fun-note mt-0.5">{W.santaAvoidHelp}</p>
            <ul className="gg-fun-list mt-2">
              {pairs.map(([a, c], k) => (
                <li key={k} className="gg-fun-row" data-santa-pair={k}>
                  {([a, c] as const).map((v, side) => (
                    <NativeSelect wrapperClassName="min-w-0 flex-1" key={side} aria-label={side === 0 ? W.santaPickA : W.santaPickB} value={v} data-santa-pair-pick={side}
                      onChange={(e) => setPairs(pairs.map((p, j) => (j === k ? (side === 0 ? [Number(e.target.value), p[1]] : [p[0], Number(e.target.value)]) : p)))}>
                      <option value={-1}>{W.santaPickPerson}</option>
                      {names.map((n, i) => (
                        <option key={i} value={i} disabled={i === (side === 0 ? c : a)}>{cleanName(n) || W.santaNamePlaceholder(i + 1)}</option>
                      ))}
                    </NativeSelect>
                  ))}
                  <RoundIconButton className="gg-fun-x" aria-label={W.santaAvoidRemove} onClick={() => setPairs(pairs.filter((_, j) => j !== k))}>
                    <span aria-hidden="true">×</span>
                  </RoundIconButton>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setPairs([...pairs, [-1, -1]])} data-santa-pair-add="">
              {W.santaAvoidAdd}
            </Button>
          </div>
          {error && <p className="gg-fun-err" role="alert" data-santa-error="">{error}</p>}
          <Button type="submit" className="btn-grad-primary mt-3 w-full" disabled={busy} data-santa-draw="">{busy ? W.santaDrawing : W.santaDraw}</Button>
          <p className="gg-fun-note">{W.santaKeepNote}</p>
        </form>
      )}
      </FunBody>
    </PublicHeaderPage>
  );
}
