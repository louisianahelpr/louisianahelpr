import { Wrench } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/*
 * Moved out of LogisticsSection.tsx unchanged (Q2615, componentSizeRatchet).
 * "I'll provide materials" — only shows for the categories where
 * this is a meaningful poster signal (paint, repair, assembly,
 * yard, cleaning). When on, a freeform note appears so the
 * poster can list paint colors, parts numbers, supplies, etc.
 * Q1461: the note is stored on its own (jobs.materials_note) and
 * shown to everyone viewing the job; the Access & Parking notes
 * above go to job_access_notes, which only the booked Helpr sees.
 */
export function MaterialsToggle({ includeMaterials, setIncludeMaterials, materialsNote, setMaterialsNote }: {
  includeMaterials?: boolean;
  setIncludeMaterials: (v: boolean) => void;
  materialsNote?: string;
  setMaterialsNote?: (v: string) => void;
}) {
  return (
    <div
      className={`rounded-ds-md border p-4 space-y-3 ${
        includeMaterials ? "border-primary/30 bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="include-materials" className="flex items-center gap-2 cursor-pointer">
          <Wrench className="w-4 h-4 text-primary" />
          <span className="text-ds-13 font-semibold text-foreground">
            I'll provide materials
          </span>
        </label>
        <Switch
          id="include-materials"
          checked={!!includeMaterials}
          onCheckedChange={setIncludeMaterials}
        />
      </div>
      {includeMaterials && setMaterialsNote && (
        <div className="space-y-2">
          <Label htmlFor="materials-note" className="text-ds-11">
            Materials I'll provide
          </Label>
          <Textarea
            id="materials-note"
            value={materialsNote ?? ""}
            onChange={(e) => setMaterialsNote(e.target.value)}
            placeholder="e.g. 1 gallon of Sherwin-Williams 'Cotton White', rollers, drop cloth — everything is staged by the door."
            rows={2}
            maxLength={500}
            autoCapitalize="sentences"
          />
          <p className="text-ds-11 text-muted-foreground">
            Listed on the job so applicants know what they don't need to bring.
          </p>
        </div>
      )}
    </div>
  );
}
