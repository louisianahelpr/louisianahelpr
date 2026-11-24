import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { HiddenFileInput } from "@/components/ui/HiddenFileInput";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PARISHES } from "@/lib/parishes";
import { SBS_WORDS as W, sbsDayWords, sbsFieldError } from "@/content/sbsFeaturedLocal";
import { louisianaDay } from "@/content/giftGuideDeals.mjs";
import { sbsDeviceId, submitFeaturedLocal } from "@/lib/sbsFeaturedApi";
import { SBS_CATEGORIES, SBS_LIMITS, checkSbsLogo, townKey, validateSbsSubmission } from "../../../../supabase/functions/_shared/sbsSubmission";

/**
 * The free "Get your business featured" form (owner 2026-11-20). Its own chunk: loads only when the card's button is
 * tapped. The page checks with the server's own rules (sbsSubmission.ts) for instant messages; the sbs-featured
 * function decides (it also checks the link loads, and the town against the ZIP table). The contact email is private.
 * Guard: src/test/sbsFeaturedLocal1120.test.tsx.
 */

/** Every Louisiana town the ZIP table knows, plus each parish (parishes.ts is generated from that same table). */
const TOWNS: string[] = [...new Set(PARISHES.flatMap((p) => p.cities))].sort((a, b) => a.localeCompare(b));
const TOWN_KEYS = new Set([...TOWNS.map(townKey), ...PARISHES.flatMap((p) => [townKey(p.name), townKey(`${p.name} Parish`)])]);
export const isLouisianaTown = (town: string) => TOWN_KEYS.has(townKey(town));

type Field = "businessName" | "town" | "category" | "link" | "deal" | "contactEmail" | "participating" | "logo";

const FORM_CSS = `
.gg-sbs-form{display:grid;gap:14px;max-width:40rem}
.gg-sbs-form .gg-sbs-l{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:700;color:var(--gg-ink);min-width:0}
.gg-sbs-hint{font-size:12px;font-weight:500;color:var(--gg-muted)}
.gg-sbs-err{font-size:13px;font-weight:600;color:hsl(var(--destructive-ink))}
.gg-sbs-cta p.gg-sbs-err{color:hsl(var(--destructive-ink));margin:0}
.gg-sbs-form [aria-invalid="true"]{border-color:hsl(var(--destructive-ink));box-shadow:0 0 0 1px hsl(var(--destructive-ink))}
.gg-sbs-logo-row button{flex:none;white-space:nowrap}
.gg-sbs-check{display:flex;align-items:flex-start;gap:10px;min-height:44px;font-size:14px;font-weight:600;color:var(--gg-ink)}
.gg-sbs-check button{margin-top:2px}
.gg-sbs-logo-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;font-size:13px;color:var(--gg-muted);min-width:0}
.gg-sbs-logo-row span{overflow-wrap:anywhere;min-width:0}
.gg-sbs-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.gg-sbs-done{font-size:15px;font-weight:600;line-height:1.45;color:var(--gg-ink)}
`;

