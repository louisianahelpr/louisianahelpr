import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { copyToClipboard, shareNative } from "@/lib/nativeShare";
import { getPublicOrigin } from "@/lib/authRedirects";
import { report } from "@/lib/errorLogger";
import {
  FUN_WORDS as W, SANTA_BUDGET_MAX, SANTA_DAY_MAX_DAYS, SANTA_MAX, SANTA_MIN, SANTA_NAME_MAX, SANTA_PATH, cleanName, cleanNames, drawSecretSanta, duplicateName,
  louisianaYmd, nameProblem, parseDollars, revealPath,
} from "@/content/giftGuideFun1120";
import { SantaSaveError, createSecretSanta } from "@/lib/giftGuideFunApi";
import { Hint } from "../GiftHint";
import { FunPage } from "./FunPage";

/**
 * /gift-guides/secret-santa (owner 2026-11-20): the organizer types first names (and optionally a budget, a day and
 * "can't draw" pairs), we draw in the browser (drawSecretSanta: nobody gets themselves, pairs respected), the server
 * checks and stores the draw (secret_santa_create), and the organizer sends each person their own private link by
 * text, Messenger or copy. No email, phone or account. Guard: src/test/giftGuideFun1120.test.tsx.
 */
type Done = { names: string[]; links: string[] };

