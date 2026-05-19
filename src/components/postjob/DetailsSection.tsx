import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, X, Briefcase, Check } from "lucide-react";
import { categoryIcons, categoryColors } from "@/components/activity/activityConstants";
import { SectionCard } from "@/components/postjob/SectionCard";

export const categories = [
  { value: "cleaning", label: "Cleaning" },
  { value: "yard_work", label: "Yard Work" },
  { value: "moving", label: "Moving" },
  { value: "errands", label: "Errands" },
  { value: "handyman", label: "Handyman" },
  { value: "painting", label: "Painting" },
  { value: "delivery", label: "Delivery" },
  { value: "pet_care", label: "Pet Care" },
  { value: "assembly", label: "Assembly" },
  { value: "other", label: "Other" },
];

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 1000;

// Category-specific title placeholders — once the poster picks a
// category the example title matches what they're actually posting,
// which both speeds entry and models a good, specific title.
const titlePlaceholders: Record<string, string> = {
  cleaning: "e.g. Deep clean a 2-bedroom apartment",
  yard_work: "e.g. Mow & edge the front and back yard",
  moving: "e.g. Help me move a couch up two flights",
  errands: "e.g. Grocery run and a pharmacy pickup",
  handyman: "e.g. Mount a TV and hide the cables",
  painting: "e.g. Paint a 12×12 bedroom, one coat",
  delivery: "e.g. Pick up a dresser and drop it off",
  pet_care: "e.g. Walk my dog twice a day this week",
  assembly: "e.g. Assemble an IKEA wardrobe",
  other: "e.g. Help me with a quick task",
};

// Category-specific description prompts — tells the poster what detail
// a helpr needs to quote accurately. Vague posts get fewer applicants.
const descriptionHints: Record<string, string> = {
  cleaning: "Mention square footage, number of rooms, supplies on hand, and parking or access.",
  yard_work: "Mention yard size, what needs doing, and whether tools and bags are provided.",
  moving: "Mention what's being moved, stairs or elevator, distance, and any heavy items.",
  errands: "List the stops, anything time-sensitive, and how purchases get paid for.",
  handyman: "Describe the fix, what parts/tools you already have, and any specific skill needed.",
  painting: "Mention the area, surface condition, whether paint is provided, and number of coats.",
  delivery: "Mention pickup and drop-off addresses, item size, and whether a truck is needed.",
  pet_care: "Mention pet type and temperament, the schedule, and any feeding or medication.",
  assembly: "Mention the item(s), whether you have the manual, and what tools are available.",
  other: "Add anything a helpr needs to quote accurately — access, timing, and supplies.",
};