export function SmallBizSubmitForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ businessName: "", town: "", category: "", link: "", deal: "", contactEmail: "", participating: false });
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  // Holiday audit 1121 #54: the deal box and the required tick stop naming Small Business Saturday once it has passed.
  const today = louisianaDay(new Date());
  const dayW = sbsDayWords(today);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const towns = useMemo(() => TOWNS, []);

  const focusFirstError = () =>
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());

  const submit = async () => {
    setProblem(null);
    const v = validateSbsSubmission({ ...f, participating: f.participating === true });
    const errs: Partial<Record<Field, string>> = {};
    if (!v.ok) for (const [k, code] of Object.entries(v.errors)) errs[k as Field] = sbsFieldError(k, code!, today);
    if (!errs.town && f.town.trim() && !isLouisianaTown(f.town)) errs.town = sbsFieldError("town", "town");
    if (logo) {
      const l = checkSbsLogo(logo.type, logo.size);
      if (l) errs.logo = sbsFieldError("logo", l);
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      focusFirstError();
      return;
    }
    setSending(true);
    const res = await submitFeaturedLocal({ ...f, device: sbsDeviceId() }, logo);
    setSending(false);
    if (res.ok) {
      setDone(true);
      return;
    }
    if (res.kind === "invalid") {
      const e: Partial<Record<Field, string>> = {};
      for (const [k, code] of Object.entries(res.fields)) e[k as Field] = sbsFieldError(k, code ?? "", today);
      if (Object.keys(e).length === 0) setProblem(W.server);
      setErrors(e);
      focusFirstError();
    } else setProblem(res.kind === "duplicate" ? W.duplicate : res.kind === "rate_limited" ? W.rateLimited : W.server);
  };

  if (done) {
    return (
      <div data-gift-sbs-done="">
        <style>{FORM_CSS}</style>
        <p className="gg-sbs-done" role="status">{W.done}</p>
        <div className="gg-sbs-actions" style={{ marginTop: 10 }}>
          <Button
            variant="outline"
            onClick={() => {
              setF({ businessName: "", town: "", category: "", link: "", deal: "", contactEmail: "", participating: false });
              setLogo(null);
              setDone(false);
            }}
          >
            {W.doneAgain}
          </Button>
          <Button variant="ghost" onClick={onClose}>{W.cancel}</Button>
        </div>
      </div>
    );
  }

  const err = (k: Field) =>
    errors[k] ? <span className="gg-sbs-err" id={`sbs-err-${k}`}>{errors[k]}</span> : null;
  const aria = (k: Field) => ({ "aria-invalid": errors[k] ? (true as const) : undefined, "aria-describedby": errors[k] ? `sbs-err-${k}` : undefined });

  return (
    <form
      ref={formRef}
      className="gg-sbs-form"
      noValidate
      data-gift-sbs-form=""
      onSubmit={(e) => {
        e.preventDefault();
        if (!sending) void submit();
      }}
    >
      <style>{FORM_CSS}</style>
      <label className="gg-sbs-l">
        {W.fields.businessName}
        <Input value={f.businessName} maxLength={SBS_LIMITS.name} autoComplete="organization" autoCapitalize="words" onChange={(e) => set("businessName", e.target.value)} {...aria("businessName")} />
        {err("businessName")}
      </label>
      <label className="gg-sbs-l">
        {W.fields.town}
        <span className="gg-sbs-hint">{W.fields.townHint}</span>
        <Input value={f.town} list="gg-sbs-towns" maxLength={SBS_LIMITS.town} autoComplete="address-level2" onChange={(e) => set("town", e.target.value)} {...aria("town")} />
        <datalist id="gg-sbs-towns">{towns.map((t) => <option key={t} value={t} />)}</datalist>
        {err("town")}
      </label>
      <label className="gg-sbs-l">
        {W.fields.category}
        <NativeSelect value={f.category} onChange={(e) => set("category", e.target.value)} {...aria("category")}>
          <option value="">{W.fields.categoryPick}</option>
          {SBS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </NativeSelect>
        {err("category")}
      </label>
      <label className="gg-sbs-l">
        {W.fields.link}
        <span className="gg-sbs-hint">{W.fields.linkHint}</span>
        <Input value={f.link} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={SBS_LIMITS.url} placeholder={W.fields.linkPlaceholder} onChange={(e) => set("link", e.target.value)} {...aria("link")} />
        {err("link")}
      </label>
      <label className="gg-sbs-l">
        {dayW.deal}
        <span className="gg-sbs-hint">{dayW.dealHint}</span>
        <Textarea value={f.deal} rows={2} maxLength={SBS_LIMITS.deal} onChange={(e) => set("deal", e.target.value)} {...aria("deal")} />
        {err("deal")}
      </label>
      <div className="gg-sbs-l">
        {W.fields.logo}
        <span className="gg-sbs-hint">{W.fields.logoHint}</span>
        <HiddenFileInput
          ref={fileRef}
          aria-label={W.fields.logo}
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            setLogo(file);
            setErrors((x) => ({ ...x, logo: file ? (checkSbsLogo(file.type, file.size) ? sbsFieldError("logo", checkSbsLogo(file.type, file.size)!) : undefined) : undefined }));
          }}
        />
        <span className="gg-sbs-logo-row">
          <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>{logo ? W.fields.logoChange : W.fields.logoChoose}</Button>
          {logo && (
            <>
              <span>{logo.name}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setLogo(null)}>{W.fields.logoRemove}</Button>
            </>
          )}
        </span>
        {err("logo")}
      </div>
      <label className="gg-sbs-l">
        {W.fields.email}
        <span className="gg-sbs-hint">{W.fields.emailHint}</span>
        <Input value={f.contactEmail} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" maxLength={SBS_LIMITS.email} onChange={(e) => set("contactEmail", e.target.value)} {...aria("contactEmail")} />
        {err("contactEmail")}
      </label>
      <div>
        <label className="gg-sbs-check min-h-11">
          <Checkbox checked={f.participating} onCheckedChange={(v) => set("participating", v === true)} {...aria("participating")} />
          <span>{dayW.participating}</span>
        </label>
        {err("participating")}
      </div>
      {problem && <p className="gg-sbs-err" role="alert">{problem}</p>}
      <div className="gg-sbs-actions">
        <Button type="submit" className="btn-grad-primary" disabled={sending} data-gift-sbs-submit="">{sending ? W.sending : W.submit}</Button>
        <Button type="button" variant="ghost" onClick={onClose}>{W.cancel}</Button>
      </div>
    </form>
  );
}
