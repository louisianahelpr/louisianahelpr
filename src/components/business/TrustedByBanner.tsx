import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AnimatedCounter } from "@/components/AnimatedCounter";

/**
 * "Trusted by N businesses" — small banner near the hero. We fetch a
 * `count(*) from businesses` head-query; if it errors (PGRST or RLS),
 * comes back null, or returns fewer than five, we fall back to copy
 * that doesn't lean on a too-small number.
 */
const MIN_VISIBLE = 5;

export function TrustedByBanner() {
  const [count, setCount] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `head: true` with `count: 'exact'` returns just the count without
      // ferrying back any rows — RLS-friendly and cheap.
      const { count: c, error } = await supabase
        .from("businesses")
        .select("id", { count: "exact", head: true });
      if (cancelled) return;
      if (error) {
        // Swallow silently — banner just falls back to generic copy.
        setCount(null);
      } else {
        setCount(c ?? 0);
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showCount = loaded && count !== null && count >= MIN_VISIBLE;

  return (
    <div
      className="inline-flex items-center gap-2.5 rounded-full px-4 py-2"
      style={{
        background: "hsl(var(--bark) / 0.08)",
        border: "1px solid hsl(var(--olivewood) / 0.12)",
      }}
      data-testid="trusted-by-banner"
    >
      <Building2
        className="w-4 h-4"
        style={{ color: "hsl(var(--bark))" }}
        strokeWidth={1.75}
      />
      {showCount ? (
        <p
          className="text-ds-13 font-sans"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          Trusted by{" "}
          <AnimatedCounter
            value={count ?? 0}
            decimals={0}
            className="font-bold tabular-nums"
          />{" "}
          Louisiana businesses
        </p>
      ) : (
        <p
          className="text-ds-13 font-sans"
          style={{ color: "hsl(var(--ink-deep))" }}
        >
          Join the businesses streamlining their gig labor
        </p>
      )}
    </div>
  );
}

export default TrustedByBanner;
