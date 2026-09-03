// Compose a new post, or edit an existing one.
//
// The same dialog does both because the fields are identical and a second
// near-copy is how the two drift — one gaining a validation rule the other
// never got. What differs is only the commit's label: creating saves a draft or
// schedules depending on whether a time is set and the post is publishable,
// while editing saves content and leaves the lifecycle to the queue row's own
// actions, so there is exactly one place a post changes status.
//
// ── THE INSTAGRAM RULE IS ENFORCED HERE, IN WORDS ─────────────────────────
// `marketing_content_instagram_needs_media` would reject an image-less
// Instagram row at write time with a CHECK-violation string. Instead the
// Schedule button is DISABLED and the reason is printed under the field, with
// the escape route named ("save it as a draft instead"), so the constraint is
// something the owner is guided around rather than something they hit.

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHero,
  DialogPrimaryAction,
  DialogSecondaryAction,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PARISHES, parishLabel } from "@/lib/parishes";
import { report } from "@/lib/errorLogger";
import { mutationErrorMessage } from "@/lib/mutationResult";
import { userFacingError } from "@/lib/userFacingError";
import {
  CHANNEL_LABEL,
  MARKETING_CHANNELS,
  PLATFORM_LIMITS,
  blockingIssues,
  composeCaption,
  formatHashtags,
  fromDateTimeLocalValue,
  parseHashtags,
  toDateTimeLocalValue,
  validateDraft,
  type MarketingChannel,
  type MarketingContentRow,
  type MarketingDraftInput,
} from "./marketingTypes";
import { createMarketingContent, updateMarketingContent } from "./marketingApi";
import {
  INSTAGRAM_PREFERRED_MIME,
  MARKETING_MEDIA_ACCEPT,
  uploadMarketingMedia,
} from "./marketingMedia";

/** Sentinel for "no parish" — Radix `SelectItem` cannot take an empty value. */
const NO_PARISH = "__none__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = compose a new post; a row = edit that post's content. */
  row: MarketingContentRow | null;
  onSaved: () => void;
}

