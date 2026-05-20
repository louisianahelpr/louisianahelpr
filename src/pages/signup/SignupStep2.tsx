// SignupStep2 — "Tell us about you." (UI step 2 of 3).
//
// Profile picture, name, contact, basic identity + government ID upload.
// Like Step1, owns no state — every field is bound through props lifted
// into the parent. File handlers (avatar + ID) are passed in as
// callbacks so the validateFile / state-setter wiring stays in one place.
//
// Validation lives in the parent (validateAboutYouStep).

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Camera,
  ArrowRight,
  ArrowLeft,
  FileText,
  ShieldCheck,
  UserRound,
  Lock,
  AlertCircle,
} from "lucide-react";
import { DateOfBirthPicker } from "@/components/DateOfBirthPicker";
import { formatPhone } from "./signupHelpers";

/** Renders a red inline error message below a form field. */
function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-ds-11 text-destructive mt-1">
      <AlertCircle className="w-3 h-3 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export interface SignupStep2Props {
  isBusinessSignup: boolean;
  companyName: string;
  setCompanyName: (v: string) => void;
  avatarFile: File | null;
  avatarPreview: string | null;
  onAvatarChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  dateOfBirth: string;
  setDateOfBirth: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  idFile: File | null;
  idPreview: string | null;
  setIdFile: (v: File | null) => void;
  setIdPreview: (v: string | null) => void;
  onIdChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  inputCls: string;
  labelCls: string;
  /**
   * Map of field key → error message string. Populated by the parent's
   * validateAboutYouStep() so ALL missing fields are shown at once.
   */
  fieldErrors?: Record<string, string>;
  /** Called when the user edits a field, to clear its individual error. */
  clearFieldError?: (key: string) => void;
  /** Called when the user clicks Back. */
  onBack: () => void;
  /** Called when the user clicks Continue — parent runs validation, then advances step. */
  onContinue: () => void | Promise<void>;
}

