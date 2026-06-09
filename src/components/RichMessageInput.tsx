import { useCallback, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Paperclip, MapPin, X, ShieldAlert, FileText, Loader2, Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { scanMessage } from "@/lib/messageScanner";
import { hapticLight, hapticMedium, hapticError } from "@/lib/haptics";
import { usePermissionRationale } from "@/hooks/usePermissionRationale";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";
import {
  uploadMessageAttachment,
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES) {
      toast.error(`File must be under ${Math.round(MESSAGE_ATTACHMENT_MAX_BYTES / 1024 / 1024)}MB`);
      return;
    }
    setStagedFile(file);
    setImagePreview(isImageMime(file.type) ? URL.createObjectURL(file) : null);
    // Reset input so re-selecting the same file fires onChange
    if (fileRef.current) fileRef.current.value = "";
  };

  const clearStaged = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setStagedFile(null);
    setImagePreview(null);
  };

  const uploadStaged = async (): Promise<SendAttachment | null> => {
    if (!stagedFile) return null;
    if (!jobId || !senderId) {
      toast.error("Missing chat context for upload");
      return null;
    }
    setUploading(true);
    const result = await uploadMessageAttachment(stagedFile, jobId, senderId);
    setUploading(false);
    if ("error" in result) {
      toast.error(result.error);
      // Clear the staged file + reset the native input so re-picking the
      // SAME file fires onChange again and the user can immediately retry.
      clearStaged();
      if (fileRef.current) fileRef.current.value = "";
      return null;
    }
    return { path: result.path, mime: result.mime, size: result.size };
  };

  const handleShareLocation = async () => {
    if (!navigator.geolocation) {
      toast.error("This device can't share location.");
      return;
    }
    // Soft pre-prompt before triggering the OS permission dialog.
    // Improves accept rates and keeps the OS prompt from being burned
    // by a panic-tap "deny."
    await requestPermission("location", () => {
      return new Promise<void>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            onSend(`📍 Location: https://maps.google.com/?q=${latitude},${longitude}`);
            resolve();
          },
          () => {
            toast.error("Location access denied");
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
            <div className="h-20 w-32 rounded-ds-sm border border-border bg-muted flex items-center gap-2 px-3">
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
      <div className="flex gap-1.5 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading}
          aria-label="Attach photo or PDF"
          title="Attach photo or PDF"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9"
          onClick={handleShareLocation}
          disabled={disabled || uploading}
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
          disabled={disabled || uploading}
        />
        {/* Voice-to-text mic — appended just before Send so the most
            frequent action (Send) keeps the rightmost slot. Mounts only
            on platforms with SpeechRecognition (degrades cleanly on web
            browsers without it and on Capacitor WebViews that don't
            expose it). Live red dot indicates an active session. */}
        {voice.supported && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 h-9 w-9 relative"
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
        <Button
          size="icon"
          onClick={handleSend}
          disabled={(!text.trim() && !stagedFile) || uploading || disabled}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

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
                Payments and conversations outside Helpr aren't protected by our dispute policy, escrow, or insurance.
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
