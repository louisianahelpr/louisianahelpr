import { useCallback, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, MapPin, X, ShieldAlert, FileText, Loader2, Mic, MicOff, Camera, Image as ImageIcon, FilePlus2, Square, AudioLines } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { scanMessage } from "@/lib/messageScanner";
import { hapticLight, hapticMedium, hapticError } from "@/lib/haptics";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import { useVoiceRecorder } from "@/hooks/useVoiceRecorder";
import { isNativePlatform } from "@/lib/nativeInit";
import { pickImagesNative, takePhotoNative } from "@/lib/nativeCamera";
import { report } from "@/lib/errorLogger";
import { assertWritable } from "@/hooks/useImpersonation";
import {
  uploadMessageAttachment,
  uploadVoiceNote,
  isImageMime,
  isPdfMime,
  MESSAGE_ATTACHMENT_MAX_BYTES,
} from "@/lib/messageAttachments";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type SendAttachment = {
  path: string;
  mime: string;
  size: number;
  /** Duration in seconds — only set for voice notes. */
  duration?: number;
};

interface RichMessageInputProps {
  onSend: (content: string, attachment?: SendAttachment) => void;
  onTyping?: () => void;
  disabled?: boolean;
  /** Optional controlled value — when provided, parent owns the text state. */
  value?: string;
  onChange?: (value: string) => void;
  /** Job ID for the active conversation — required for attachment uploads. */
  jobId?: string;
  /** Sender ID (current user) — required for attachment uploads (path scoping). */
  senderId?: string;
}

