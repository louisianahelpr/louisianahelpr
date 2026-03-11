import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

const categories = [
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

const PostJob = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [location, setLocation] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [budget, setBudget] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");

  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate("/login");
    });
  }, [navigate]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (imageFiles.length + files.length > 5) {
      toast.error("Maximum 5 images allowed");
      return;
    }
    const newFiles = [...imageFiles, ...files].slice(0, 5);
    setImageFiles(newFiles);
    // Generate previews
    const previews = newFiles.map((f) => URL.createObjectURL(f));
    setImagePreviews(previews);
  };

  const removeImage = (index: number) => {
    const newFiles = imageFiles.filter((_, i) => i !== index);
    setImageFiles(newFiles);
    setImagePreviews(newFiles.map((f) => URL.createObjectURL(f)));
  };

  const uploadImages = async (jobId: string): Promise<string[]> => {
    const urls: string[] = [];
    for (const file of imageFiles) {
      const ext = file.name.split(".").pop();
      const path = `${jobId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("job-photos").upload(path, file);
      if (error) {
        console.error("Upload error:", error);
        continue;
      }
      const { data: urlData } = supabase.storage.from("job-photos").getPublicUrl(path);
      urls.push(urlData.publicUrl);
    }
    return urls;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be logged in");
      setSaving(false);
      return;
    }

    // Upload images first if any
    let photoUrls: string[] = [];

    const { data: jobData, error } = await supabase.from("jobs").insert({
      customer_id: user.id,
      title: title.trim(),
      description: description.trim(),
      category: category as any,
      location: location.trim(),
      date_needed: dateNeeded,
      start_time: startTime || null,
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      budget: parseFloat(budget),
      special_requirements: specialRequirements.trim() || null,
    }).select("id").single();

    if (error || !jobData) {
      toast.error(error?.message || "Failed to create job");
      setSaving(false);
      return;
    }

    // Upload images after job creation
    if (imageFiles.length > 0) {
      setUploading(true);
      photoUrls = await uploadImages(jobData.id);
      if (photoUrls.length > 0) {
        await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobData.id);
      }
      setUploading(false);
    }

    // Trigger escrow payment
    toast.info("Redirecting to payment…");
    const { data: paymentData, error: paymentError } = await supabase.functions.invoke("create-payment", {
      body: { action: "escrow", jobId: jobData.id },
    });

    setSaving(false);
    if (paymentError || !paymentData?.url) {
      toast.error("Job created but payment failed. You can pay from your dashboard.");
      navigate("/dashboard");
    } else {
      window.open(paymentData.url, "_blank");
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Post a task</h1>
            <p className="text-muted-foreground mt-1">Describe what you need help with</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="title">Task title</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Help me move a couch" required maxLength={100} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Provide details about the task…" required rows={4} maxLength={1000} />
            </div>

            {/* Image Upload */}
            <div className="space-y-2">
              <Label>Photos (optional, max 5)</Label>
              <div className="flex flex-wrap gap-3">
                {imagePreviews.map((src, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border group">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
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
                      onChange={handleImageSelect}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address or area" required maxLength={200} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="date">Date needed</Label>
                <Input id="date" type="date" value={dateNeeded} onChange={(e) => setDateNeeded(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="time">Start time</Label>
                <Input id="time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="hours">Estimated hours</Label>
                <Input id="hours" type="number" step="0.5" min="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="2" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Budget ($)</Label>
                <Input id="budget" type="number" step="1" min="5" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="50" required />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="requirements">Special requirements (optional)</Label>
              <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Any tools needed, access instructions, etc." rows={2} maxLength={500} />
            </div>

            <Button type="submit" className="w-full" size="lg" disabled={saving || uploading}>
              {uploading ? "Uploading photos…" : saving ? "Posting…" : "Post task"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default PostJob;
