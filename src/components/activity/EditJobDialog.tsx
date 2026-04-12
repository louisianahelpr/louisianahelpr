import { useState, useEffect } from "react";
import { TimePickerSelect } from "@/components/TimePickerSelect";
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [location, setLocation] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [budget, setBudget] = useState("");
  const [specialReq, setSpecialReq] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Reset all fields when job changes (prepopulate)
  useEffect(() => {
    if (job) {
      setTitle(job.title || "");
      setDescription(job.description || "");
      setCategory(job.category || "other");
      setLocation(job.location || "");
      setDateNeeded(job.date_needed || "");
      setStartTime(job.start_time || "");
      setEstimatedHours(job.estimated_hours?.toString() || "");
      setBudget(job.budget?.toString() || "");
      setSpecialReq(job.special_requirements || "");
    }
  }, [job]);

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
    <>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Date needed</Label>
              <Input type="date" value={dateNeeded} onChange={(e) => setDateNeeded(e.target.value)} disabled={hasHelper} />
            </div>
            <div className="space-y-2">
              <Label>Start time</Label>
              <TimePickerSelect value={startTime} onChange={setStartTime} disabled={hasHelper} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          <Button onClick={handleSaveClick} disabled={saving || hasHelper}>{saving ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
          <AlertDialogDescription>Are you sure you want to save these changes to your job?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={save}>Save Changes</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
