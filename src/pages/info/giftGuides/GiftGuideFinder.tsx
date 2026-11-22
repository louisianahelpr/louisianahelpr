import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, subscribeGuidePicks } from "@/content/giftGuideCatalog";
import { EXTRAS_WORDS as W, FINDER_ANCHOR } from "@/content/giftGuideExtras1120";
import {
  QUIZ_AGES, QUIZ_FIRST, QUIZ_WHO, giftQuiz, quizBudgets, quizForWords, quizIntoChips, quizStep, readQuiz,
  type QuizAnswers,
} from "@/content/giftQuiz";
import { PricesAsOf } from "@/components/giftGuides/PickPrice";
import { PickRow } from "./GiftGuideView";

/**
 * The gift quiz, "Find a gift" (owner 2026-11-21 ~6:15 PM: "The whole point of a quiz is to ask questions to
 * narrow down the list"; the rules: src/content/giftQuiz.ts). One question per screen with big answers (who; a kid's
 * age; budget; what they are into), then "Our picks for her": six cards (the guides' own card), "Show me more" for up to
 * twelve, a link to the whole guide and "Start over". The answers live in the URL
 * (/gift-guides?who=her&budget=25-50&into=cozy#gift-finder), so the link shares the same list; no sign-in.
 * Guard: src/test/giftQuiz1121.test.tsx.
 */
const FINDER_ID = FINDER_ANCHOR;
const FINDER_TITLE_ID = "gift-finder-title";

function Step({ n, of, question, children, onBack }: { n: number; of: number; question: string; children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="gg-quiz-step" data-gift-quiz-step={n}>
      <p className="gg-quiz-progress">{W.quizStepOf(n, of)}</p>
      <p className="gg-quiz-q" id="gift-quiz-q">{question}</p>
      <div role="group" aria-labelledby="gift-quiz-q" className="gg-quiz-answers">{children}</div>
      {onBack && <Button type="button" variant="link" size="inline" className="gg-link gg-quiz-back" onClick={onBack} data-gift-quiz-back="">← {W.quizBack}</Button>}
    </div>
  );
}

function Answer({ label, onPick, attr, sub }: { label: string; onPick: () => void; attr: string; sub?: string }) {
  return (
    <Button type="button" variant="outline" className="gg-quiz-answer" onClick={onPick} data-gift-quiz-answer={attr}>
      <span>{label}</span>
      {sub && <small>{sub}</small>}
    </Button>
  );
}

export function GiftFinder() {
  const { search } = useLocation();
  const navigate = useNavigate();
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  const a = readQuiz(new URLSearchParams(search));
  const who = QUIZ_WHO.find((x) => x.id === a.who);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (who) loadGuidePicks(who.guide).catch((e: unknown) => console.warn("gift quiz: picks chunk failed", who.guide, e));
  }, [who]);
  useEffect(() => { setMore(false); setCopied(false); }, [search]);
  const go = (next: QuizAnswers) => {
    const q = new URLSearchParams();
    for (const k of ["who", "age", "budget", "into"] as const) if (next[k]) q.set(k, next[k]!);
    navigate({ search: q.toString() ? `?${q.toString()}` : "", hash: FINDER_ID });
  };
  const pool = who && picksReady(who.guide) ? guideBySlug(who.guide)?.picks ?? [] : [];
  const step = quizStep(a);
  const kids = a.who === "kids";
  const total = kids ? 4 : 3;
  const loading = !!who && !picksReady(who.guide);
  const back = (drop: keyof QuizAnswers) => () => { const n = { ...a }; delete n[drop]; go(n); };

  let body: React.ReactNode;
  if (loading) body = <p className="gg-soon" role="status" data-gift-picks-loading="">{W.quizLoading}</p>;
  else if (step === "who") {
    body = (
      <Step n={1} of={3} question={W.finderWho}>
        {QUIZ_WHO.map((x) => <Answer key={x.id} label={x.label} attr={`who:${x.id}`} onPick={() => go({ who: x.id })} />)}
      </Step>
    );
  } else if (step === "age") {
    body = (
      <Step n={2} of={total} question={W.quizAge} onBack={back("who")}>
        {QUIZ_AGES.map((x) => <Answer key={x.id} label={x.label} attr={`age:${x.id}`} onPick={() => go({ ...a, age: x.id })} />)}
      </Step>
    );
  } else if (step === "budget") {
    body = (
      <Step n={kids ? 3 : 2} of={total} question={W.finderBudget} onBack={back(kids ? "age" : "who")}>
        {quizBudgets(pool, a).map((b) => <Answer key={b.id} label={b.label} attr={`budget:${b.id}`} onPick={() => go({ ...a, budget: b.id })} />)}
      </Step>
    );
  } else if (step === "into") {
    body = (
      <Step n={total} of={total} question={W.quizInto} onBack={back("budget")}>
        {quizIntoChips(pool, a).map((c) => <Answer key={c.id} label={c.label} attr={`into:${c.id}`} onPick={() => go({ ...a, into: c.id })} />)}
      </Step>
    );
  } else {
    const result = giftQuiz(pool, { who: a.who!, age: a.age, budget: a.budget!, into: a.into! });
    const shown = result.picks.slice(0, more ? result.picks.length : QUIZ_FIRST);
    const guide = guideBySlug(who!.guide);
    const copy = () => {
      void navigator.clipboard?.writeText(window.location.href).then(
        () => setCopied(true),
        // Clipboard refused: the address bar still holds the link.
        () => setCopied(false),
      );
    };
    body = (
      <div data-gift-finder-results="">
        <p className="gg-quiz-q" data-gift-quiz-result-title="">{W.quizResults(quizForWords(a))}</p>
        {result.widened && <p className="gg-price-note" data-gift-quiz-widened="">{W.quizWidened}</p>}
        <ol className="gg-list gg-quiz-list" data-gift-list="" data-quiz-count={shown.length}>{shown.map((p) => <PickRow key={p.href} pick={p} guide={who!.guide} />)}</ol>
        <PricesAsOf picks={shown} />
        {!more && result.picks.length > QUIZ_FIRST && (
          <Button type="button" variant="outline" size="inline" className="gg-more-picks" onClick={() => setMore(true)} data-gift-quiz-more="">{W.quizMore}</Button>
        )}
        <span className="gg-chips gg-quiz-after">
          {guide && <Link to={`/gift-guides/${guide.slug}`} className="gg-link" data-gift-quiz-guide="">{W.quizWholeGuide(guide.title)} ›</Link>}
          <Button type="button" variant="outline" size="sm" className="gg-chip" onClick={copy} data-gift-finder-share="">{copied ? W.finderCopied : W.finderShare}</Button>
          <Button asChild variant="link" size="inline" className="gg-link"><Link to={`/gift-guides#${FINDER_ID}`} data-gift-finder-again="">{W.finderAgain}</Link></Button>
        </span>
      </div>
    );
  }
  return (
    <section id={FINDER_ID} aria-labelledby={FINDER_TITLE_ID} className="gg-finder gg-quiz" data-gift-finder="" data-gift-quiz={step}>
      <h2 id={FINDER_TITLE_ID} className="gg-finder-title">{W.finderTitle}</h2>
      {step === "who" && <p className="gg-finder-lead">{W.finderLead}</p>}
      {body}
    </section>
  );
}
