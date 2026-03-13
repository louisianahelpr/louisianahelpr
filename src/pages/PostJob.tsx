import { useState, useEffect, useCallback } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
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
  CreditCard, Shield, ChevronLeft, Briefcase, Repeat, Users, Sparkles, Loader2, Zap, CheckCircle2,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useDraftJob } from "@/hooks/useDraftJob";
import { usePageTitle } from "@/hooks/usePageTitle";
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
  usePageTitle("Post a Task — Helpr");
  const [searchParams] = useSearchParams();
  const { draft, hasDraft, saveDraft, clearDraft } = useDraftJob();
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [streetAddress, setStreetAddress] = useState("");
  const [city, setCity] = useState("");
  const [addrState, setAddrState] = useState("");
  const [zipCode, setZipCode] = useState("");
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
  const [isUrgent, setIsUrgent] = useState(false);
  const [urgentFee, setUrgentFee] = useState("5");
  const [customUrgentFee, setCustomUrgentFee] = useState(false);
  const [platformFee, setPlatformFee] = useState(15);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

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
          // Parse location back into fields if possible
          const locParts = (data.location || "").split(", ");
          if (locParts.length >= 3) {
            setStreetAddress(locParts[0]);
            setCity(locParts[1]);
            const stateZip = locParts[2].split(" ");
            setAddrState(stateZip[0] || "");
            setZipCode(stateZip.slice(1).join(" ") || "");
          } else {
            setStreetAddress(data.location);
          }
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
      setCategory(draft.category); setStreetAddress(draft.location);
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
    const location = `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`;
    if (title || description || streetAddress || budget) {
      saveDraft({ title, description, category, location, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate });
    }
  }, [title, description, category, streetAddress, city, addrState, zipCode, dateNeeded, startTime, estimatedHours, budget, specialRequirements, isRecurring, recurrenceInterval, recurrenceEndDate, saveDraft]);

  useEffect(() => {
    const timer = setTimeout(autoSave, 2000);
    return () => clearTimeout(timer);
  }, [autoSave]);




  const handleAiBuild = async () => {
    if (!aiPrompt.trim()) { toast.error("Describe what you need help with"); return; }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-job-builder", {
        body: { messages: [{ role: "user", content: aiPrompt }], jobContext: { location: `${city}, ${addrState}` } },
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
    if (!title.trim()) { toast.error("Task title is required"); return; }
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!category) { toast.error("Category is required"); return; }
    if (!streetAddress.trim()) { toast.error("Street address is required"); return; }
    if (!city.trim()) { toast.error("City is required"); return; }
    if (!addrState.trim()) { toast.error("State is required"); return; }
    if (!zipCode.trim()) { toast.error("Zip code is required"); return; }
    if (!dateNeeded) { toast.error("Date needed is required"); return; }
    if (!startTime) { toast.error("Start time is required"); return; }
    if (!estimatedHours || parseFloat(estimatedHours) <= 0) { toast.error("Estimated hours is required"); return; }
    if (!budget || parseFloat(budget) < 5) { toast.error("Minimum budget is $5"); return; }
    if (parseFloat(budget) > 5000) { toast.error("Maximum budget is $5,000. For larger projects, split into milestones."); return; }
    if (isUrgent && (parseFloat(urgentFee) < 5 || isNaN(parseFloat(urgentFee)))) { toast.error("Urgent tip must be at least $5"); return; }
    setConfirmed(false);
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

    // Calculate expiry date
    let expiresAt: string | null = null;
    if (jobDuration !== "none") {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + parseInt(jobDuration));
      expiresAt = expiry.toISOString();
    }

    const { data: jobData, error } = await supabase.from("jobs").insert({
      customer_id: user.id,
      title: title.trim(),
      description: description.trim(),
      category: category as any,
      location: `${streetAddress.trim()}, ${city.trim()}, ${addrState.trim()} ${zipCode.trim()}`,
      date_needed: dateNeeded === "flexible" ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] : dateNeeded,
      start_time: startTime === "flexible" ? "flexible" : (startTime || null),
      estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
      budget: parseFloat(budget),
      special_requirements: [
        specialRequirements.trim(),
        dateNeeded === "flexible" ? "[Flexible date]" : "",
      ].filter(Boolean).join(" | ") || null,
      is_recurring: isRecurring,
      recurrence_interval: isRecurring ? recurrenceInterval : null,
      recurrence_end_date: isRecurring && recurrenceEndDate ? recurrenceEndDate : null,
      is_group_job: isGroupJob,
      helpers_needed: isGroupJob ? parseInt(helpersNeeded) || 2 : 1,
      expires_at: expiresAt,
      is_urgent: isUrgent,
      urgent_fee: isUrgent ? parseFloat(urgentFee) || 0 : 0,
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
  const urgentFeeNum = isUrgent ? (parseFloat(urgentFee) || 0) : 0;
  const totalCharge = budgetNum + urgentFeeNum;
  const feeAmount = budgetNum * (platformFee / 100);
  const helperEarns = budgetNum - feeAmount;
  const categoryLabel = categories.find((c) => c.value === category)?.label || category;

  return (
    <div className="min-h-screen bg-background pb-20">
      <DashboardHeader />

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-lg mx-auto space-y-8">

          {/* STEP 1: FORM */}
          {step === "form" && (
            <>
              <div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")} className="rounded-xl h-9 w-9 shrink-0">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h1 className="text-3xl font-display font-bold text-foreground">Post a task</h1>
                </div>
                <p className="text-muted-foreground mt-1 ml-11">Describe what you need help with</p>
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
                  <Label htmlFor="title">Task title <span className="text-destructive">*</span></Label>
                  <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Help me move a couch" required maxLength={100} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
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

                <div className="space-y-3">
                  <Label>Location <span className="text-destructive">*</span></Label>
                  <Input id="streetAddress" value={streetAddress} onChange={(e) => setStreetAddress(e.target.value)} placeholder="Street address" required maxLength={200} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" required maxLength={100} />
                    <Input id="state" value={addrState} onChange={(e) => setAddrState(e.target.value)} placeholder="State" required maxLength={50} />
                    <Input id="zipCode" value={zipCode} onChange={(e) => setZipCode(e.target.value)} placeholder="Zip code" required maxLength={10} />
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    Only the city will be visible to applicants until you select a helper.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="date">Date needed</Label>
                    <Input id="date" type="date" value={dateNeeded} onChange={(e) => setDateNeeded(e.target.value)} required />
                    <button
                      type="button"
                      onClick={() => setDateNeeded("flexible")}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        dateNeeded === "flexible"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      📅 Flexible date
                    </button>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="time">Start time</Label>
                    <Input id="time" type="time" value={startTime === "flexible" ? "" : startTime} onChange={(e) => setStartTime(e.target.value)} />
                    <button
                      type="button"
                      onClick={() => setStartTime(startTime === "flexible" ? "" : "flexible")}
                      className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                        startTime === "flexible"
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                      }`}
                    >
                      🕐 Flexible time
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="hours">Estimated hours</Label>
                    <Input id="hours" type="number" step="0.5" min="0.5" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} placeholder="2" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="budget">Budget ($)</Label>
                    <Input id="budget" type="number" step="1" min="5" max="5000" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="50" required />
                    {category && categoryPricing[category] && (
                      <p className="text-xs text-muted-foreground">
                        💡 Suggested: <span className="font-medium text-primary">${categoryPricing[category].min}–${categoryPricing[category].max}</span> for {categoryPricing[category].label} jobs
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="requirements">Special requirements</Label>
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
                      <Label htmlFor="group" className="cursor-pointer">Group job (multiple helprs)</Label>
                    </div>
                    <Switch id="group" checked={isGroupJob} onCheckedChange={setIsGroupJob} />
                  </div>
                  {isGroupJob && (
                    <div className="space-y-2 pt-1">
                      <Label>How many helprs needed?</Label>
                      <Input
                        type="number"
                        min="2"
                        max="10"
                        value={helpersNeeded}
                        onChange={(e) => setHelpersNeeded(e.target.value)}
                        className="w-24"
                      />
                      <p className="text-xs text-muted-foreground">
                        Budget of ${budgetNum.toFixed(2)} will be split: ~${(budgetNum / (parseInt(helpersNeeded) || 2)).toFixed(2)}/helpr
                      </p>
                    </div>
                  )}
                </div>

                {/* Urgent Job */}
                <div className={`rounded-xl border p-4 space-y-3 ${isUrgent ? "border-accent bg-accent/5" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-accent" />
                      <Label htmlFor="urgent" className="cursor-pointer">Mark as Urgent</Label>
                    </div>
                    <Switch id="urgent" checked={isUrgent} onCheckedChange={setIsUrgent} />
                  </div>
                  {isUrgent && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        ⚡ Your job will be highlighted and nearby helprs notified immediately. The urgent tip goes directly to the helpr — no platform fee applied.
                      </p>
                      <Label className="text-xs">Urgent tip ($5 minimum)</Label>
                      <div className="flex flex-wrap gap-2">
                        {["5", "10", "15", "20"].map((amt) => (
                          <button
                            key={amt}
                            type="button"
                            onClick={() => { setUrgentFee(amt); setCustomUrgentFee(false); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              urgentFee === amt && !customUrgentFee
                                ? "bg-accent text-accent-foreground"
                                : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                            }`}
                          >
                            ${amt}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => { setCustomUrgentFee(true); setUrgentFee(""); }}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            customUrgentFee
                              ? "bg-accent text-accent-foreground"
                              : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                          }`}
                        >
                          Custom
                        </button>
                      </div>
                      {customUrgentFee && (
                        <Input
                          type="number"
                          min="5"
                          step="1"
                          value={urgentFee}
                          onChange={(e) => setUrgentFee(e.target.value)}
                          placeholder="Enter amount ($5+)"
                          className="w-32"
                        />
                      )}
                    </div>
                  )}
                </div>

                {/* Listing Expiration */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <Label>Listing expiration</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">How long should this listing stay visible to applicants?</p>
                  <Select value={jobDuration} onValueChange={setJobDuration}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 day</SelectItem>
                      <SelectItem value="2">2 days</SelectItem>
                      <SelectItem value="3">3 days</SelectItem>
                      <SelectItem value="4">4 days</SelectItem>
                      <SelectItem value="5">5 days</SelectItem>
                      <SelectItem value="6">6 days</SelectItem>
                      <SelectItem value="7">1 week</SelectItem>
                      <SelectItem value="none">No expiry — stays open until filled</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {jobDuration === "none"
                       ? "Your listing will stay open until you choose an applicant or close it manually."
                       : `Your listing will automatically close after ${jobDuration === "7" ? "1 week" : `${jobDuration} day${jobDuration === "1" ? "" : "s"}`} if no one is selected.`}
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
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => setStep("form")} className="rounded-xl h-9 w-9 shrink-0">
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <h1 className="text-3xl font-display font-bold text-foreground">Order Summary</h1>
                </div>
                <p className="text-muted-foreground mt-1 ml-11">Review your task before paying</p>
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
                      <span>{`${streetAddress}, ${city}, ${addrState} ${zipCode}`}</span>
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
                    <span className="text-muted-foreground">Task budget</span>
                    <span className="font-medium text-foreground">${budgetNum.toFixed(2)}</span>
                  </div>
                  {isUrgent && urgentFeeNum > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3 text-accent" /> Urgent tip (goes to helpr)</span>
                      <span className="font-medium text-foreground">${urgentFeeNum.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Platform fee ({platformFee}%)</span>
                    <span className="font-medium text-foreground">−${feeAmount.toFixed(2)}</span>
                  </div>
                  <div className="h-px bg-border" />
                  <div className="flex justify-between">
                    <span className="font-semibold text-foreground">You pay</span>
                    <span className="text-xl font-bold text-foreground">${totalCharge.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Helpr receives</span>
                    <span className="font-medium text-primary">
                      ${helperEarns.toFixed(2)}{urgentFeeNum > 0 ? ` + $${urgentFeeNum.toFixed(2)} urgent tip` : ""}
                    </span>
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

              {/* Confirmation Checkbox */}
              <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
                <Checkbox
                  id="confirm-details"
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor="confirm-details" className="text-sm text-foreground cursor-pointer leading-snug">
                  I've reviewed all details above and confirm everything is correct. I understand my payment will be held in escrow until the job is completed.
                </label>
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleSubmit}
                  disabled={saving || uploading || !confirmed}
                >
                  {confirmed ? <CreditCard className="w-4 h-4 mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  {uploading ? "Uploading photos…" : saving ? "Processing…" : !confirmed ? "Confirm details to continue" : `Pay $${totalCharge.toFixed(2)}`}
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
