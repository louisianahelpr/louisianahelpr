import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft, ImagePlus, X, MapPin, Calendar, Clock, DollarSign,
  CreditCard, Shield, ChevronLeft, Briefcase, Repeat, Users, Sparkles, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useDraftJob } from "@/hooks/useDraftJob";
import { categoryPricing } from "@/lib/pricingGuide";

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

type Step = "form" | "checkout";

const PostJob = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { draft, hasDraft, saveDraft, clearDraft } = useDraftJob();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [location, setLocation] = useState("");
  const [dateNeeded, setDateNeeded] = useState("");
  const [startTime, setStartTime] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [budget, setBudget] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceInterval, setRecurrenceInterval] = useState("weekly");
  const [jobDuration, setJobDuration] = useState("none"); // none, 3days, 7days, 14days, 30days
  const [recurrenceEndDate, setRecurrenceEndDate] = useState("");
  const [isGroupJob, setIsGroupJob] = useState(false);
  const [helpersNeeded, setHelpersNeeded] = useState("2");
  const [platformFee, setPlatformFee] = useState(15);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // AI Job Builder
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  // Image upload state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate("/login");
    });
    supabase.from("platform_settings").select("platform_fee_percent").limit(1).single()
      .then(({ data }) => {
        if (data) setPlatformFee(data.platform_fee_percent);
      });
  }, [navigate]);

  // One-tap rebook: load from query params
  useEffect(() => {
    const rebookId = searchParams.get("rebook");
    if (rebookId) {
      supabase.from("jobs").select("*").eq("id", rebookId).single().then(({ data }) => {
        if (data) {
          setTitle(data.title);
          setDescription(data.description);
          setCategory(data.category);
          setLocation(data.location);
          setBudget(data.budget.toString());
          setEstimatedHours(data.estimated_hours?.toString() || "");
          setSpecialRequirements(data.special_requirements || "");
          setIsRecurring(data.is_recurring || false);
          setRecurrenceInterval(data.recurrence_interval || "weekly");
          setDraftLoaded(true);
          toast.info("Job details pre-filled from previous booking!");
        }
      });
      return;
    }

    // Load draft if no rebook
    if (hasDraft && !draftLoaded) {
      setTitle(draft.title); setDescription(draft.description);
      setCategory(draft.category); setLocation(draft.location);
      setDateNeeded(draft.dateNeeded); setStartTime(draft.startTime);
      setEstimatedHours(draft.estimatedHours); setBudget(draft.budget);
      setSpecialRequirements(draft.specialRequirements);
      setIsRecurring(draft.isRecurring); setRecurrenceInterval(draft.recurrenceInterval);
      setRecurrenceEndDate(draft.recurrenceEndDate);
      setDraftLoaded(true);
      toast.info("Draft restored! Your previous progress was saved.");
    }
  }, [searchParams, hasDraft, draftLoaded]);

  // Auto-save draft on field changes (debounced)
  const autoSave = useCallback(() => {
    if (title || description || location || budget) {
      saveDraft({ title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate });
    }
  }, [title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, saveDraft]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 2000);
    return () => clearTimeout(timer);
  }, [autoSave]);




  const handleAiBuild = async () => {
    if (!aiPrompt.trim()) { toast.error("Describe what you need help with"); return; }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-job-builder", {
        body: { messages: [{ role: "user", content: aiPrompt }], jobContext: { location } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTitle(data.title || "");
      setDescription(data.description || "");
      setCategory(data.category || "other");
      setEstimatedHours(data.estimated_hours?.toString() || "");
      setBudget(data.budget_max?.toString() || data.budget_min?.toString() || "");
      setSpecialRequirements(data.special_requirements || "");
      if (data.is_group_job) {
        setIsGroupJob(true);
        setHelpersNeeded(data.helpers_needed?.toString() || "2");
      }
      setAiOpen(false);
      toast.success("Job details generated! Review and edit as needed.");
    } catch (err: any) {
      toast.error(err.message || "AI generation failed");
    } finally {
      setAiLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (imageFiles.length + files.length > 5) {
      toast.error("Maximum 5 images allowed");
      return;
    }
    const newFiles = [...imageFiles, ...files].slice(0, 5);
    setImageFiles(newFiles);
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

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (parseFloat(budget) < 5) {
      toast.error("Minimum budget is $5");
      return;
    }
    setStep("checkout");
  };

  const handleSubmit = async () => {
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("You must be logged in");
      setSaving(false);
      return;
    }

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
      is_recurring: isRecurring,
      recurrence_interval: isRecurring ? recurrenceInterval : null,
      recurrence_end_date: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
      is_group_job: isGroupJob,
      helpers_needed: isGroupJob ? parseInt(helpersNeeded) || 2 : 1,
    } as any).select("id").single();

    if (error || !jobData) {
      toast.error(error?.message || "Failed to create job");
      setSaving(false);
      return;
    }

    if (imageFiles.length > 0) {
      setUploading(true);
      photoUrls = await uploadImages(jobData.id);
      if (photoUrls.length > 0) {
        await supabase.from("jobs").update({ photos: photoUrls }).eq("id", jobData.id);
      }
      setUploading(false);
    }

    toast.info("Redirecting to payment…");
    clearDraft();

    // Trigger instant job matching in background
    supabase.functions.invoke("instant-job-match", { body: { jobId: jobData.id } }).catch(() => {});

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

  const budgetNum = parseFloat(budget) || 0;
  const feeAmount = budgetNum * (platformFee / 100);
  const helperEarns = budgetNum - feeAmount;
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => step === "checkout" ? setStep("form") : navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-8">

          {/* STEP 1: FORM */}
          {step === "form" && (
            <>
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground">Post a task</h1>
                <p className="text-muted-foreground mt-1">Describe what you need help with</p>
              </div>

              {/* AI Job Builder */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setAiOpen(!aiOpen)}
                  className="flex items-center gap-2 w-full text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">AI Job Builder</p>
                    <p className="text-xs text-muted-foreground">Describe your task in plain English and let AI fill in the details</p>
                  </div>
                </button>
                {aiOpen && (
                  <div className="space-y-3 pt-2 border-t border-primary/10">
                    <Textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g. I need help moving furniture from my apartment to a new house across town. It's a 2-bedroom apartment with heavy items like a couch and dresser."
                      rows={3}
                      className="text-sm"
                    />
                    <Button
                      type="button"
                      onClick={handleAiBuild}
                      disabled={aiLoading}
                      size="sm"
                      className="w-full"
                    >
                      {aiLoading ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                      ) : (
                        <><Sparkles className="w-4 h-4 mr-2" /> Generate Job Posting</>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              <form onSubmit={handleReview} className="space-y-5">
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
                    {category && categoryPricing[category] && (
                      <p className="text-xs text-muted-foreground">
                        💡 Suggested: <span className="font-medium text-primary">${categoryPricing[category].min}–${categoryPricing[category].max}</span> for {categoryPricing[category].label} jobs
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="requirements">Special requirements (optional)</Label>
                  <Textarea id="requirements" value={specialRequirements} onChange={(e) => setSpecialRequirements(e.target.value)} placeholder="Any tools needed, access instructions, etc." rows={2} maxLength={500} />
                </div>

                {/* Recurring Job */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Repeat className="w-4 h-4 text-primary" />
                      <Label htmlFor="recurring" className="cursor-pointer">Recurring task</Label>
                    </div>
                    <Switch id="recurring" checked={isRecurring} onCheckedChange={setIsRecurring} />
                  </div>
                  {isRecurring && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <div className="space-y-2">
                        <Label>Frequency</Label>
                        <Select value={recurrenceInterval} onValueChange={setRecurrenceInterval}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Until</Label>
                        <Input type="date" value={recurrenceEndDate} onChange={(e) => setRecurrenceEndDate(e.target.value)} min={dateNeeded} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Group Job */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary" />
                      <Label htmlFor="group" className="cursor-pointer">Group job (multiple helpers)</Label>
                    </div>
                    <Switch id="group" checked={isGroupJob} onCheckedChange={setIsGroupJob} />
                  </div>
                  {isGroupJob && (
                    <div className="space-y-2 pt-1">
                      <Label>How many helpers needed?</Label>
                      <Input
                        type="number"
                        min="2"
                        max="10"
                        value={helpersNeeded}
                        onChange={(e) => setHelpersNeeded(e.target.value)}
                        className="w-24"
                      />
                      <p className="text-xs text-muted-foreground">
                        Budget of ${budgetNum.toFixed(2)} will be split: ~${(budgetNum / (parseInt(helpersNeeded) || 2)).toFixed(2)}/helper
                      </p>
                    </div>
                  )}
                </div>

                {/* Job Listing Duration */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <Label>How long to keep this listing open?</Label>
                  </div>
                  <Select value={jobDuration} onValueChange={setJobDuration}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Until I choose an applicant (no expiry)</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {jobDuration === "none"
                      ? "Your job will stay open until you manually select a helper or close it."
                      : `Your job listing will automatically close after ${jobDuration} days if no helper is selected.`}
                  </p>
                </div>

                <Button type="submit" className="w-full" size="lg">
                  Review & Pay
                </Button>
              </form>
            </>
          )}

          {/* STEP 2: ORDER SUMMARY / CHECKOUT */}
          {step === "checkout" && (
            <>
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground">Order Summary</h1>
                <p className="text-muted-foreground mt-1">Review your task before paying</p>
              </div>

              {/* Task Details Card */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-display font-bold text-foreground">{title}</h2>
                      <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                        {categoryLabel}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setStep("form")} className="text-xs text-muted-foreground">
                      <ChevronLeft className="w-3 h-3 mr-1" /> Edit
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">{description}</p>

                  {/* Photos */}
                  {imagePreviews.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {imagePreviews.map((src, i) => (
                        <img key={i} src={src} alt="" className="w-16 h-12 rounded-lg object-cover border border-border" />
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="w-4 h-4 text-primary shrink-0" />
                      <span>{location}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Calendar className="w-4 h-4 text-primary shrink-0" />
                      <span>{new Date(dateNeeded + "T00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                    </div>
                    {startTime && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4 text-primary shrink-0" />
                        <span>{startTime}</span>
                      </div>
                    )}
                    {estimatedHours && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Briefcase className="w-4 h-4 text-primary shrink-0" />
                        <span>{estimatedHours}h estimated</span>
                      </div>
                    )}
                  </div>

                   {specialRequirements && (
                    <div className="rounded-lg bg-secondary/30 p-3 mt-2">
                      <p className="text-xs text-muted-foreground font-medium mb-1">Special Requirements</p>
                      <p className="text-sm text-foreground">{specialRequirements}</p>
                    </div>
                  )}
                  {isRecurring && (
                    <div className="rounded-lg bg-primary/5 p-3 mt-2">
                      <p className="text-xs text-primary font-medium mb-1 flex items-center gap-1"><Repeat className="w-3 h-3" /> Recurring Task</p>
                      <p className="text-sm text-foreground capitalize">{recurrenceInterval}{recurrenceEndDate ? ` until ${new Date(recurrenceEndDate + "T00:00").toLocaleDateString()}` : ""}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment Breakdown Card */}
              <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="px-5 py-4 border-b border-border">
                  <h3 className="font-display font-semibold text-foreground flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-primary" /> Payment Breakdown
                  </h3>
                </div>
                <div className="p-5 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">You pay</span>
                    <span className="font-medium text-foreground">${budgetNum.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Platform fee ({platformFee}%)</span>
                    <span className="font-medium text-foreground">−${feeAmount.toFixed(2)}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">Helper receives</span>
                    <span className="text-xl font-bold text-foreground">${helperEarns.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Trust Signals */}
              <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Shield className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Secure Escrow Payment</p>
                    <p className="text-xs text-muted-foreground">Your payment is held securely until the job is completed to your satisfaction.</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Money-Back Guarantee</p>
                    <p className="text-xs text-muted-foreground">If the job isn't completed, your payment will be refunded.</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={saving || uploading}
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  {uploading ? "Uploading photos…" : saving ? "Processing…" : `Pay $${budgetNum.toFixed(2)}`}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-muted-foreground"
                  onClick={() => setStep("form")}
                  disabled={saving}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Back to edit
                </Button>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default PostJob;
