import { Star } from "lucide-react";

export const MiniStars = ({ value }: { value: number }) => (
  <div role="img" aria-label={`${Number.isInteger(value) ? value : value.toFixed(1)} out of 5 stars`} className="flex">
    {[1, 2, 3, 4, 5].map((s) => (
      <Star key={s} className={`w-3 h-3 ${s <= Math.round(value) ? "fill-accent text-accent" : "text-muted-foreground/30"}`} />
    ))}
  </div>
);
