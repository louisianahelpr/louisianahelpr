import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImagePlus, X, Briefcase, CheckCircle2 } from "lucide-react";

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <Briefcase className="w-3.5 h-3.5 text-primary" />
          </div>
          <h2 className="font-display text-base font-semibold">Details</h2>
        </div>
        {detailsComplete && <CheckCircle2 className="w-4 h-4 text-primary" />}
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
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Image Upload */}
      <div className="space-y-2.5">
        <Label>Photos (optional, max 5)</Label>
        <div className="flex flex-wrap gap-3">
          {imagePreviews.map((src, i) => (
            <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
              {(/^blob:/i.test(src) || /^data:image\//i.test(src)) ? (
                <img loading="lazy" decoding="async" src={src} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-muted/40">
                  <ImagePlus className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
          {imageFiles.length < 5 && (
            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 flex flex-col items-center justify-center cursor-pointer transition-colors">
              <ImagePlus className="w-5 h-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground mt-0.5">Add</span>
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
