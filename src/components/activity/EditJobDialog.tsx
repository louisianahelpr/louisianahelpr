import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { categories, type Job } from "./activityConstants";

interface EditJobDialogProps {
  job: Job | null;
  onClose: () => void;
  onSaved: () => void;
}

export function EditJobDialog({ job, onClose, onSaved }: EditJobDialogProps) {
  const [title, setTitle] = useState(job?.title || "");
  const [description, setDescription] = useState(job?.description || "");
  const [category, setCategory] = useState<string>(job?.category || "other");
  const [location, setLocation] = useState(job?.location || "");
  const [dateNeeded, setDateNeeded] = useState(job?.date_needed || "");
  const [startTime, setStartTime] = useState(job?.start_time || "");
  const [estimatedHours, setEstimatedHours] = useState(job?.estimated_hours?.toString() || "");
  const [budget, setBudget] = useState(job?.budget.toString() || "");
  const [specialReq, setSpecialReq] = useState(job?.special_requirements || "");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const save = async () => {
    if (!job) return;
    setSaving(true);
    const isPaid = job.payment_status === "escrow" || job.payment_status === "released";
    const updateData: any = {
      title: title.trim(), description: description.trim(), category: category as any,
      location: location.trim(), date_needed: dateNeeded, start_time: startTime || null,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      special_requirements: specialReq.trim() || null,
    };
    if (!isPaid) updateData.budget = parseFloat(budget);
    const { error } = await supabase.from("jobs").update(updateData).eq("id", job.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Job updated!"); onSaved(); onClose(); }
  };

  const handleSaveClick = () => setShowConfirm(true);

  if (!job) return null;

  const hasHelper = !!job.helper_id;
  const isPaid = job.payment_status === "escrow" || job.payment_status === "released";
  const locked = hasHelper || isPaid;

  return (
    <Dialog open={!!job} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Edit Job</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {locked && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
              {hasHelper ? "Fields are locked because a helpr has been accepted." : "Budget is locked after payment."}
            </p>
          )}
          <div className="space-y-2">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={hasHelper} />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={hasHelper} />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={hasHelper}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} disabled={hasHelper} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date needed</Label>
              <Input type="date" value={dateNeeded} onChange={(e) => setDateNeeded(e.target.value)} disabled={hasHelper} />
            </div>
            <div className="space-y-2">
              <Label>Start time</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={hasHelper} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Est. hours</Label>
              <Input type="number" step="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} disabled={hasHelper} />
            </div>
            <div className="space-y-2">
              <Label>Budget ($)</Label>
              <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={locked} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Special requirements</Label>
            <Textarea value={specialReq} onChange={(e) => setSpecialReq(e.target.value)} rows={2} disabled={hasHelper} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || hasHelper}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
