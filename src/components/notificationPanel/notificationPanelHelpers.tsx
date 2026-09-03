import { Check, Info, AlertTriangle, DollarSign, Users, Star, MessageCircle, Truck, Wrench, Sparkles, ShieldCheck, ShieldAlert, Megaphone } from "lucide-react";
import type { Notification } from "./types";

export const typeIcons: Record<string, React.ReactNode> = {
  info: <Info className="w-4 h-4 text-muted-foreground" />,
  success: <Check className="w-4 h-4 text-primary" />,
  warning: <AlertTriangle className="w-4 h-4 text-accent" />,
  application: <Users className="w-4 h-4 text-primary" />,
  payment: <DollarSign className="w-4 h-4 text-primary" />,
  review: <Star className="w-4 h-4 text-accent" />,
  job_update: <Info className="w-4 h-4 text-primary" />,
  job_updates: <Info className="w-4 h-4 text-primary" />,
  message: <MessageCircle className="w-4 h-4 text-primary" />,
  transit_updates: <Truck className="w-4 h-4 text-primary" />,
  work_status: <Wrench className="w-4 h-4 text-primary" />,
  new_offers: <Sparkles className="w-4 h-4 text-accent" />,
  system_alert: <Megaphone className="w-4 h-4 text-accent" />,
  financial_alerts: <DollarSign className="w-4 h-4 text-primary" />,
  verified: <ShieldCheck className="w-4 h-4 text-primary" />,
  job_match: <Sparkles className="w-4 h-4 text-primary" />,
  expired: <AlertTriangle className="w-4 h-4 text-muted-foreground" />,
  // Operator mail — only admins ever receive it, but it renders in the same
  // notification centre as everything else, so it needs its own glyph.
  admin_alert: <ShieldAlert className="w-4 h-4 text-accent" />,
};

const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

// Bucket notifications by relative day so the feed reads as a journal
// rather than a flat list. Today / Yesterday / This week / Earlier.
export const groupByDay = (items: Notification[]) => {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const buckets: { key: string; label: string; items: Notification[] }[] = [
    { key: "today", label: "Today", items: [] },
    { key: "yesterday", label: "Yesterday", items: [] },
    { key: "week", label: "This week", items: [] },
    { key: "earlier", label: "Earlier", items: [] },
  ];

  for (const n of items) {
    const t = new Date(n.created_at);
    if (t >= today) buckets[0].items.push(n);
    else if (t >= yesterday) buckets[1].items.push(n);
    else if (t >= weekAgo) buckets[2].items.push(n);
    else buckets[3].items.push(n);
  }

  return buckets.filter((b) => b.items.length > 0);
};

export const timeAgo = (date: string) => {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};
