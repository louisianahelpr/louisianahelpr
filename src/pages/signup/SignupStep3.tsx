// SignupStep3 — "Make your profile stand out." (UI step 3 of 3).
//
// Optional helpr-quality details: skills, availability, tools, emergency
// contact, extra comments, hear-about-us, professional credentials
// (license + insurance), portfolio, referral code.
//
// Largest of the three steps; ~480 lines of JSX moved out of Signup.tsx.
// Like Step1/Step2, owns no state — every field is bound through props
// lifted into the parent. File handlers are passed in as callbacks so
// validateFile / state-setter wiring stays in one place.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  ArrowRight,
  ArrowLeft,
  FileText,
  X,
  ImagePlus,
  Gift,
  Loader2,
  ShieldCheck,
  BadgeCheck,
  Award,
  Shield,
} from "lucide-react";
import { toast } from "sonner";

const ALL_SKILLS = [
  "Cleaning", "Moving", "Handyman", "Yard Work", "Painting", "Delivery", "Pet Care", "Errands", "Assembly",
  "Pressure Washing", "Lawn Care", "Plumbing", "Electrical", "Carpentry", "Tile Work", "Drywall",
  "Babysitting", "Senior Care", "Tutoring", "Cooking", "Laundry", "Organizing", "Event Help",
  "Photography", "Web Design", "Tech Support", "Junk Removal", "Auto Detailing", "Gutter Cleaning",
];

const EXPERIENCE_LEVELS = ["Beginner", "Some experience", "Experienced", "Professional"];
const AVAILABILITY_SLOTS = ["Weekday mornings", "Weekday afternoons", "Weekday evenings", "Weekends", "Flexible / Anytime"];
const JOB_RADIUS_OPTIONS = ["5 miles", "10 miles", "25 miles", "50+ miles", "Anywhere"];
const TOOL_PRESETS = ["Basic hand tools", "Power tools", "Lawn mower", "Pressure washer", "Ladder", "Cleaning supplies", "Moving dolly / straps", "Paint supplies"];
const HEAR_ABOUT_OPTIONS = ["Word of mouth", "Social media", "Google search", "Flyer / poster", "Friend / family", "Other"];

export interface SignupStep3Props {
  loading: boolean;
  skills: string;
  setSkills: (v: string) => void;
  skillSearch: string;
  setSkillSearch: (v: string) => void;
  experienceLevel: string;
  setExperienceLevel: (v: string) => void;
  availability: string[];
  setAvailability: (v: string[]) => void;
  jobRadius: string;
  setJobRadius: (v: string) => void;
  toolsEquipment: string[];
  setToolsEquipment: (v: string[]) => void;
  emergencyContactName: string;
  setEmergencyContactName: (v: string) => void;
  emergencyContactPhone: string;
  setEmergencyContactPhone: (v: string) => void;
  extraComments: string;
  setExtraComments: (v: string) => void;
  hearAboutUs: string;
  setHearAboutUs: (v: string) => void;
  isLicensed: boolean;
  setIsLicensed: (v: boolean) => void;
  licenseFile: File | null;
  setLicenseFile: (v: File | null) => void;
  licensePreview: string | null;
  setLicensePreview: (v: string | null) => void;
  onLicenseChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isInsured: boolean;
  setIsInsured: (v: boolean) => void;
  insuranceFile: File | null;
  setInsuranceFile: (v: File | null) => void;
  insurancePreview: string | null;
  setInsurancePreview: (v: string | null) => void;
  onInsuranceChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  portfolioFiles: File[];
  portfolioPreviews: { name: string; type: string; url: string }[];
  onPortfolioSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPortfolioRemove: (index: number) => void;
  referralCode: string;
  setReferralCode: (v: string) => void;
  inputCls: string;
  labelCls: string;
  onBack: () => void;
  onSkip: () => void;
  onSubmit: () => void | Promise<void>;
}