export const RichMessageInput = ({
  onSend, onTyping, disabled, value, onChange, jobId, senderId,
}: RichMessageInputProps) => {
  const [internalText, setInternalText] = useState("");
  const isControlled = value !== undefined;
  const text = isControlled ? (value as string) : internalText;
  const setText = (v: string) => {
    if (isControlled) onChange?.(v);
    else setInternalText(v);
  };
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingViolation, setPendingViolation] = useState<string | null>(null);
  // The attach picker sheet — bottom-sheet with three tabs (Camera /
  // Library / Files) so the user picks the source explicitly instead
  // of hoping the OS file picker happens to default to the right one.
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  // One hidden <input type="file"> per source so each can carry its
  // own `accept` / `capture` attributes — iOS Safari + Capacitor
  // WebView honor `capture="environment"` to launch the camera, and
  // narrowing `accept` keeps the Files picker focused on PDFs.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  // Legacy ref kept for downstream callers; unused after the refactor
  // but the close-staged failure path resets all three above.
  const fileRef = useRef<HTMLInputElement>(null);
  const { request: requestPermission } = usePermissionRationale();

  // Throttle the presence broadcast: without this, onTyping fires once per
  // keystroke, flooding the realtime channel with a broadcast per character.
  const lastTypingAt = useRef(0);
  const notifyTyping = () => {
    if (!onTyping) return;
    const now = Date.now();
    if (now - lastTypingAt.current < 500) return;
    lastTypingAt.current = now;
    onTyping();
  };

  // Voice-to-text mic: only mounts on platforms with SpeechRecognition.
  // The hook's `onFinal` appends each recognized chunk to the existing
  // draft so the user can dictate, then type, then dictate again
  // without losing the prior text. Interim text shows as a placeholder
  // hint so the user can confirm what's being heard. The text ref keeps
  // the closure fresh so a long dictation session doesn't drop earlier
  // chunks against a stale `text` snapshot.
  const textRef = useRef(text);
  textRef.current = text;
  const handleVoiceFinal = useCallback((dictated: string) => {
    const trimmed = textRef.current.trimEnd();
    setText(trimmed ? `${trimmed} ${dictated}` : dictated);
    notifyTyping();
    // setText / notifyTyping are stable in the callsites we care about.
  }, []);
  const voice = useVoiceDictation({ onFinal: handleVoiceFinal });
  const toggleVoice = () => {
    if (!voice.supported) {
      toast.error("Voice dictation isn't available on this device.");
      return;
    }
    if (voice.isListening) {
      hapticLight();
      voice.stop();
    } else {
      hapticMedium();
      voice.start();
    }
  };

  // Voice recorder — records a short audio clip and sends it as a voice note.
  const recorder = useVoiceRecorder({ maxSeconds: 60 });

  const handleVoiceNoteRecord = async () => {
    if (!assertWritable()) return;
    if (recorder.state === "recording") {
      hapticLight();
      recorder.stop();
      return;
    }
    if (recorder.state === "stopped") {
      // Send the completed note
      if (!recorder.blob || !jobId || !senderId) {
        toast.error("Couldn't start a voice note — try reopening the chat");
        recorder.discard();
        return;
      }
      setUploading(true);
      const result = await uploadVoiceNote(recorder.blob, recorder.mime, jobId, senderId);
      setUploading(false);
      if ("error" in result) {
        toast.error(result.error);
        recorder.discard();
        return;
      }
      onSend("", { path: result.path, mime: result.mime, size: result.size, duration: recorder.duration });
      recorder.discard();
      return;
    }
    // Start recording
    hapticMedium();
    await recorder.start();
  };

  const handleVoiceNoteDiscard = () => {
    hapticLight();
    recorder.discard();
  };

  const stageFile = (file: File): boolean => {
    if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
      toast.error(`That file's too large — keep attachments under ${Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)} MB`);
      return false;
    }
    setStagedFile(file);
    setImagePreview(isImageMime(file.type) ? URL.createObjectURL(file) : null);
    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input regardless of selection so re-picking the same
    // file fires onChange next time. Each of the three source inputs
    // resets only its own value.
    if (e.target) e.target.value = "";
    if (!file) return;
    stageFile(file);
  };

  const clearStaged = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setStagedFile(null);
    setImagePreview(null);
  };

  const pickFromCamera = async () => {
    hapticLight();
    setAttachSheetOpen(false);
    // Native: drive the OS camera through @capacitor/camera (the WebView
    // `capture="environment"` input is unreliable on iOS). Web keeps the
    // hidden input so desktop/browser capture still works.
    if (isNativePlatform) {
      try {
        const file = await takePhotoNative();
        if (file) stageFile(file);
      } catch (err) {
        report(err, { tags: { source: "RichMessageInput.pickFromCamera" } });
        toast.error("Couldn't open the camera. Please try again.");
      }
      return;
    }
    cameraInputRef.current?.click();
  };
  const pickFromLibrary = async () => {
    hapticLight();
    setAttachSheetOpen(false);
    if (isNativePlatform) {
      try {
        const picked = await pickImagesNative(1);
        if (picked[0]) stageFile(picked[0]);
      } catch (err) {
        report(err, { tags: { source: "RichMessageInput.pickFromLibrary" } });
        toast.error("Couldn't open your photos. Please try again.");
      }
      return;
    }
    libraryInputRef.current?.click();
  };
  const pickFromFiles = () => {
    hapticLight();
    setAttachSheetOpen(false);
    filesInputRef.current?.click();
  };

  const uploadStaged = async (): Promise<SendAttachment | null> => {
    if (!stagedFile) return null;
    if (!jobId || !senderId) {
      toast.error("Couldn't upload that — try reopening the chat");
      return null;
    }
    setUploading(true);
    const result = await uploadMessageAttachment(stagedFile, jobId, senderId);
    setUploading(false);
    if ("error" in result) {
      toast.error(result.error);
      // Clear the staged file + reset every native input so re-picking
      // the SAME file fires onChange again and the user can retry.
      clearStaged();
      if (cameraInputRef.current) cameraInputRef.current.value = "";
      if (libraryInputRef.current) libraryInputRef.current.value = "";
      if (filesInputRef.current) filesInputRef.current.value = "";
      return null;
    }
    return { path: result.path, mime: result.mime, size: result.size };
  };

  const handleShareLocation = async () => {
    if (!isNativePlatform && !navigator.geolocation) {
      toast.error("This device can't share location.");
      return;
    }
    // Soft pre-prompt before triggering the OS permission dialog.
    // Improves accept rates and keeps the OS prompt from being burned
    // by a panic-tap "deny."
    await requestPermission("location", async () => {
      // Native reads through @capacitor/geolocation (CLLocationManager) —
      // the WKWebView navigator.geolocation shim is unreliable in the shell.
      if (isNativePlatform) {
        try {
          const { Geolocation } = await import("@capacitor/geolocation");
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 });
          const { latitude, longitude } = pos.coords;
          onSend(`📍 Location: https://maps.google.com/?q=${latitude},${longitude}`);
        } catch {
          toast.error("Location access denied — allow it in Settings to share your location");
        }
        return;
      }
      await new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            onSend(`📍 Location: https://maps.google.com/?q=${latitude},${longitude}`);
            resolve();
          },
          () => {
            toast.error("Location access denied — allow it in Settings to share your location");
            resolve();
          },
        );
      });
    });
  };

  const performSend = async () => {
    if (stagedFile) {
      const attachment = await uploadStaged();
      if (!attachment) return; // upload failed; toast already shown
      onSend(text.trim(), attachment);
      clearStaged();
      setText("");
      return;
    }

    if (!text.trim()) return;
    hapticLight();
    onSend(text.trim());
    setText("");
  };

  const handleSend = async () => {
    if (uploading) return;
    // Read-only impersonation: admins viewing as another user cannot send.
    if (!assertWritable()) return;

    if (text.trim()) {
      const violations = scanMessage(text);
      if (violations.length > 0) {
        hapticError();
        setPendingViolation(violations[0].label);
        return;
      }
    }

    await performSend();
  };

  const confirmSendAnyway = async () => {
    setPendingViolation(null);
    await performSend();
  };

  const stagedIsPdf = stagedFile && isPdfMime(stagedFile.type);

  return (
    <div className="space-y-2">
      {stagedFile && (
        <div className="relative inline-block">
          {imagePreview && imagePreview.startsWith("blob:") ? (
            <img loading="lazy" decoding="async" src={imagePreview} alt="Preview" className="h-20 w-20 rounded-ds-sm object-cover border border-border" />
          ) : (
            <div className="h-20 w-32 rounded-ds-sm bg-card flex items-center gap-2 px-3">
              <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
              <span className="text-ds-11 text-foreground truncate">{stagedFile.name}</span>
            </div>
          )}
          <button
            onClick={clearStaged}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
            disabled={uploading}
            aria-label="Remove attachment"
          >
            <X className="w-3 h-3" />
          </button>
          {stagedIsPdf && <p className="text-ds-10 text-muted-foreground mt-1">PDF · {(stagedFile.size / 1024).toFixed(0)} KB</p>}
        </div>
      )}
      {/* Voice note recording indicator — replaces the full input row
          while recording or after stop (ready-to-send state). */}
      {(recorder.state === "recording" || recorder.state === "stopped") && (
        <div
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5 mb-1"
          style={{
            background: "hsl(var(--bark) / 0.07)",
            border: "0.5px solid hsl(var(--olivewood) / 0.16)",
          }}
        >
          {/* Red pulse dot while recording */}
          {recorder.state === "recording" && (
            <span
              aria-hidden="true"
              className="w-2 h-2 rounded-full animate-pulse shrink-0"
              style={{ background: "hsl(var(--burnt-sienna))", boxShadow: "0 0 4px hsl(var(--burnt-sienna) / 0.6)" }}
            />
          )}
          <span
            className="flex-1 text-ds-13 tabular-nums font-sans"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {recorder.state === "recording"
              ? `Recording… ${recorder.elapsed}s / 60s`
              : `Voice note — ${recorder.duration}s`}
          </span>
          {/* Discard */}
          <button
            type="button"
            aria-label="Discard voice note"
            onClick={handleVoiceNoteDiscard}
            className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90"
            style={{ background: "hsl(var(--olivewood) / 0.10)", color: "hsl(var(--olivewood))" }}
          >
            <X className="w-4 h-4" />
          </button>
          {/* Stop (while recording) or Send (when stopped) */}
          {recorder.state === "recording" ? (
            <button
              type="button"
              aria-label="Stop recording"
              onClick={() => { hapticLight(); recorder.stop(); }}
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90"
              style={{ background: "hsl(var(--burnt-sienna))", color: "white" }}
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send voice note"
              onClick={() => void handleVoiceNoteRecord()}
              disabled={uploading}
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all active:scale-90"
              style={{ background: "hsl(var(--bark))", color: "hsl(var(--parchment))" }}
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      )}

      <div className="flex gap-1.5 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-11 w-11 rounded-full liquid-glass glass-press"
          onClick={() => { hapticLight(); setAttachSheetOpen(true); }}
          disabled={disabled || uploading || recorder.state === "recording" || recorder.state === "stopped"}
          aria-label="Attach photo or PDF"
          title="Attach photo or PDF"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-11 w-11 rounded-full liquid-glass glass-press"
          onClick={handleShareLocation}
          disabled={disabled || uploading || recorder.state === "recording" || recorder.state === "stopped"}
          aria-label="Share location"
          title="Share location"
        >
          <MapPin className="w-4 h-4" />
        </Button>
        <Input
          aria-label="Type a message"
          placeholder={
            voice.isListening
              ? voice.interimText || "Listening…"
              : "Type a message…"
          }
          enterKeyHint="send"
          autoCapitalize="sentences"
          value={text}
          onChange={(e) => { setText(e.target.value); notifyTyping(); }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          className="flex-1"
          disabled={disabled || uploading || recorder.state === "recording" || recorder.state === "stopped"}
        />
        {/* Voice-to-text mic — appended just before Send so the most
            frequent action (Send) keeps the rightmost slot. Mounts only
            on platforms with SpeechRecognition (degrades cleanly on web
            browsers without it and on Capacitor WebViews that don't
            expose it). Live red dot indicates an active session. */}
        {voice.supported && recorder.state === "idle" && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-11 w-11 relative rounded-full liquid-glass glass-press"
            onClick={toggleVoice}
            disabled={disabled || uploading}
            aria-label={voice.isListening ? "Stop dictating" : "Dictate a message"}
            title={voice.isListening ? "Stop dictating" : "Dictate a message"}
          >
            {voice.isListening ? (
              <>
                <MicOff
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                />
                <span
                  aria-hidden="true"
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full animate-pulse"
                  style={{
                    background: "hsl(var(--burnt-sienna))",
                    boxShadow: "0 0 4px hsl(var(--burnt-sienna) / 0.6)",
                  }}
                />
              </>
            ) : (
              <Mic className="w-4 h-4" />
            )}
          </Button>
        )}
        {/* Voice note record button — tap to start recording; recording
            indicator (above the toolbar) takes over. Shows the AudioLines
            icon to distinguish it from the dictation mic. Hidden when a
            file is staged (can't send both) or dictation is active. */}
        {recorder.state === "idle" && !voice.isListening && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-11 w-11 relative rounded-full liquid-glass glass-press"
            onClick={() => void handleVoiceNoteRecord()}
            disabled={disabled || uploading || !!stagedFile}
            aria-label="Record voice note"
            title="Record voice note"
          >
            <AudioLines className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
          </Button>
        )}
        <Button
          size="icon"
          onClick={handleSend}
          disabled={(!text.trim() && !stagedFile) || uploading || disabled || recorder.state === "recording" || recorder.state === "stopped"}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </Button>
        {/* Three hidden source-specific inputs. Camera carries
            `capture="environment"` so iOS Safari + Capacitor WebViews
            launch the camera directly (without it the OS may default
            to the photo library on devices). Library narrows accept to
            images so the picker hides PDFs; Files narrows to PDFs so
            it hides photos. The user picks the source explicitly via
            the bottom-sheet — no more guessing the OS picker default. */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="hidden"
          onChange={handleFileSelect}
        />
        <input
          ref={filesInputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileSelect}
        />
        {/* Legacy ref left as a placeholder so anything that imported
            this component and reached into the ref doesn't crash; the
            actual source selection now flows through the three above. */}
        <input ref={fileRef} type="hidden" />
      </div>

      {/* Quick-attach bottom sheet — three explicit sources (Camera,
          Library, Files). The user picks where the attachment comes
          from in one tap rather than fighting an OS picker that may
          default to the wrong tab. iMessage convention: a sheet with
          named source buttons, not a single "open" intent. */}
      <Sheet open={attachSheetOpen} onOpenChange={setAttachSheetOpen}>
        <SheetContent side="bottom" className="max-w-md mx-auto rounded-t-2xl">
          <SheetHeader className="!text-left space-y-1.5">
            <span
              className="font-serif italic uppercase inline-flex items-center gap-1.5"
              style={{
                fontSize: "0.62rem",
                color: "hsl(var(--burnt-sienna) / 0.78)",
                letterSpacing: "0.18em",
              }}
            >
              <Paperclip className="w-3 h-3" /> Send an attachment
            </span>
            <SheetTitle
              className="font-display italic font-bold leading-tight"
              style={{
                fontSize: "clamp(1.35rem, 2vw + 0.4rem, 1.65rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.025em",
              }}
            >
              Where from?
            </SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={pickFromCamera}
              className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
              style={{
                background: "hsla(0, 0%, 100%, 0.65)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--bark) / 0.10)",
                  border: "1px solid hsl(var(--bark) / 0.22)",
                }}
              >
                <Camera className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} />
              </div>
              <span className="font-sans text-[12.5px] font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                Camera
              </span>
            </button>
            <button
              type="button"
              onClick={pickFromLibrary}
              className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
              style={{
                background: "hsla(0, 0%, 100%, 0.65)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--gold-warm) / 0.18)",
                  border: "1px solid hsl(var(--gold-warm) / 0.32)",
                }}
              >
                <ImageIcon className="w-4 h-4" style={{ color: "hsl(var(--gold-warm))" }} />
              </div>
              <span className="font-sans text-[12.5px] font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                Library
              </span>
            </button>
            <button
              type="button"
              onClick={pickFromFiles}
              className="flex flex-col items-center justify-center gap-1.5 px-3 py-4 rounded-ds-md min-h-[88px] transition-colors hover:bg-secondary/40"
              style={{
                background: "hsla(0, 0%, 100%, 0.65)",
                border: "0.5px solid hsl(var(--olivewood) / 0.14)",
              }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(var(--burnt-sienna) / 0.12)",
                  border: "1px solid hsl(var(--burnt-sienna) / 0.28)",
                }}
              >
                <FilePlus2 className="w-4 h-4" style={{ color: "hsl(var(--burnt-sienna))" }} />
              </div>
              <span className="font-sans text-[12.5px] font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                Files
              </span>
            </button>
          </div>
          <p
            className="mt-3 font-serif italic text-[0.74rem] leading-relaxed text-center"
            style={{ color: "hsl(var(--olivewood) / 0.7)" }}
          >
            Up to {Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB ·
            photos and PDFs only.
          </p>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!pendingViolation} onOpenChange={(open) => !open && setPendingViolation(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
              This violates platform rules
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2">
              <span className="block">
                We detected <strong className="text-foreground">{pendingViolation?.toLowerCase()}</strong> in your message.
              </span>
              <span className="block text-ds-11">
                Payments and conversations outside Helpr aren't protected by our dispute policy or escrow.
                Sending anyway will hide the message from the recipient and add a fraud flag to your account.
                Two flags within 24 hours triggers an automatic 7-day suspension.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Edit message</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSendAnyway} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Send anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
