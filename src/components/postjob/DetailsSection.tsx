import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePlus, X, Briefcase, CheckCircle2, Check } from "lucide-react";
import { categoryIcons, categoryColors } from "@/components/activity/activityConstants";

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

interface DetailsSectionProps {
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
    <section className="rounded-2xl liquid-glass p-5 space-y-5 shadow-sm">
      {/* Brand-aligned section header — eyebrow + font-display italic title. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Briefcase className="w-4 h-4 text-primary" />
          </div>
          <div className="leading-none min-w-0">
            <p className="font-serif italic uppercase text-ds-9" style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}>
              About the task
            </p>
            <h2 className="font-display italic font-bold mt-1" style={{ fontSize: "1.05rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}>
              Details
            </h2>
          </div>
        </div>
        {detailsComplete && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
      </div>

      <div className="space-y-2.5">
        <Label htmlFor="title">Task title <span className="text-destructive">*</span></Label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Help me move a couch" required maxLength={100} />
      </div>

      <div className="space-y-2.5">
        <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
        <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide details about the task…" required rows={4} maxLength={1000} />
      </div>

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

      {/* Image Upload — brand-aligned thumbnail grid. Active photo tiles
          get a sienna-tint hover for delete; the empty Add tile uses the
          parchment-glass dashed border treatment instead of generic gray. */}
      <div className="space-y-2.5">
        <Label>Photos (optional, max 5)</Label>
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
              {(/^blob:/i.test(src) || /^data:image\//i.test(src)) ? (
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
    </section>
  );
}
