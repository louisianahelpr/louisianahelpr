import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * A small "trusted by these Louisiana businesses" name strip. Like
 * {@link TrustedByBanner} it is data-gated: it only ever shows the names of
 * businesses that have actually verified on the platform, and renders nothing
 * at all unless there are at least MIN_FEATURED of them. That keeps the
 * marketing surface honest — no fabricated logos, no thin "trusted by 2"
 * walls — and it self-activates once enough real verified businesses exist.
 */
const MIN_FEATURED = 6;
const MAX_SHOWN = 12;

export function FeaturedBusinesses() {
  const [names, setNames] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("businesses")
        .select("name")
        .eq("verification_status", "verified")
        .order("created_at", { ascending: true })
        .limit(MAX_SHOWN);
      if (cancelled) return;
      if (error) {
        setNames(null);
        return;
      }
      const cleaned = (data ?? [])
        .map((r) => (r.name ?? "").trim())
        .filter((n) => n.length > 0);
      setNames(cleaned);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!names || names.length < MIN_FEATURED) return null;

  return (
    <section className="text-center py-6" data-testid="featured-businesses">
      <p
        className="text-display-eyebrow mb-4"
        style={{ color: "hsl(var(--olivewood) / 0.8)" }}
      >
        Trusted by Louisiana businesses
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2.5">
        {names.map((name) => (
          <span
            key={name}
            className="rounded-full px-4 py-2 text-ds-13 font-sans font-medium"
            style={{
              background: "hsl(var(--bark) / 0.07)",
              border: "1px solid hsl(var(--olivewood) / 0.14)",
              color: "hsl(var(--ink-deep))",
            }}
          >
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

export default FeaturedBusinesses;
