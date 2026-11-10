/**
 * Section L, "Claim Your Day": the advent calendar (days 1-25, every day
 * selectable, counts only, never names; "Full" at the per-day cap), the
 * sign-up form and the thank-you. The page checks the form for instant
 * messages with the SAME validator the server runs
 * (supabase/functions/_shared/sponsorSignup.ts); the server decides.
 */
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { sponsorPage as C } from "@/content/sponsorPage";
import { buildIcs, daysLabel } from "@/lib/sponsor/dates";
import type { SponsorPublicState, SponsorSignupPayload, SponsorSubmitResult } from "@/lib/sponsor/types";
import { checkLogo, sponsorSignupsOpen, validateSponsorSignup } from "../../../supabase/functions/_shared/sponsorSignup";
import { confettiBurst } from "./confetti";
import { GiftBox, Icon, Sparkle } from "./Decor";

const E = C.claim.errors;
const F = C.claim.form;
const DAYS = Array.from({ length: C.event.lastDay - C.event.firstDay + 1 }, (_, i) => C.event.firstDay + i);

type FieldKey = keyof SponsorSignupPayload | "logo";

/** The message for a validator/server error code on a field. Exported for its test. */
export function errorMessage(code: string | undefined): string | null {
  switch (code) {
    case undefined: return null;
    case "required": return E.required;
    case "email": return E.email;
    case "days": return E.days;
    case "prizeValue": return E.prizeValue;
    case "agree": return E.agree;
    case "url": return E.url;
    case "logoType": return E.logoType;
    case "logoSize": return E.logoSize;
    case "tooLong": return "That's a bit long. Please shorten it.";
    default: return E.generic;
  }
}

/** "3 brands joined" / "Full" for one calendar tile. Exported for its test. */
export function dayTileLabel(count: number, maxPerDay: number | null): { label: string; full: boolean } {
  if (maxPerDay !== null && count >= maxPerDay) return { label: C.claim.full, full: true };
  if (count <= 0) return { label: C.claim.dayCount.none, full: false };
  const tpl = count === 1 ? C.claim.dayCount.one : C.claim.dayCount.many;
  return { label: tpl.replace("{n}", String(count)), full: false };
}

const EMPTY: SponsorSignupPayload = {
  brandName: "", contactName: "", email: "", phone: "", website: "", instagram: "", facebook: "", tiktok: "",
  prizeDescription: "", prizeValue: "", shipTo: "", notes: "", days: [], anyDay: false, agree: false, showOnWall: false,
  ref: null, company_fax: "",
};