export function MarketingComposerDialog({ open, onOpenChange, row, onSaved }: Props) {
  const isEdit = row !== null;
  const fileRef = useRef<HTMLInputElement>(null);

  const [channel, setChannel] = useState<MarketingChannel>("instagram");
  const [body, setBody] = useState("");
  const [hashtagsRaw, setHashtagsRaw] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaIsJpeg, setMediaIsJpeg] = useState(true);
  const [parish, setParish] = useState<string>(NO_PARISH);
  const [campaign, setCampaign] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reload the form whenever the dialog opens, so a cancelled edit never
  // leaks its half-typed body into the next post the owner writes.
  useEffect(() => {
    if (!open) return;
    setChannel(row?.channel ?? "instagram");
    setBody(row?.body ?? "");
    setHashtagsRaw(formatHashtags(row?.hashtags ?? []));
    setMediaUrl(row?.media_urls?.[0] ?? null);
    // An already-stored URL's type is unknown here; assume it is fine rather
    // than raising a warning about a file we cannot inspect.
    setMediaIsJpeg(true);
    setParish(row?.parish ?? NO_PARISH);
    setCampaign(row?.campaign ?? "");
    setScheduledLocal(toDateTimeLocalValue(row?.scheduled_for ?? null));
  }, [open, row]);

  const hashtags = parseHashtags(hashtagsRaw);
  const input: MarketingDraftInput = {
    channel,
    body,
    hashtags,
    media_urls: mediaUrl ? [mediaUrl] : [],
    parish: parish === NO_PARISH ? null : parish,
    campaign: campaign.trim() || null,
    scheduled_for: fromDateTimeLocalValue(scheduledLocal),
  };

  const limits = PLATFORM_LIMITS[channel];
  const caption = composeCaption(body, hashtags);
  const overCaption = limits.captionMax !== null && caption.length > limits.captionMax;
  const overTags = limits.hashtagMax !== null && hashtags.length > limits.hashtagMax;

  // The strict target drives the inline messages: for a new post that is
  // "scheduled" (the strictest), for an edit it is the row's own status, so
  // editing a published-path row is held to the rules that row must satisfy.
  const strictTarget = row ? row.status : "scheduled";
  const issues = validateDraft(input, strictTarget);
  const draftIssues = validateDraft(input, "draft");
  const canSaveDraft = blockingIssues(draftIssues).length === 0 && !saving && !uploading;
  const canSchedule = blockingIssues(validateDraft(input, "scheduled")).length === 0 && !saving && !uploading;
  const canSaveEdit = blockingIssues(issues).length === 0 && !saving && !uploading;

  /**
   * ONE commit, whose label tells the truth about what pressing it will do.
   *
   * This footer used to hold "Save draft" AND "Schedule" — two primary actions
   * competing for the same slot, which is the hierarchy defect the popup
   * grammar exists to catch. The two were never really a choice: `canSchedule`
   * is false unless a time is set AND the post is publishable, so one of them
   * was always the wrong button. Deriving the mode instead means the owner
   * reads what will happen rather than picking between a live option and a
   * dead one — and an Instagram post with no image degrades to "Save draft"
   * automatically, with the issues panel saying why it can't be scheduled yet.
   *
   * TRADE-OFF: a post with a valid time can no longer be parked as a draft
   * from here. Reopening it from the queue does that in one tap, which is the
   * rarer path.
   */
  const commitMode: "edit" | "scheduled" | "draft" = isEdit
    ? "edit"
    : canSchedule
      ? "scheduled"
      : "draft";
  const commitLabel =
    commitMode === "edit" ? "Save changes" : commitMode === "scheduled" ? "Schedule" : "Save draft";
  const canCommit =
    commitMode === "edit" ? canSaveEdit : commitMode === "scheduled" ? canSchedule : canSaveDraft;

  const pickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset immediately so picking the SAME file twice still fires a change.
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadMarketingMedia(file);
      setMediaUrl(url);
      setMediaIsJpeg(file.type.toLowerCase() === INSTAGRAM_PREFERRED_MIME);
      toast.success("Image attached.");
    } catch (err) {
      report(err, { tags: { source: "MarketingComposerDialog.upload" } });
      toast.error(userFacingError(err, "Couldn't upload that image — try again."));
    } finally {
      setUploading(false);
    }
  };

  const submit = async (mode: "draft" | "scheduled" | "edit") => {
    setSaving(true);
    try {
      if (mode === "edit" && row) {
        await updateMarketingContent(row.id, input);
        toast.success("Post saved.");
      } else {
        await createMarketingContent(input, mode === "scheduled" ? "scheduled" : "draft");
        toast.success(mode === "scheduled" ? "Post scheduled." : "Draft saved.");
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      report(err, { tags: { source: "MarketingComposerDialog.submit", mode } });
      toast.error(mutationErrorMessage(err, "Couldn't save that post — try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHero title={isEdit ? "Edit post" : "New post"} />

        {/* The dialog's narration, in one place. This used to be four grey
            helper paragraphs sitting under individual fields — the shadcn
            default voice the popup grammar bans, and a voice no other converted
            dialog in the app speaks. Consolidating them here says the same
            things in the house treatment, and says them before the owner starts
            typing rather than after they hit a disabled button. */}
        <DialogBody>
          Write the post exactly as it should appear. Hashtags count toward the caption limit.
          {channel === "instagram"
            ? " Instagram requires an image — its publishing API fetches the picture from a public URL, so a text-only Instagram post isn't possible."
            : limits.note
              ? ` ${limits.note}`
              : ""}
        </DialogBody>

        <div className="space-y-4">
          {/* Channel is fixed once a row exists: changing it would move the row
              under a different set of constraints (and a different account)
              than the one it was written and validated for. */}
          <div className="space-y-2">
            <Label className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground">
              Channel
            </Label>
            {isEdit ? (
              <p className="text-ds-13 text-foreground">{CHANNEL_LABEL[channel]}</p>
            ) : (
              <Select value={channel} onValueChange={(v) => setChannel(v as MarketingChannel)}>
                <SelectTrigger aria-label="Channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label
                htmlFor="post-body"
                className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground"
              >
                Body
              </Label>
              {/* Counts the COMPOSED caption (body + hashtags), because that is
                  what the platform measures. */}
              <span
                className="text-ds-11 tabular-nums"
                style={{
                  color: overCaption ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                }}
              >
                {caption.length.toLocaleString()}
                {limits.captionMax !== null ? ` / ${limits.captionMax.toLocaleString()}` : ""} chars
              </span>
            </div>
            <Textarea
              id="post-body"
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the post exactly as it should appear."
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label
                htmlFor="post-tags"
                className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground"
              >
                Hashtags
              </Label>
              <span
                className="text-ds-11 tabular-nums"
                style={{
                  color: overTags ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))",
                }}
              >
                {hashtags.length}
                {limits.hashtagMax !== null ? ` / ${limits.hashtagMax}` : ""} tags
              </span>
            </div>
            <Input
              id="post-tags"
              value={hashtagsRaw}
              onChange={(e) => setHashtagsRaw(e.target.value)}
              placeholder="#nola, #batonrouge #handyman"
            />
          </div>

          {/* Image. The Instagram requirement is stated here, next to the
              control that satisfies it, not only in the error list. */}
          <div className="space-y-2">
            <Label className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground">
              Image
            </Label>
            <input
              ref={fileRef}
              type="file"
              accept={MARKETING_MEDIA_ACCEPT}
              className="hidden"
              onChange={(e) => void onFile(e)}
            />
            {mediaUrl ? (
              <div className="flex items-center gap-3 rounded-lg border border-border/60 p-2">
                <img
                  src={mediaUrl}
                  alt="Attached post image"
                  className="h-16 w-16 shrink-0 rounded-md object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={pickFile} disabled={uploading}>
                    {uploading ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Replace
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setMediaUrl(null)}
                    disabled={uploading}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="outline" onClick={pickFile} disabled={uploading} className="w-full">
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="mr-2 h-4 w-4" />
                )}
                {uploading ? "Uploading…" : "Attach image"}
              </Button>
            )}
            {channel === "instagram" && mediaUrl && !mediaIsJpeg && (
              <p className="flex items-start gap-1.5 text-ds-11" style={{ color: "hsl(var(--burnt-sienna))" }}>
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>
                  Instagram's publishing API is documented as accepting JPEG. This file isn't a
                  JPEG and may be rejected at publish time — worth verifying before you rely on it.
                </span>
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground">
                Parish (optional)
              </Label>
              <Select value={parish} onValueChange={setParish}>
                <SelectTrigger aria-label="Parish">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PARISH}>No parish</SelectItem>
                  {PARISHES.map((p) => (
                    <SelectItem key={p.slug} value={p.name}>
                      {parishLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="post-campaign"
                className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground"
              >
                Campaign (optional)
              </Label>
              <Input
                id="post-campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="hurricane-season-2026"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="post-when"
              className="text-ds-11 font-medium uppercase tracking-wide text-muted-foreground"
            >
              Scheduled for (your local time)
            </Label>
            <Input
              id="post-when"
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
            />
          </div>

          {/* Every reason this post can't go out, in one place, above the
              buttons that are disabled because of them. */}
          {issues.length > 0 && (
            <div
              className="space-y-1.5 rounded-lg border p-3"
              style={{
                borderColor: blockingIssues(issues).length
                  ? "hsl(var(--destructive) / 0.5)"
                  : "hsl(var(--border))",
                background: blockingIssues(issues).length
                  ? "hsl(var(--destructive) / 0.06)"
                  : "hsl(var(--muted) / 0.4)",
              }}
            >
              {issues.map((issue) => (
                <p
                  key={issue.message}
                  className="flex items-start gap-1.5 text-ds-11"
                  style={{
                    color:
                      issue.level === "blocking"
                        ? "hsl(var(--destructive))"
                        : "hsl(var(--burnt-sienna))",
                  }}
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{issue.message}</span>
                </p>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogSecondaryAction onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </DialogSecondaryAction>
          <DialogPrimaryAction onClick={() => void submit(commitMode)} disabled={!canCommit}>
            {saving ? "Saving…" : commitLabel}
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