export default function SecretSanta() {
  const [names, setNames] = useState<string[]>(["", "", ""]);
  const [budget, setBudget] = useState("");
  const [day, setDay] = useState("");
  const [pairs, setPairs] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

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
      if (v === undefined || v < 1 || v > SANTA_BUDGET_MAX) return setError(W.santaBudgetMax(SANTA_BUDGET_MAX));
      b = Math.round(v);
    }
    // The pairs point at the typed rows; map them onto the cleaned (blank-free) list.
    const at = new Map(filled.map((x, k) => [x.i, k]));
    const avoid = pairs.flatMap(([a, c]): [number, number][] => (at.has(a) && at.has(c) && a !== c ? [[at.get(a)!, at.get(c)!]] : []));
    const givesTo = drawSecretSanta(clean.length, avoid);
    if (!givesTo) return setError(W.santaImpossible);
    setBusy(true);
    try {
      const { code, tokens } = await createSecretSanta({ names: clean, givesTo, avoid, budget: b, day: day || undefined });
      setDone({ names: clean, links: tokens.map((t) => `${getPublicOrigin()}${revealPath(code, t)}`) });
    } catch (err) {
      const limited = err instanceof SantaSaveError && err.kind === "rateLimited";
      // A rate limit is expected and told to the organizer; anything else is reported too.
      if (!limited) report(err, { tags: { feature: "secret-santa", step: "create" } });
      setError(limited ? W.santaRateLimited : W.santaFailed);
    } finally {
      setBusy(false);
    }
  };

  const send = (i: number) => {
    if (!done) return;
    void shareNative({ title: W.santaTitle, text: W.santaShareText(done.names[i]), url: done.links[i] });
  };
  const copy = async (i: number) => {
    if (!done) return;
    if (await copyToClipboard(done.links[i])) setCopied(i);
  };

  return (
    <FunPage title={W.santaTitle} path={SANTA_PATH}>
      {done ? (
        <section aria-labelledby="santa-done" data-santa-done="">
          <h2 id="santa-done">{W.santaDoneTitle}</h2>
          <p className="gg-fun-lead">{W.santaDoneLead}</p>
          <p className="gg-fun-lead font-semibold" data-santa-no-peek="">{W.santaNoPeek}</p>
          <div className="gg-fun-card">
            {done.names.map((n, i) => (
              <div key={done.links[i]} className="gg-santa-link" data-santa-person={i}>
                <b>{n}</b>
                <span className="gg-fun-row">
                  <Button type="button" size="sm" className="btn-grad-primary h-auto min-h-11 max-w-full whitespace-normal text-center" onClick={() => send(i)} data-santa-send={i}>{W.santaSend(n)}</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copy(i)} data-santa-copy={i}>{copied === i ? W.santaCopied : W.santaCopy}</Button>
                </span>
              </div>
            ))}
          </div>
          <p className="gg-fun-note">{W.santaKeepNote}</p>
          <Button type="button" variant="link" size="inline" className="gg-link" onClick={() => { setDone(null); setNames(["", "", ""]); setPairs([]); setCopied(null); }} data-santa-again="">
            {W.santaStartOver}
          </Button>
        </section>
      ) : (
        <form onSubmit={(e) => void submit(e)} noValidate data-santa-form="">
          <p className="gg-fun-lead">{W.santaLead}</p>
          <Hint id="fun-santa">{W.hintSanta}</Hint>
          <div className="gg-fun-card">
            <fieldset>
              <legend className="text-sm font-semibold">{W.santaNames}</legend>
              <ul className="gg-fun-list mt-2">
                {names.map((n, i) => (
                  <li key={i} className="gg-fun-row">
                    <input aria-label={W.santaNamePlaceholder(i + 1)} placeholder={W.santaNamePlaceholder(i + 1)} value={n} maxLength={SANTA_NAME_MAX} autoComplete="off"
                      onChange={(e) => setNames(names.map((x, k) => (k === i ? e.target.value : x)))} data-santa-name={i} />
                    {names.length > SANTA_MIN && (
                      <button type="button" className="gg-fun-x" aria-label={W.santaRemoveName(n)} data-santa-remove={i}
                        onClick={() => {
                          setNames(names.filter((_, k) => k !== i));
                          setPairs(pairs.filter(([a, c]) => a !== i && c !== i).map(([a, c]) => [a > i ? a - 1 : a, c > i ? c - 1 : c]));
                        }}>
                        <span aria-hidden="true">×</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </fieldset>
            {names.length < SANTA_MAX && (
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setNames([...names, ""])} data-santa-add="">{W.santaAddName}</Button>
            )}
            <label htmlFor="santa-budget">{W.santaBudget}</label>
            <input id="santa-budget" inputMode="decimal" placeholder="$25" value={budget} onChange={(e) => setBudget(e.target.value)} data-santa-budget="" />
            <label htmlFor="santa-day">{W.santaDate}</label>
            <input id="santa-day" type="date" min={louisianaYmd(new Date())} max={louisianaYmd(new Date(Date.now() + SANTA_DAY_MAX_DAYS * 86400000))} value={day} onChange={(e) => setDay(e.target.value)} data-santa-day="" />
          </div>
          <div className="gg-fun-card">
            <p className="m-0 text-sm font-semibold">{W.santaAvoidTitle}</p>
            <p className="gg-fun-note mt-0.5">{W.santaAvoidHelp}</p>
            <ul className="gg-fun-list mt-2">
              {pairs.map(([a, c], k) => (
                <li key={k} className="gg-fun-row" data-santa-pair={k}>
                  {([a, c] as const).map((v, side) => (
                    <select key={side} aria-label={side === 0 ? W.santaPickA : W.santaPickB} value={v}
                      onChange={(e) => setPairs(pairs.map((p, j) => (j === k ? (side === 0 ? [Number(e.target.value), p[1]] : [p[0], Number(e.target.value)]) : p)))}>
                      {names.map((n, i) => <option key={i} value={i}>{n.trim() || W.santaNamePlaceholder(i + 1)}</option>)}
                    </select>
                  ))}
                  <button type="button" className="gg-fun-x" aria-label={W.santaAvoidRemove} onClick={() => setPairs(pairs.filter((_, j) => j !== k))}>
                    <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setPairs([...pairs, [0, Math.min(1, names.length - 1)]])} data-santa-pair-add="">
              {W.santaAvoidAdd}
            </Button>
          </div>
          {error && <p className="gg-fun-err" role="alert" data-santa-error="">{error}</p>}
          <Button type="submit" className="btn-grad-primary mt-3 w-full" disabled={busy} data-santa-draw="">{busy ? W.santaDrawing : W.santaDraw}</Button>
          <p className="gg-fun-note">{W.santaKeepNote}</p>
        </form>
      )}
    </FunPage>
  );
}