export function SignupStep3(props: SignupStep3Props) {
  const {
    loading,
    skills, setSkills, skillSearch, setSkillSearch,
    experienceLevel, setExperienceLevel,
    availability, setAvailability,
    jobRadius, setJobRadius,
    toolsEquipment, setToolsEquipment,
    emergencyContactName, setEmergencyContactName,
    emergencyContactPhone, setEmergencyContactPhone,
    extraComments, setExtraComments,
    hearAboutUs, setHearAboutUs,
    isLicensed, setIsLicensed,
    licenseFile, setLicenseFile, licensePreview, setLicensePreview, onLicenseChange,
    isInsured, setIsInsured,
    insuranceFile, setInsuranceFile, insurancePreview, setInsurancePreview, onInsuranceChange,
    portfolioFiles, portfolioPreviews, onPortfolioSelect, onPortfolioRemove,
    referralCode, setReferralCode,
    inputCls, labelCls,
    onBack, onSkip, onSubmit,
  } = props;

  const selectedSkills = skills.split(",").map((s) => s.trim()).filter(Boolean);
  const filteredSkills = ALL_SKILLS.filter((s) => s.toLowerCase().includes(skillSearch.toLowerCase()));
  const toggleSkill = (skill: string) => {
    const isActive = selectedSkills.some((s) => s.toLowerCase() === skill.toLowerCase());
    if (isActive) {
      setSkills(selectedSkills.filter((s) => s.toLowerCase() !== skill.toLowerCase()).join(", "));
    } else {
      setSkills([...selectedSkills, skill].join(", "));
    }
  };

  return (
    <div className="space-y-4">
      {/* Decision card — replaces the previous "Applying for jobs?"
          banner + separate tiny "Skip" row that competed for attention.
          One card now holds both paths: the encouragement (apply →
          fill below) and an equally-prominent Skip for posters. */}
      <div className="rounded-2xl border-2 border-primary bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-3 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
            <p className="text-ds-15 font-bold text-foreground leading-tight">
              Applying for jobs?
            </p>
          </div>
          <span className="text-ds-10 font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-primary text-primary-foreground shrink-0">
            Recommended
          </span>
        </div>
        <p className="text-ds-13 text-foreground/80 leading-relaxed">
          Complete profiles get <span className="font-semibold">3× more offers</span>. Takes about 2 minutes — fill in what applies below.
        </p>
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-primary/15">
          <p className="text-ds-11 text-muted-foreground leading-snug min-w-0">
            Just posting jobs? Nothing below is required.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3.5 text-ds-11 shrink-0 bg-card"
            disabled={loading}
            onClick={onSkip}
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Creating…</>
              : <>Skip <ArrowRight className="w-3.5 h-3.5 ml-1" /></>}
          </Button>
        </div>
      </div>

      {/* Skills */}
      <div className="space-y-2">
        <Label htmlFor="skill-search" className={labelCls}>
          Skills <span className="text-muted-foreground text-ds-11">(optional)</span>
        </Label>
        <Input
          id="skill-search"
          placeholder="Search skills…"
          value={skillSearch}
          onChange={(e) => setSkillSearch(e.target.value)}
          className={inputCls}
        />
        {selectedSkills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {selectedSkills.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSkill(s)}
                className="px-2.5 py-1 rounded-full text-ds-11 font-medium border bg-primary text-primary-foreground border-primary inline-flex items-center gap-1"
              >
                {s} <X className="w-3 h-3" />
              </button>
            ))}
          </div>
        )}
        <div className="max-h-32 overflow-y-auto rounded-ds-md border border-border bg-muted/20 p-2">
          <div className="flex flex-wrap gap-1.5">
            {filteredSkills.length === 0 ? (
              <p className="text-ds-11 text-muted-foreground px-1 py-1">No matches. Type your own below.</p>
            ) : (
              filteredSkills.map((skill) => {
                const isActive = selectedSkills.some((s) => s.toLowerCase() === skill.toLowerCase());
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {isActive ? "✓ " : "+ "}{skill}
                  </button>
                );
              })
            )}
          </div>
        </div>
        {skillSearch.trim() && !ALL_SKILLS.some((s) => s.toLowerCase() === skillSearch.trim().toLowerCase()) && (
          <button
            type="button"
            onClick={() => { toggleSkill(skillSearch.trim()); setSkillSearch(""); }}
            className="text-ds-11 text-primary font-medium hover:underline"
          >
            + Add "{skillSearch.trim()}" as a custom skill
          </button>
        )}
      </div>

      {/* Experience level */}
      <div className="space-y-2">
        <Label>Experience level <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {EXPERIENCE_LEVELS.map((opt) => {
            const isActive = experienceLevel === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setExperienceLevel(isActive ? "" : opt)}
                className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {isActive ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Availability */}
      <div className="space-y-2">
        <Label>Availability <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {AVAILABILITY_SLOTS.map((slot) => {
            const isActive = availability.includes(slot);
            return (
              <button
                key={slot}
                type="button"
                onClick={() => {
                  setAvailability(isActive ? availability.filter((a) => a !== slot) : [...availability, slot]);
                }}
                className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {isActive ? "✓ " : "+ "}{slot}
              </button>
            );
          })}
        </div>
      </div>

      {/* Preferred job radius */}
      <div className="space-y-2">
        <Label>Preferred job radius <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {JOB_RADIUS_OPTIONS.map((opt) => {
            const isActive = jobRadius === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setJobRadius(isActive ? "" : opt)}
                className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {isActive ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tools / Equipment */}
      <div className="space-y-2">
        <Label htmlFor="toolsEquipment">Tools / Equipment you have <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <Input
          id="toolsEquipment"
          placeholder="e.g. Lawn mower, power tools, pressure washer"
          value={toolsEquipment.join(", ")}
          onChange={(e) => setToolsEquipment(e.target.value ? e.target.value.split(",").map((s) => s.trimStart()) : [])}
        />
        <div className="flex flex-wrap gap-1.5">
          {TOOL_PRESETS.map((tool) => {
            const isActive = toolsEquipment.includes(tool);
            return (
              <button
                key={tool}
                type="button"
                onClick={() => setToolsEquipment(isActive ? toolsEquipment.filter((t) => t !== tool) : [...toolsEquipment, tool])}
                className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {isActive ? "✓ " : "+ "}{tool}
              </button>
            );
          })}
        </div>
        <p className="text-ds-11 text-muted-foreground">Type your own or tap common options above.</p>
      </div>

      {/* Emergency contact */}
      <div className="space-y-3 rounded-ds-sm border border-border bg-muted/30 p-3">
        <p className="text-ds-11 font-medium text-foreground">Emergency Contact <span className="text-muted-foreground">(optional but recommended)</span></p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input aria-label="Emergency contact name" placeholder="Contact name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} autoComplete="name" />
          <Input type="tel" aria-label="Emergency contact phone number" placeholder="Contact phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} autoComplete="tel" />
        </div>
      </div>

      {/* Extra comments */}
      <div className="space-y-2">
        <Label htmlFor="extraComments">Anything else you'd like us to know? <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <Textarea
          id="extraComments"
          placeholder="Special certifications, languages spoken, why you want to join, or anything else…"
          value={extraComments}
          onChange={(e) => setExtraComments(e.target.value)}
          rows={3}
        />
      </div>

      {/* How did you hear about us */}
      <div className="space-y-2">
        <Label htmlFor="hear">How did you hear about us? <span className="text-muted-foreground text-ds-11">(optional)</span></Label>
        <div className="flex flex-wrap gap-1.5">
          {HEAR_ABOUT_OPTIONS.map((opt) => {
            const isActive = hearAboutUs === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => setHearAboutUs(isActive ? "" : opt)}
                className={`px-2.5 py-1 rounded-full text-ds-11 font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-secondary/50 text-muted-foreground border-border hover:border-primary/50"
                }`}
              >
                {isActive ? "✓ " : ""}{opt}
              </button>
            );
          })}
        </div>
      </div>

      {/* Professional Credentials */}
      <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/5 to-card p-5 space-y-4">
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Award className="w-6 h-6 text-primary" strokeWidth={1.75} />
          </div>
          <h3 className="text-ds-15 font-display font-semibold text-foreground">Professional credentials</h3>
          <p className="text-ds-11 text-muted-foreground leading-relaxed">
            Optional — earn a verified badge that helps you get picked first. You can also add these later in Profile → Credentials.
          </p>
        </div>

        {/* Licensed toggle */}
        <div className="rounded-ds-md liquid-glass p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="is-licensed" className="text-ds-13 font-semibold text-foreground flex items-center gap-1.5">
                <BadgeCheck className="w-4 h-4 text-primary" /> I am licensed
              </Label>
              <p className="text-ds-11 text-muted-foreground">Trade, contractor, or professional license.</p>
            </div>
            <Switch
              id="is-licensed"
              checked={isLicensed}
              onCheckedChange={(v) => {
                setIsLicensed(v);
                if (!v) { setLicenseFile(null); setLicensePreview(null); }
              }}
            />
          </div>
          {isLicensed && (
            licenseFile ? (
              <div className="flex items-center justify-between gap-3 rounded-ds-sm border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {licensePreview && licensePreview.startsWith("blob:") ? (
                    <img loading="lazy" decoding="async" src={licensePreview} alt="License preview" className="w-12 h-12 rounded-md object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-md border border-border flex items-center justify-center bg-muted/40 shrink-0">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-ds-13 font-medium text-foreground truncate">{licenseFile.name}</p>
                    <p className="text-ds-11 text-muted-foreground">{(licenseFile.size / 1024).toFixed(0)} KB · pending review</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setLicenseFile(null); setLicensePreview(null); }}
                  className="text-ds-11 text-destructive hover:underline shrink-0 font-medium"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1.5 rounded-ds-sm border-2 border-dashed border-primary/40 bg-primary/[0.03] hover:border-primary/70 px-4 py-5 cursor-pointer transition-all">
                <ImagePlus className="w-5 h-5 text-primary" strokeWidth={1.75} />
                <span className="text-ds-13 font-semibold text-foreground">Upload license <span className="text-destructive">*</span></span>
                <span className="text-ds-11 text-muted-foreground">JPG, PNG, or PDF · Max 5MB · Required to continue</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={onLicenseChange}
                />
              </label>
            )
          )}
        </div>

        {/* Insured toggle */}
        <div className="rounded-ds-md liquid-glass p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="is-insured" className="text-ds-13 font-semibold text-foreground flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-primary" /> I am insured
              </Label>
              <p className="text-ds-11 text-muted-foreground">General liability or professional insurance.</p>
            </div>
            <Switch
              id="is-insured"
              checked={isInsured}
              onCheckedChange={(v) => {
                setIsInsured(v);
                if (!v) { setInsuranceFile(null); setInsurancePreview(null); }
              }}
            />
          </div>
          {isInsured && (
            insuranceFile ? (
              <div className="flex items-center justify-between gap-3 rounded-ds-sm border border-border bg-muted/30 p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {insurancePreview && insurancePreview.startsWith("blob:") ? (
                    <img loading="lazy" decoding="async" src={insurancePreview} alt="Insurance preview" className="w-12 h-12 rounded-md object-cover border border-border shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-md border border-border flex items-center justify-center bg-muted/40 shrink-0">
                      <FileText className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-ds-13 font-medium text-foreground truncate">{insuranceFile.name}</p>
                    <p className="text-ds-11 text-muted-foreground">{(insuranceFile.size / 1024).toFixed(0)} KB · pending review</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setInsuranceFile(null); setInsurancePreview(null); }}
                  className="text-ds-11 text-destructive hover:underline shrink-0 font-medium"
                >
                  Remove
                </button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1.5 rounded-ds-sm border-2 border-dashed border-primary/40 bg-primary/[0.03] hover:border-primary/70 px-4 py-5 cursor-pointer transition-all">
                <ImagePlus className="w-5 h-5 text-primary" strokeWidth={1.75} />
                <span className="text-ds-13 font-semibold text-foreground">Upload insurance <span className="text-destructive">*</span></span>
                <span className="text-ds-11 text-muted-foreground">JPG, PNG, or PDF · Max 5MB · Required to continue</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  onChange={onInsuranceChange}
                />
              </label>
            )
          )}
        </div>

        <p className="text-ds-11 text-muted-foreground text-center">
          Documents are reviewed by our team. Your verified badge appears once approved.
        </p>
      </div>

      {/* Portfolio */}
      <div className="rounded-ds-md liquid-glass p-5 space-y-4">
        <div className="text-center space-y-2">
          <FileText className="w-10 h-10 text-primary mx-auto" />
          <h3 className="font-semibold text-foreground">Portfolio (optional)</h3>
          <p className="text-ds-11 text-muted-foreground">
            A few photos of past work — finished lawns, clean driveways, repairs — help posters trust you instantly.
          </p>
          <p className="text-ds-11 text-primary font-medium mt-1">💎 Portfolio Showcase is a Pro+ subscriber perk — you can upload now, but only Pro/Elite subscribers' portfolios will be visible on their profiles.</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {portfolioPreviews.map((preview, i) => (
            <div key={i} className="relative group">
              {preview.type.startsWith("image/") && preview.url.startsWith("blob:") ? (
                <div className="w-20 h-20 rounded-ds-sm overflow-hidden border border-border">
                  <img loading="lazy" decoding="async" src={preview.url} alt="" className="w-full h-full object-cover" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-ds-sm border border-border flex flex-col items-center justify-center bg-secondary/30 px-1">
                  <FileText className="w-5 h-5 text-muted-foreground" />
                  <p className="text-[9px] text-muted-foreground text-center mt-1 truncate w-full">{preview.name}</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => onPortfolioRemove(i)}
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {portfolioFiles.length < 10 && (
            <label className="w-20 h-20 rounded-ds-sm border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
              <ImagePlus className="w-5 h-5 text-muted-foreground" />
              <span className="text-ds-10 text-muted-foreground mt-0.5">Add</span>
              <input
                type="file"
                accept="image/*,.pdf,.doc,.docx"
                multiple
                className="hidden"
                onChange={onPortfolioSelect}
              />
            </label>
          )}
        </div>
        <p className="text-ds-11 text-muted-foreground">
          Up to 10 files · Images, PDFs, or documents
        </p>
      </div>

      {/* Referral code */}
      <div className="space-y-2">
        <Label htmlFor="referral" className={`${labelCls} flex items-center gap-1.5`}>
          <Gift className="w-4 h-4 text-primary" /> Referral code <span className="text-muted-foreground text-ds-11">(optional)</span>
        </Label>
        <Input
          id="referral"
          placeholder="Enter referral code for $5 credit"
          value={referralCode}
          onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
          maxLength={10}
          className={`${inputCls} uppercase`}
        />
        {referralCode && (
          <p className="text-ds-11 text-primary flex items-center gap-1">
            <Gift className="w-3 h-3" /> You'll earn $5 when you complete your first job — as poster or crew!
          </p>
        )}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1 rounded-ds-md" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <Button
          variant="bark"
          className="flex-1 rounded-ds-md"
          onClick={() => {
            if (isLicensed && !licenseFile) { toast.error("Please upload your license or turn off the Licensed toggle"); return; }
            if (isInsured && !insuranceFile) { toast.error("Please upload your insurance document or turn off the Insured toggle"); return; }
            onSubmit();
          }}
          disabled={loading || (isLicensed && !licenseFile) || (isInsured && !insuranceFile)}
        >
          {loading
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating account…</>
            : <>Create account <ArrowRight className="w-4 h-4 ml-1" /></>}
        </Button>
      </div>

      {/* Secondary skip button — mirrors the top callout but reachable
          without scrolling back up. Users who've scrolled to the bottom
          of a long form shouldn't have to hunt for the skip option. */}
      <button
        type="button"
        onClick={onSkip}
        disabled={loading}
        className="w-full text-center text-ds-11 font-sans tracking-wide text-muted-foreground hover:text-foreground active:opacity-70 transition-opacity disabled:opacity-50 py-2"
      >
        {loading ? "Creating account…" : "Skip for now — I can fill this in later"}
      </button>
    </div>
  );
}