export function SignupStep2(props: SignupStep2Props) {
  const {
    isBusinessSignup,
    companyName,
    setCompanyName,
    avatarPreview,
    onAvatarChange,
    firstName,
    setFirstName,
    lastName,
    setLastName,
    phone,
    setPhone,
    dateOfBirth,
    setDateOfBirth,
    location,
    setLocation,
    bio,
    setBio,
    idFile,
    idPreview,
    setIdFile,
    setIdPreview,
    onIdChange,
    inputCls,
    labelCls,
    fieldErrors = {},
    clearFieldError,
    onBack,
    onContinue,
  } = props;

  return (
    <div className="space-y-6">
      {isBusinessSignup && (
        <div className="rounded-ds-md border border-primary/30 bg-primary/5 p-4 space-y-3">
          <p className="text-ds-13 font-semibold text-primary">📊 Business account</p>
          <div className="space-y-2">
            <Label htmlFor="companyName" className={labelCls}>Company name <span aria-hidden="true" className="text-destructive">*</span></Label>
            <Input
              id="companyName"
              placeholder="Acme Property Management"
              value={companyName}
              onChange={(e) => { setCompanyName(e.target.value); clearFieldError?.("companyName"); }}
              required
              aria-required="true"
              className={`${inputCls}${fieldErrors.companyName ? " border-destructive" : ""}`}
            />
            <FieldError message={fieldErrors.companyName} />
          </div>
          <p className="text-ds-11 text-muted-foreground">
            You'll be the owner. Invite 1 teammate free (2 seats total) — add more anytime with seat upgrades.
          </p>
        </div>
      )}

      {/* Section 1: Your photo (top of page — most personal first) */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-display-eyebrow">Your photo</span>
          <span className="text-destructive text-ds-11">*</span>
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <label className="cursor-pointer group relative inline-block active:scale-[0.98] transition-transform">
            <div className="relative w-28 h-28 rounded-full border-2 border-dashed border-border group-hover:border-primary transition-colors flex items-center justify-center overflow-hidden bg-secondary/40">
              {avatarPreview && avatarPreview.startsWith("blob:") ? (
                <img loading="lazy" decoding="async" src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserRound className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
              )}
            </div>
            <div
              className="pointer-events-none absolute -bottom-1 -right-1 w-11 h-11 rounded-full flex items-center justify-center z-10"
              style={{
                background: "hsl(var(--bark))",
                color: "hsl(var(--parchment))",
                boxShadow:
                  "0 0 0 3px hsl(var(--parchment)), " +
                  "0 6px 18px -4px hsl(var(--bark) / 0.45)",
              }}
            >
              <Camera className="w-5 h-5" strokeWidth={2.25} />
            </div>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => { onAvatarChange(e); clearFieldError?.("avatar"); }} />
          </label>
          <p className="text-ds-11 text-muted-foreground text-center max-w-[260px] leading-relaxed">
            A clear face photo builds trust with neighbors. JPG or PNG, max 5MB.
          </p>
          <FieldError message={fieldErrors.avatar} />
        </div>
      </section>

      {/* Section 2: Your name + personal details */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-display-eyebrow">Your details</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="firstName" className={labelCls}>First name <span aria-hidden="true" className="text-destructive">*</span></Label>
            <Input id="firstName" placeholder="Jane" value={firstName} onChange={(e) => { setFirstName(e.target.value); clearFieldError?.("firstName"); }} required aria-required="true" autoComplete="given-name" className={`${inputCls}${fieldErrors.firstName ? " border-destructive" : ""}`} />
            <FieldError message={fieldErrors.firstName} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName" className={labelCls}>Last name <span aria-hidden="true" className="text-destructive">*</span></Label>
            <Input id="lastName" placeholder="Doe" value={lastName} onChange={(e) => { setLastName(e.target.value); clearFieldError?.("lastName"); }} required aria-required="true" autoComplete="family-name" className={`${inputCls}${fieldErrors.lastName ? " border-destructive" : ""}`} />
            <FieldError message={fieldErrors.lastName} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone" className={labelCls}>Phone number <span aria-hidden="true" className="text-destructive text-ds-11">*</span></Label>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => { setPhone(formatPhone(e.target.value)); clearFieldError?.("phone"); }}
            required
            aria-required="true"
            autoComplete="tel"
            maxLength={14}
            className={`${inputCls}${fieldErrors.phone ? " border-destructive" : ""}`}
          />
          <FieldError message={fieldErrors.phone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dob" className={labelCls}>Date of birth <span aria-hidden="true" className="text-destructive text-ds-11">*</span></Label>
          <DateOfBirthPicker id="dob" value={dateOfBirth} onChange={(v) => { setDateOfBirth(v); clearFieldError?.("dateOfBirth"); }} />
          {fieldErrors.dateOfBirth
            ? <FieldError message={fieldErrors.dateOfBirth} />
            : <p className="text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.6)" }}>You must be at least 18 years old.</p>
          }
        </div>
        <div className="space-y-2">
          <Label htmlFor="location" className={labelCls}>City <span aria-hidden="true" className="text-destructive">*</span></Label>
          <Input id="location" placeholder="e.g. Baton Rouge, LA" value={location} onChange={(e) => { setLocation(e.target.value); clearFieldError?.("location"); }} required aria-required="true" autoComplete="address-level2" className={`${inputCls}${fieldErrors.location ? " border-destructive" : ""}`} />
          <FieldError message={fieldErrors.location} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bio" className={labelCls}>About you <span aria-hidden="true" className="text-destructive">*</span></Label>
          <Textarea
            id="bio"
            placeholder="Tell us a bit about yourself — whether you're looking for work or need help around the house…"
            value={bio}
            onChange={(e) => { setBio(e.target.value); clearFieldError?.("bio"); }}
            rows={4}
            required
            aria-required="true"
            minLength={20}
            className={`rounded-ds-md${fieldErrors.bio ? " border-destructive" : ""}`}
          />
          {fieldErrors.bio
            ? <FieldError message={fieldErrors.bio} />
            : <p className={`text-ds-11 ${bio.trim().length >= 20 ? "text-primary" : "text-muted-foreground"}`}>
                {bio.trim().length}/20 characters minimum {bio.trim().length >= 20 && "✓"}
              </p>
          }
        </div>
      </section>

      {/* Section 5: Identity verification */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-display-eyebrow">Verify your identity</span>
          <span className="text-destructive text-ds-11">*</span>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-card p-5 space-y-4">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <ShieldCheck className="w-6 h-6 text-primary" strokeWidth={1.75} />
            </div>
            <h2 className="text-ds-15 font-display font-semibold text-foreground">Government-issued ID</h2>
            <p className="text-ds-11 text-muted-foreground leading-relaxed">
              Driver's license, state ID, or passport. Stored encrypted and used for safety, fraud prevention, and compliance.
            </p>
            <div className="flex items-center justify-center gap-1.5 text-ds-11 text-primary font-medium pt-1">
              <Lock className="w-3 h-3" /> Encrypted · Never shared publicly
            </div>
          </div>
          {idFile ? (
            <div className="flex items-center justify-between gap-3 rounded-ds-md liquid-glass p-3">
              <div className="flex items-center gap-3 min-w-0">
                {idPreview && idPreview.startsWith("blob:") ? (
                  <img loading="lazy" decoding="async" src={idPreview} alt="ID preview" className="w-14 h-14 rounded-ds-sm object-cover border border-border shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-ds-sm border border-border flex items-center justify-center bg-muted/40 shrink-0">
                    <FileText className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-ds-13 font-medium text-foreground truncate">{idFile.name}</p>
                  <p className="text-ds-11 text-muted-foreground">{(idFile.size / 1024).toFixed(0)} KB · uploaded</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setIdFile(null); setIdPreview(null); }}
                className="text-ds-11 text-destructive hover:underline shrink-0 font-medium"
              >
                Remove
              </button>
            </div>
          ) : (
            <label className={`flex flex-col items-center justify-center gap-2 rounded-ds-md border-2 border-dashed bg-card hover:border-primary/60 hover:bg-primary/[0.02] px-4 py-7 cursor-pointer transition-all ${fieldErrors.idFile ? "border-destructive" : "border-border"}`}>
              <Camera className="w-7 h-7 text-primary/70" strokeWidth={1.75} />
              <span className="text-ds-13 font-semibold text-foreground">Upload your ID</span>
              <span className="text-ds-11 text-muted-foreground">JPG, PNG, or PDF · Max 5MB</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => { onIdChange(e); clearFieldError?.("idFile"); }}
              />
            </label>
          )}
          <FieldError message={fieldErrors.idFile} />
        </div>
      </section>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-ds-md" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button
          variant="bark"
          className="flex-1 rounded-ds-md"
          size="lg"
          onClick={onContinue}
        >
          Continue <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
