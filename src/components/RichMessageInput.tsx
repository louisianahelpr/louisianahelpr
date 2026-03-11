import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, ImagePlus, MapPin, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RichMessageInputProps {
  onSend: (content: string) => void;
  onTyping?: () => void;
  disabled?: boolean;
}

export const RichMessageInput = ({ onSend, onTyping, disabled }: RichMessageInputProps) => {
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (): Promise<string | null> => {
    if (!imageFile) return null;
    setUploading(true);
    const ext = imageFile.name.split(".").pop();
    const path = `chat/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("job-photos").upload(path, imageFile);
    setUploading(false);
    if (error) {
      toast.error("Failed to upload image");
      return null;
    }
    const { data } = supabase.storage.from("job-photos").getPublicUrl(path);
    return data.publicUrl;
  };

  const handleShareLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation not supported");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        onSend(`📍 Location: https://maps.google.com/?q=${latitude},${longitude}`);
      },
      () => toast.error("Location access denied")
    );
  };

  const handleSend = async () => {
    if (uploading) return;
    
    if (imageFile) {
      const url = await uploadImage();
      if (url) {
        onSend(`📷 ${url}${text ? `\n${text}` : ""}`);
      }
      setImageFile(null);
      setImagePreview(null);
      setText("");
      return;
    }

    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <div className="space-y-2">
      {imagePreview && (
        <div className="relative inline-block">
          <img src={imagePreview} alt="Preview" className="h-20 w-20 rounded-lg object-cover border border-border" />
          <button
            onClick={() => { setImagePreview(null); setImageFile(null); }}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}
      <div className="flex gap-1.5 items-center">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
          title="Send photo"
        >
          <ImagePlus className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-9 w-9"
          onClick={handleShareLocation}
          disabled={disabled}
          title="Share location"
        >
          <MapPin className="w-4 h-4" />
        </Button>
        <Input
          placeholder="Type a message…"
          value={text}
          onChange={(e) => { setText(e.target.value); onTyping?.(); }}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          className="flex-1"
          disabled={disabled}
        />
        <Button size="icon" onClick={handleSend} disabled={(!text.trim() && !imageFile) || uploading || disabled}>
          <Send className="w-4 h-4" />
        </Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />
      </div>
    </div>
  );
};
