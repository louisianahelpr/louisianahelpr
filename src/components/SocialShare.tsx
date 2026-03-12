import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Facebook, Link2, Check } from "lucide-react";
import { toast } from "sonner";

interface SocialShareProps {
  url?: string;
  text?: string;
  compact?: boolean;
}

const SocialShare = ({ 
  url = "https://louisianahelpr.lovable.app", 
  text = "Check out Helpr — Louisiana's helping hand for everyday tasks!",
  compact = false,
}: SocialShareProps) => {
  const [copied, setCopied] = useState(false);

  const encodedUrl = encodeURIComponent(url);

  const facebookLink = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;

  const copyLink = () => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="icon" className="h-8 w-8" asChild>
          <a href={facebookLink} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
            <Facebook className="w-3.5 h-3.5" />
          </a>
        </Button>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={copyLink}>
          {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" asChild>
        <a href={facebookLink} target="_blank" rel="noopener noreferrer">
          <Facebook className="w-4 h-4 mr-1.5" /> Facebook
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={copyLink}>
        {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Link2 className="w-4 h-4 mr-1.5" />}
        {copied ? "Copied!" : "Copy link"}
      </Button>
    </div>
  );
};

export default SocialShare;