function Field({ id, label, error, hint, children }: { id: string; label: string; error: string | null; hint?: string; children: ReactNode }) {
  return (
    <div className={`lh25-field${error ? " lh25-field-error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && !error ? <p className="lh25-hint" id={`${id}-hint`}>{hint}</p> : null}
      {error ? <p className="lh25-error" id={`${id}-error`} role="alert">{error}</p> : null}
    </div>
  );
}

export function ClaimSection({
  state,
  greetingBrand,
  refCode,
  onSubmit,
  nowMs,
}: {
  /** For tests and the local preview only; the real page passes nothing and reads the clock. */
  nowMs?: number;
  state: SponsorPublicState;
  greetingBrand: string | null;
  refCode: string | null;
  onSubmit: (payload: SponsorSignupPayload, logo: File | null) => Promise<SponsorSubmitResult>;
}) {
  const [form, setForm] = useState<SponsorSignupPayload>(() => ({ ...EMPTY, brandName: greetingBrand ?? "", ref: refCode }));
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ days: number[]; anyDay: boolean; brand: string } | null>(null);
  const [extraFull, setExtraFull] = useState<number[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof SponsorSignupPayload>(k: K, v: SponsorSignupPayload[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const fullDays = useMemo(() => {
    const s = new Set(extraFull);
    for (const d of DAYS) if (dayTileLabel(state.dayCounts[d] ?? 0, state.maxPerDay).full) s.add(d);
    return s;
  }, [state, extraFull]);

  const toggleDay = (d: number, el: HTMLElement) => {
    if (fullDays.has(d)) return;
    const on = !form.days.includes(d);
    const days = on ? [...form.days, d].sort((a, b) => a - b) : form.days.filter((x) => x !== d);
    setForm((f) => ({ ...f, days, anyDay: days.length > 0 ? false : f.anyDay }));
    if (errors.days) setErrors((e) => ({ ...e, days: undefined }));
    if (on) {
      const r = el.getBoundingClientRect();
      confettiBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, 24);
    }
  };

  const pickLogo = (file: File | null) => {
    setLogo(null);
    setErrors((e) => ({ ...e, logo: undefined }));
    if (!file) return;
    const bad = checkLogo(file.type, file.size);
    if (bad) {
      setErrors((e) => ({ ...e, logo: errorMessage(bad) ?? undefined }));
      return;
    }
    setLogo(file);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setBanner(null);
    const v = validateSponsorSignup({ ...form });
    const errs: Partial<Record<FieldKey, string>> = {};
    if (!v.ok) for (const [k, code] of Object.entries(v.errors)) errs[k as FieldKey] = errorMessage(code) ?? undefined;
    if (errors.logo) errs.logo = errors.logo;
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      const first = Object.keys(errs).find((k) => errs[k as FieldKey]);
      const target = first === "days" ? document.getElementById("lh25-days") : formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`);
      target?.focus({ preventScroll: false });
      return;
    }
    setBusy(true);
    try {
      const res = await onSubmit(form, logo);
      if (res.ok) {
        setDone({ days: res.days, anyDay: res.anyDay, brand: form.brandName.trim() });
        confettiBurst(undefined, 90);
        requestAnimationFrame(() => doneRef.current?.focus());
        return;
      }
      if (res.kind === "full") {
        setExtraFull((x) => [...new Set([...x, ...res.fullDays])]);
        setForm((f) => ({ ...f, days: f.days.filter((d) => !res.fullDays.includes(d)) }));
        setBanner(E.full.replace("{days}", daysLabel(res.fullDays)));
      } else if (res.kind === "closed") {
        setBanner(E.closed);
      } else if (res.kind === "rateLimited") {
        setBanner(E.rateLimited);
      } else if (res.kind === "invalid") {
        const errs2: Partial<Record<FieldKey, string>> = {};
        for (const [k, code] of Object.entries(res.errors)) errs2[k as FieldKey] = errorMessage(code) ?? undefined;
        setErrors(errs2);
        setBanner(E.generic);
      } else {
        setBanner(E.generic);
      }
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    const ics = buildIcs({ brand: done.brand, days: done.days, anyDay: done.anyDay });
    const href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return (
      <section className="lh25-section" id="claim" aria-labelledby="lh25-thanks">
        <div className="lh25-thanks" ref={doneRef} tabIndex={-1} data-testid="sponsor-thanks">
          <Sparkle className="lh25-thanks-s1" size={26} />
          <Sparkle className="lh25-thanks-s2" size={18} color="#C8102E" />
          <GiftBox size={64} />
          <h2 id="lh25-thanks">{C.thankYou.title}</h2>
          <p className="lh25-thanks-body">{C.thankYou.body}</p>
          <p className="lh25-thanks-days">
            <strong>{C.thankYou.yourDays}</strong> {done.anyDay ? C.thankYou.anyDay : daysLabel(done.days)}
          </p>
          <a className="lh25-btn lh25-btn-primary" href={href} download="25-days-of-louisiana-giveaways.ics">
            <Icon name="calendar" size={18} /> <span>{C.thankYou.addToCalendar}</span>
          </a>
        </div>
      </section>
    );
  }

  if (!sponsorSignupsOpen(nowMs ?? Date.now(), C.event.signup_deadline)) {
    return (
      <section className="lh25-section" id="claim" aria-labelledby="lh25-closed">
        <div className="lh25-thanks" data-testid="sponsor-closed">
          <h2 id="lh25-closed">{C.claim.closedTitle}</h2>
          <p className="lh25-thanks-body">{C.claim.closed}</p>
        </div>
      </section>
    );
  }

  const err = (k: FieldKey) => errors[k] ?? null;
  const describe = (id: string, k: FieldKey, hint?: boolean) => (errors[k] ? `${id}-error` : hint ? `${id}-hint` : undefined);

  return (
    <section className="lh25-section lh25-claim" id="claim" aria-labelledby="lh25-claim">
      <div className="lh25-section-title">
        <h2 id="lh25-claim">{C.claim.title}</h2>
      </div>
      <p className="lh25-lede lh25-center">{C.claim.intro}</p>
      <p className="lh25-deadline lh25-center">{C.claim.deadline}</p>

      <div
        className={`lh25-calendar${err("days") ? " lh25-calendar-error" : ""}`}
        id="lh25-days"
        tabIndex={-1}
        role="group"
        aria-label="Pick your giveaway day or days in December"
        aria-describedby={err("days") ? "lh25-days-error" : undefined}
      >
        {DAYS.map((d) => {
          const count = state.dayCounts[d] ?? 0;
          const { label, full: atCap } = dayTileLabel(count, state.maxPerDay);
          const full = atCap || fullDays.has(d);
          const selected = form.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              className={`lh25-tile${selected ? " is-selected" : ""}${full ? " is-full" : ""}`}
              aria-pressed={selected}
              disabled={full}
              onClick={(e) => toggleDay(d, e.currentTarget)}
              aria-label={`December ${d}, ${full ? C.claim.full : label}${selected ? ", picked" : ""}`}
            >
              <span className="lh25-tile-day">{d}</span>
              <span className="lh25-tile-count">{full ? C.claim.full : label}</span>
              {selected ? <span className="lh25-tile-check" aria-hidden="true"><Icon name="check" size={14} /></span> : null}
            </button>
          );
        })}
      </div>
      <label className="lh25-anyday">
        <input
          type="checkbox"
          checked={form.anyDay}
          onChange={(e) => {
            const on = e.target.checked;
            setForm((f) => ({ ...f, anyDay: on, days: on ? [] : f.days }));
            if (errors.days) setErrors((x) => ({ ...x, days: undefined }));
          }}
        />
        <span>{C.claim.anyDay}</span>
      </label>
      {err("days") ? <p className="lh25-error lh25-center" id="lh25-days-error" role="alert">{err("days")}</p> : null}
      {form.days.length > 0 ? <p className="lh25-picked lh25-center">Picked: {daysLabel(form.days)}</p> : null}

      <form ref={formRef} className="lh25-form" onSubmit={submit} noValidate>
        {/* Honeypot: hidden from people and screen readers; a bot that fills it is dropped by the server. */}
        <div className="lh25-hp" aria-hidden="true">
          <label htmlFor="lh25-company-fax">Company fax</label>
          <input id="lh25-company-fax" name="company_fax" tabIndex={-1} autoComplete="off" value={form.company_fax} onChange={(e) => set("company_fax", e.target.value)} />
        </div>

        <div className="lh25-form-grid">
          <Field id="lh25-brand" label={F.brandName} error={err("brandName")}>
            <input id="lh25-brand" name="brandName" autoComplete="organization" value={form.brandName} onChange={(e) => set("brandName", e.target.value)} aria-invalid={!!err("brandName")} aria-describedby={describe("lh25-brand", "brandName")} required />
          </Field>
          <Field id="lh25-contact" label={F.contactName} error={err("contactName")}>
            <input id="lh25-contact" name="contactName" autoComplete="name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} aria-invalid={!!err("contactName")} aria-describedby={describe("lh25-contact", "contactName")} required />
          </Field>
          <Field id="lh25-email" label={F.email} error={err("email")}>
            <input id="lh25-email" name="email" type="email" inputMode="email" autoComplete="email" value={form.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!err("email")} aria-describedby={describe("lh25-email", "email")} required />
          </Field>
          <Field id="lh25-phone" label={F.phone} error={err("phone")}>
            <input id="lh25-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} aria-describedby={describe("lh25-phone", "phone")} />
          </Field>
          <Field id="lh25-prize" label={F.prizeDescription} error={err("prizeDescription")} hint={F.prizeDescriptionHint}>
            <textarea id="lh25-prize" name="prizeDescription" rows={2} value={form.prizeDescription} onChange={(e) => set("prizeDescription", e.target.value)} aria-invalid={!!err("prizeDescription")} aria-describedby={describe("lh25-prize", "prizeDescription", true)} required />
          </Field>
          <Field id="lh25-value" label={F.prizeValue} error={err("prizeValue")}>
            <input id="lh25-value" name="prizeValue" inputMode="decimal" value={form.prizeValue} onChange={(e) => set("prizeValue", e.target.value)} aria-invalid={!!err("prizeValue")} aria-describedby={describe("lh25-value", "prizeValue")} required placeholder="50" />
          </Field>
          <Field id="lh25-website" label={F.website} error={err("website")}>
            <input id="lh25-website" name="website" type="url" inputMode="url" autoComplete="url" value={form.website} onChange={(e) => set("website", e.target.value)} aria-describedby={describe("lh25-website", "website")} placeholder="https://" />
          </Field>
          <Field id="lh25-ig" label={F.instagram} error={err("instagram")}>
            <input id="lh25-ig" name="instagram" value={form.instagram} onChange={(e) => set("instagram", e.target.value)} placeholder="@yourbrand" />
          </Field>
          <Field id="lh25-fb" label={F.facebook} error={err("facebook")}>
            <input id="lh25-fb" name="facebook" value={form.facebook} onChange={(e) => set("facebook", e.target.value)} placeholder="your Facebook page" />
          </Field>
          <Field id="lh25-tt" label={F.tiktok} error={err("tiktok")}>
            <input id="lh25-tt" name="tiktok" value={form.tiktok} onChange={(e) => set("tiktok", e.target.value)} placeholder="@yourbrand" />
          </Field>
          <Field id="lh25-logo" label={F.logo} error={err("logo")} hint={logo ? `${logo.name} ✓` : F.logoHint}>
            <input id="lh25-logo" name="logo" type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={(e) => pickLogo(e.target.files?.[0] ?? null)} aria-describedby={describe("lh25-logo", "logo", true)} />
          </Field>
          <fieldset className="lh25-field lh25-radio-group">
            <legend>{F.shipTo}</legend>
            <label><input type="radio" name="shipTo" value="winner" checked={form.shipTo === "winner"} onChange={() => set("shipTo", "winner")} /> {F.shipToWinner}</label>
            <label><input type="radio" name="shipTo" value="helpr" checked={form.shipTo === "helpr"} onChange={() => set("shipTo", "helpr")} /> {F.shipToHelpr}</label>
          </fieldset>
          <Field id="lh25-notes" label={F.notes} error={err("notes")}>
            <textarea id="lh25-notes" name="notes" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>

        <label className={`lh25-check${err("agree") ? " lh25-check-error" : ""}`}>
          <input type="checkbox" name="agree" checked={form.agree} onChange={(e) => set("agree", e.target.checked)} aria-invalid={!!err("agree")} aria-describedby={err("agree") ? "lh25-agree-error" : undefined} />
          <span>{F.agree} <span className="lh25-req" aria-hidden="true">*</span></span>
        </label>
        {err("agree") ? <p className="lh25-error" id="lh25-agree-error" role="alert">{err("agree")}</p> : null}
        <label className="lh25-check">
          <input type="checkbox" name="showOnWall" checked={form.showOnWall} onChange={(e) => set("showOnWall", e.target.checked)} />
          <span>{F.showOnWall}</span>
        </label>

        {banner ? <p className="lh25-banner-error" role="alert">{banner}</p> : null}
        <button type="submit" className="lh25-btn lh25-btn-primary lh25-submit" disabled={busy} aria-busy={busy}>
          {busy ? F.submitting : F.submit}
        </button>
      </form>
    </section>
  );
}