interface DetailsSectionProps {
  /** 1-based chapter number for the section header. */
  stepNumber: number;
  title: string;
  setTitle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  imagePreviews: string[];
  imageFiles: File[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (index: number) => void;
  detailsComplete: boolean;
}

export function DetailsSection({
  stepNumber,
  title,
  setTitle,
  description,
  setDescription,
  category,
  setCategory,
  imagePreviews,
  imageFiles,
  onImageSelect,
  onRemoveImage,
  detailsComplete,
}: DetailsSectionProps) {
  return (
    <SectionCard
      stepNumber={stepNumber}
      eyebrow="About the task"
      title="Details"
      icon={Briefcase}
      complete={detailsComplete}
    >
      {/* Category first — picking it up front lets the title placeholder
          and the description prompt below adapt to what's actually being
          posted, which models a good, specific post. */}
      <div className="space-y-2.5">
        <Label>Category <span className="text-destructive">*</span></Label>
        {/* Compact horizontal chips — icon + label on one row, two
            columns. Cuts the category block from ~4 stacked rows of
            tall cards (~400px) to ~5 short rows (~240px) so the form
            doesn't bury the Photos + later sections under one picker.
            Active chip keeps the brand-color ring + adds a check so
            the selection reads instantly. */}
        <div className="grid grid-cols-2 gap-2">
          {categories.map((c) => {
            const Icon = categoryIcons[c.value] ?? Briefcase;
            const colors = categoryColors[c.value];
            const active = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(c.value)}
                aria-pressed={active}
                className="flex items-center gap-2.5 p-2 rounded-xl transition-all active:scale-[0.97]"
                style={
                  active
                    ? {
                        background: "hsla(0, 0%, 100%, 0.7)",
                        border: "0.5px solid hsl(var(--bark) / 0.35)",
                        boxShadow:
                          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                          "0 0 0 2px hsl(var(--bark) / 0.18), " +
                          "0 6px 16px -4px hsl(var(--bark) / 0.22)",
                      }
                    : {
                        background: "hsla(0, 0%, 100%, 0.45)",
                        border: "0.5px solid hsl(var(--olivewood) / 0.12)",
                        boxShadow: "inset 0 1px 1px 0 rgba(255, 255, 255, 0.45)",
                      }
                }
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${colors?.dot ?? ""}`}
                  style={
                    !colors?.dot
                      ? { background: "hsl(var(--olivewood) / 0.12)" }
                      : undefined
                  }
                >
                  <Icon className="w-3.5 h-3.5 text-white/90" strokeWidth={2.25} />
                </span>
                <span
                  className="font-sans font-semibold leading-tight truncate"
                  style={{
                    fontSize: "0.78rem",
                    color: active ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.85)",
                  }}
                >
                  {c.label}
                </span>
                {active && (
                  <Check
                    className="w-3.5 h-3.5 ml-auto shrink-0"
                    style={{ color: "hsl(var(--bark))" }}
                    strokeWidth={3}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="title">Task title <span className="text-destructive">*</span></Label>
          <span className="text-[0.66rem] tabular-nums text-muted-foreground">{title.length}/{TITLE_MAX}</span>
        </div>
        <Input
          id="title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={titlePlaceholders[category] ?? titlePlaceholders.other}
          required
          maxLength={TITLE_MAX}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
          <span className="text-[0.66rem] tabular-nums text-muted-foreground">{description.length}/{DESCRIPTION_MAX}</span>
        </div>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Provide details about the task…"
          required
          rows={4}
          maxLength={DESCRIPTION_MAX}
        />
        {/* Category-aware prompt — tells the poster exactly what a helpr
            needs to quote accurately. Vague posts get fewer applicants. */}
        <p className="text-[0.7rem] font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          {descriptionHints[category] ?? descriptionHints.other}
        </p>
      </div>

      {/* Image Upload — brand-aligned thumbnail grid. Active photo tiles
          get a sienna-tint hover for delete; the empty Add tile uses the
          parchment-glass dashed border treatment instead of generic gray. */}
      <div className="space-y-2.5">
        <div className="space-y-0.5">
          <Label>Photos <span className="font-normal text-muted-foreground">(optional, max 5)</span></Label>
          <p className="text-[0.7rem] font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
            Posts with a photo get noticeably more applicants.
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {imagePreviews.map((src, i) => (
            <div
              key={i}
              className="relative w-20 h-20 rounded-2xl overflow-hidden group"
              style={{
                border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06), 0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
              }}
            >
              {/^blob:/i.test(src) ? (
                <img loading="lazy" decoding="async" src={src} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--ivory-sand) / 0.6)" }}>
                  <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                aria-label="Remove photo"
                className="absolute top-1 right-1 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 active:opacity-100 active:scale-90 transition-all"
                style={{
                  background: "hsl(var(--burnt-sienna))",
                  color: "hsl(var(--parchment))",
                  boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                }}
              >
                <X className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}
          {imageFiles.length < 5 && (
            <label
              className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
              style={{
                background: "hsla(0, 0%, 100%, 0.4)",
                border: "1.5px dashed hsl(var(--bark) / 0.30)",
              }}
            >
              <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
              <span
                className="font-sans font-semibold mt-1"
                style={{ fontSize: "0.62rem", color: "hsl(var(--bark))", letterSpacing: "0.04em" }}
              >
                Add photo
              </span>
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onImageSelect}
              />
            </label>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
