import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ImagePlus,
  X,
  Briefcase,
  Check,
  Plus,
  Search,
  Sparkles,
  Mic,
  GripVertical,
} from "lucide-react";
import { Reorder } from "framer-motion";
import { categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { SectionCard } from "@/components/postjob/SectionCard";
import { categoryFromTitle } from "@/lib/categoryFromTitle";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";

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

// Per-category search aliases — common synonyms a poster might type
// into the filter input. The category label itself is always matched
// implicitly so this only carries the *additional* terms.
const categorySearchAliases: Record<string, string[]> = {
  cleaning: ["clean", "tidy", "housekeep", "maid", "vacuum", "mop", "dust"],
  yard_work: ["yard", "lawn", "mow", "mowing", "garden", "landscape", "trim", "edge", "leaves", "rake"],
  moving: ["move", "movers", "haul", "load", "lift", "furniture"],
  errands: ["errand", "grocery", "shopping", "pickup", "pharmacy", "store"],
  handyman: ["handy", "repair", "fix", "mount", "drill", "install"],
  painting: ["paint", "wall", "color", "interior", "exterior", "roller"],
  delivery: ["deliver", "drop off", "transport", "courier"],
  pet_care: ["pet", "dog", "cat", "walk", "sit", "feed", "boarding"],
  assembly: ["assemble", "ikea", "furniture", "build", "put together"],
  other: ["misc", "other", "miscellaneous", "general"],
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
  /** Per-image upload progress (0-1), keyed by the photo's index. */
  uploadProgressByIndex?: Record<number, number>;
  /** Persist a drag-reordered photo list. Indices map to imageFiles. */
  onReorderImages?: (nextOrder: number[]) => void;
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
  uploadProgressByIndex,
  onReorderImages,
  detailsComplete,
}: DetailsSectionProps) {
  // Smart category detection — when the poster pauses typing the title
  // for ~800ms we check a keyword→category map. The match becomes the
  // new category and a tiny pill appears so the user can revert in one
  // tap if the guess is wrong. We never overwrite a category the user
  // picked manually after the auto-pick, so once they tap a chip the
  // smart pick is locked out for the rest of the session.
  const autoCategoryArmedRef = useRef(true);
  const lastAutoPickedRef = useRef<string | null>(null);
  const [autoCategoryHint, setAutoCategoryHint] = useState<string | null>(null);

  useEffect(() => {
    if (!autoCategoryArmedRef.current) return;
    const trimmed = title.trim();
    if (trimmed.length < 4) {
      if (autoCategoryHint) setAutoCategoryHint(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const guess = categoryFromTitle(trimmed);
      if (!guess) return;
      // Don't fight the user: skip when they've already chosen something
      // other than the default and that pick wasn't the previous auto-pick.
      if (
        category !== "other" &&
        category !== guess &&
        category !== lastAutoPickedRef.current
      ) {
        return;
      }
      if (guess === category) return;
      lastAutoPickedRef.current = guess;
      setCategory(guess);
      setAutoCategoryHint(guess);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [title, category, setCategory, autoCategoryHint]);

  // Voice dictation for the title field — taps the mic, speaks once,
  // we append the transcript to whatever was already typed. Hides when
  // the browser doesn't support the Speech API.
  const dictation = useVoiceDictation();
  const startTitleDictation = () => {
    dictation.start((text) => {
      setTitle(title ? `${title.trim()} ${text}`.trim() : text);
    });
  };

  // Filter input for the category grid — speeds selection once the
  // category list outgrows what fits comfortably in a single screen
  // height. Matches against the label AND a small alias list so typing
  // "lawn" hits Yard Work, "ikea" hits Assembly, etc.
  const [categoryQuery, setCategoryQuery] = useState("");
  const visibleCategories = useMemo(() => {
    const q = categoryQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => {
      if (c.label.toLowerCase().includes(q)) return true;
      const aliases = categorySearchAliases[c.value] ?? [];
      return aliases.some((a) => a.toLowerCase().includes(q));
    });
  }, [categoryQuery]);

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
        <div className="flex items-center justify-between gap-2">
          <Label>Category <span className="text-destructive">*</span></Label>
          {autoCategoryHint && category === autoCategoryHint && (
            <button
              type="button"
              onClick={() => {
                // Acknowledge / dismiss — clears the pill. The category
                // stays where the smart-pick landed.
                autoCategoryArmedRef.current = false;
                setAutoCategoryHint(null);
              }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-sans font-semibold active:scale-95 transition-transform"
              style={{
                background: "hsl(var(--burnt-sienna) / 0.12)",
                color: "hsl(var(--burnt-sienna))",
                border: "0.5px solid hsl(var(--burnt-sienna) / 0.28)",
              }}
              aria-label="Auto-selected from title — tap to dismiss"
            >
              <Sparkles className="w-3 h-3" aria-hidden />
              Auto-selected from title — tap to change
            </button>
          )}
        </div>
        {/* Filterable picker — search input above the grid. Matches the
            category label OR a small alias list ("lawn" → Yard Work,
            "ikea" → Assembly) so posters who don't see their exact
            category at a glance can still jump to it in one tap. The
            input is search-styled (role inferred from type="search")
            so iOS shows the rounded magnifier-decorated keyboard. */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
            style={{ color: "hsl(var(--olivewood) / 0.55)" }}
            aria-hidden
          />
          <Input
            type="search"
            value={categoryQuery}
            onChange={(e) => setCategoryQuery(e.target.value)}
            placeholder="Search categories"
            aria-label="Search categories"
            autoCorrect="off"
            autoCapitalize="none"
            className="pl-9 text-[14px]"
          />
          {categoryQuery && (
            <button
              type="button"
              onClick={() => setCategoryQuery("")}
              aria-label="Clear category search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            >
              <X
                className="w-3.5 h-3.5"
                style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                strokeWidth={2.5}
              />
            </button>
          )}
        </div>
        {/* Compact horizontal chips — icon + label on one row, two
            columns. Cuts the category block from ~4 stacked rows of
            tall cards (~400px) to ~5 short rows (~240px) so the form
            doesn't bury the Photos + later sections under one picker.
            Active chip keeps the brand-color ring + adds a check so
            the selection reads instantly. */}
        <div id="category-picker" className="grid grid-cols-2 gap-2">
          {visibleCategories.length === 0 && (
            <div
              className="col-span-2 px-3 py-3 rounded-xl text-center text-[0.78rem] font-serif italic"
              style={{
                color: "hsl(var(--olivewood) / 0.75)",
                background: "hsl(var(--parchment) / 0.45)",
                border: "0.5px dashed hsl(var(--olivewood) / 0.25)",
              }}
            >
              No matches — try a broader term, or pick &ldquo;Other&rdquo;.
            </div>
          )}
          {visibleCategories.map((c) => {
            const colors = categoryColors[c.value];
            const active = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => {
                  // Manual pick — disarm the smart-detect so a later
                  // title edit doesn't quietly clobber the chosen
                  // category, and clear any pending pill.
                  autoCategoryArmedRef.current = false;
                  setAutoCategoryHint(null);
                  setCategory(c.value);
                }}
                aria-pressed={active}
                aria-label={c.label}
                className="flex items-center gap-2.5 p-2 rounded-xl transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                style={
                  active
                    ? {
                        background: "hsl(var(--parchment) / 0.7)",
                        border: "0.5px solid hsl(var(--bark) / 0.35)",
                        boxShadow:
                          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                          "0 0 0 2px hsl(var(--bark) / 0.18), " +
                          "0 6px 16px -4px hsl(var(--bark) / 0.22)",
                      }
                    : {
                        // Inactive chip surface was nearly invisible on the
                        // parchment page — bumped fill opacity AND raised
                        // the olivewood border so unselected categories
                        // read as a real, tappable choice instead of a ghost.
                        background: "hsl(var(--parchment) / 0.7)",
                        border: "0.5px solid hsl(var(--olivewood) / 0.22)",
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
                  <CategoryIcon
                    category={c.value}
                    aria-hidden
                    className="w-3.5 h-3.5 text-white/90"
                    strokeWidth={2.25}
                  />
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
        <div className="relative">
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholders[category] ?? titlePlaceholders.other}
            required
            maxLength={TITLE_MAX}
            autoCapitalize="sentences"
            enterKeyHint="next"
            // Reserve space for the mic + check icons together so they
            // never overlap each other or the text.
            className={
              dictation.supported
                ? title.trim().length > 0 ? "pr-20" : "pr-12"
                : title.trim().length > 0 ? "pr-10" : ""
            }
          />
          {dictation.supported && (
            <button
              type="button"
              onClick={
                dictation.listening
                  ? dictation.stop
                  : startTitleDictation
              }
              aria-label={dictation.listening ? "Stop dictation" : "Dictate task title"}
              aria-pressed={dictation.listening}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={
                dictation.listening
                  ? {
                      background: "hsl(var(--burnt-sienna))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                    }
                  : {
                      background: "hsl(var(--parchment) / 0.7)",
                      color: "hsl(var(--bark))",
                      border: "0.5px solid hsl(var(--olivewood) / 0.22)",
                    }
              }
            >
              <Mic
                className={`w-4 h-4 ${dictation.listening ? "animate-pulse" : ""}`}
                strokeWidth={2}
              />
            </button>
          )}
          {title.trim().length > 0 && !dictation.supported && (
            <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
          )}
          {title.trim().length > 0 && dictation.supported && (
            <Check className="absolute right-12 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
          )}
        </div>
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
          autoCapitalize="sentences"
        />
        {/* Category-aware prompt — tells the poster exactly what a helpr
            needs to quote accurately. Vague posts get fewer applicants. */}
        <p className="text-[0.7rem] font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          {descriptionHints[category] ?? descriptionHints.other}
        </p>
      </div>

      {/* Image Upload — brand-aligned thumbnail grid. Active photo tiles
          get a sienna delete pill (always visible on touch, since there
          is no hover state on mobile). The empty Add tile uses a
          parchment "+" badge with a soft inset shadow so it reads as
          tappable affordance, not chrome. Photos are now required
          (issue #114): label + inline error reflect that. */}
      <div className="space-y-2.5">
        <div className="space-y-0.5">
          <div className="flex items-center justify-between gap-2">
            <Label>
              Photos <span className="text-destructive">*</span>{" "}
              <span className="font-normal text-muted-foreground">(at least 1, up to 5)</span>
            </Label>
            {imageFiles.length > 0 && (
              <span className="text-[0.66rem] tabular-nums text-muted-foreground">
                {imageFiles.length}/5 photos
              </span>
            )}
          </div>
          <p className="text-[0.7rem] font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Posts with a photo get noticeably more applicants.
          </p>
        </div>
        {/* Fixed-tile grid — 80px tiles wrap into rows. When the parent
            wired up `onReorderImages`, photos are draggable via
            framer-motion's Reorder; otherwise we fall back to the plain
            grid. The Add-tile is rendered outside Reorder so it doesn't
            get tangled in the drag state. */}
        {onReorderImages && imagePreviews.length > 1 ? (
          <>
            <Reorder.Group
              axis="x"
              values={imagePreviews.map((_, i) => i)}
              onReorder={(next) => onReorderImages(next as number[])}
              id="photo-grid"
              className="flex flex-wrap gap-2.5"
            >
              {imagePreviews.map((src, i) => {
                const progress = uploadProgressByIndex?.[i];
                const uploading = typeof progress === "number" && progress < 1;
                return (
                  <Reorder.Item
                    key={i}
                    value={i}
                    className="relative w-20 h-20 rounded-2xl overflow-hidden touch-none"
                    style={{
                      border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                      boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06), 0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
                    }}
                    whileDrag={{ scale: 1.05, zIndex: 5 }}
                  >
                    {/^blob:/i.test(src) ? (
                      <img loading="lazy" decoding="async" src={src} alt="" className="w-full h-full object-cover pointer-events-none" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--ivory-sand) / 0.6)" }}>
                        <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
                      </div>
                    )}
                    {/* Per-image upload progress — bottom-edge bar. */}
                    {uploading && (
                      <div
                        className="absolute inset-x-0 bottom-0 h-1.5"
                        style={{ background: "hsl(var(--olivewood) / 0.18)" }}
                        aria-hidden
                      >
                        <div
                          className="h-full transition-[width] duration-200"
                          style={{
                            width: `${Math.max(0, Math.min(1, progress ?? 0)) * 100}%`,
                            background: "hsl(var(--burnt-sienna))",
                          }}
                        />
                      </div>
                    )}
                    {/* Drag handle — tiny grip in the bottom-left so
                        the photo itself stays tappable. */}
                    <span
                      aria-hidden
                      className="absolute bottom-1 left-1 w-5 h-5 rounded-full flex items-center justify-center pointer-events-none"
                      style={{
                        background: "hsl(var(--ink-deep) / 0.55)",
                        color: "hsl(var(--parchment))",
                      }}
                    >
                      <GripVertical className="w-3 h-3" strokeWidth={2.5} />
                    </span>
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => onRemoveImage(i)}
                      aria-label="Remove photo"
                      className="absolute -top-1 -right-1 h-10 w-10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center"
                        style={{
                          background: "hsl(var(--burnt-sienna))",
                          color: "hsl(var(--parchment))",
                          boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                        }}
                      >
                        <X className="w-3 h-3" strokeWidth={2.5} />
                      </span>
                    </button>
                  </Reorder.Item>
                );
              })}
            </Reorder.Group>
            {imageFiles.length < 5 && (
              <label
                aria-label="Add another photo"
                className="mt-2.5 w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
                style={{
                  background: "hsl(var(--parchment) / 0.7)",
                  border: "0.5px solid hsl(var(--bark) / 0.28)",
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "inset 0 -1px 2px 0 hsl(var(--olivewood) / 0.08), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06)",
                }}
              >
                <Plus
                  className="w-7 h-7"
                  style={{ color: "hsl(var(--bark))" }}
                  strokeWidth={2}
                />
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={onImageSelect}
                />
              </label>
            )}
          </>
        ) : (
          <div
            id="photo-grid"
            className="grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, 80px)" }}
          >
            {imagePreviews.map((src, i) => {
              const progress = uploadProgressByIndex?.[i];
              const uploading = typeof progress === "number" && progress < 1;
              return (
                <div
                  key={i}
                  className="relative w-20 h-20 rounded-2xl overflow-hidden"
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
                  {uploading && (
                    <div
                      className="absolute inset-x-0 bottom-0 h-1.5"
                      style={{ background: "hsl(var(--olivewood) / 0.18)" }}
                      aria-hidden
                    >
                      <div
                        className="h-full transition-[width] duration-200"
                        style={{
                          width: `${Math.max(0, Math.min(1, progress ?? 0)) * 100}%`,
                          background: "hsl(var(--burnt-sienna))",
                        }}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemoveImage(i)}
                    aria-label="Remove photo"
                    className="absolute -top-1 -right-1 h-10 w-10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{
                        background: "hsl(var(--burnt-sienna))",
                        color: "hsl(var(--parchment))",
                        boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                      }}
                    >
                      <X className="w-3 h-3" strokeWidth={2.5} />
                    </span>
                  </button>
                </div>
              );
            })}
            {imageFiles.length < 5 && (
              <label
                aria-label={imageFiles.length === 0 ? "Add a photo (required)" : "Add another photo"}
                className="w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
                style={{
                  background: "hsl(var(--parchment) / 0.7)",
                  border: "0.5px solid hsl(var(--bark) / 0.28)",
                  // Soft inset highlight + a tiny outer drop combine to
                  // read as a tappable parchment chip instead of a flat
                  // dashed placeholder.
                  boxShadow:
                    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                    "inset 0 -1px 2px 0 hsl(var(--olivewood) / 0.08), " +
                    "0 1px 2px hsl(var(--olivewood) / 0.06)",
                }}
              >
                <Plus
                  className="w-7 h-7"
                  style={{ color: "hsl(var(--bark))" }}
                  strokeWidth={2}
                />
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
        )}
        {imageFiles.length === 0 && (
          <p className="text-[0.7rem] leading-snug text-destructive">
            Add at least one photo so helprs know what they're applying for.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
