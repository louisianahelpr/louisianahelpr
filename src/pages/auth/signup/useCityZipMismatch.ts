import { useEffect, useState } from "react";
import { report } from "@/lib/errorLogger";

// Loaded alone, then called: work chained straight onto import() runs inside Vite's preload wrapper, where a
// failure reads as a broken chunk (dynamicImportThenDoesNoWork).
const loadCityZipMismatch = () => import("@/lib/cityZipMismatch");

/**
 * The hint needs the parish tables (9 KB gz), and only once a ZIP has resolved, so
 * they stay off the signup page's first download. A failed load only means no hint:
 * the hint is soft and never blocks signing up.
 */
export function useCityZipMismatch(location: string, resolvedZipParish: string | null | undefined) {
  const [cityZipMismatch, setCityZipMismatch] = useState<string | null>(null);
  useEffect(() => {
    if (!resolvedZipParish) {
      setCityZipMismatch(null);
      return;
    }
    let live = true;
    void loadCityZipMismatch().then(
      ({ cityZipMismatchHint }) => {
        if (live) setCityZipMismatch(cityZipMismatchHint(location, resolvedZipParish));
      },
      (err: unknown) => report(err, { severity: "warning", tags: { source: "Signup.cityZipMismatch" } }),
    );
    return () => {
      live = false;
    };
  }, [location, resolvedZipParish]);
  return cityZipMismatch;
}
