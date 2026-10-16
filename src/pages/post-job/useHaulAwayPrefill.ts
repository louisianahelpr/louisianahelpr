import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useFeature } from "@/hooks/useFeature";
import { report } from "@/lib/errorLogger";
import { parseHaulAwayParam } from "@/lib/declutter/haulAwayParam";
import { parseLocationIntoFields } from "./postJobFormHelpers";

interface Setters {
  setCategory: (v: string) => void;
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setBudget: (v: string) => void;
  setStreetAddress: (v: string) => void;
  setCity: (v: string) => void;
  setAddrState: (v: string) => void;
  setZipCode: (v: string) => void;
  setRequirePhotoProof: (v: boolean) => void;
  addPrefillImages: (files: File[]) => void;
}

/**
 * The Declutter modules load only when Post a Job is opened for a haul-away:
 * they stay off every other route's critical path (Q178 budget).
 */
const declutter = () =>
  Promise.all([import("@/lib/declutter/api"), import("@/lib/declutter/errors"), import("@/lib/declutter/haulAway")]).then(
    ([api, errors, haul]) => ({ ...api, ...errors, ...haul }),
  );

/** A listing photo (public job-photos bucket) as a File the job's upload takes. Null when it can't be read. */
async function photoFile(path: string, photoPublicUrl: (p: string) => string): Promise<File | null> {
  try {
    const res = await fetch(photoPublicUrl(path));
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], path.split("/").pop() ?? "photo.jpg", { type: blob.type || "image/jpeg" });
  } catch (err) {
    // A photo that can't be copied only means the job has fewer photos; the
    // seller can add them on the form.
    report(err, { severity: "warning", tags: { source: "useHaulAwayPrefill.photo" } });
    return null;
  }
}

/**
 * Declutter haul-away (docs/specs/declutter-haul-away.md): `?haulAway=<ids>`
 * pre-fills a moving job from the seller's unsold listing(s): title, the list
 * of items with their sizes, the suggested pay, the pickup address, the
 * listing photos, and before/after photos ON (the Helpr's after photo is the
 * proof at drop-off). The seller checks it and pays like any job.
 *
 * Returns the item ids once the prefill loaded, so the submit links exactly
 * those items to the new job (declutter_link_haul_away), or null.
 */
export function useHaulAwayPrefill(searchParams: URLSearchParams, s: Setters): string[] | null {
  const on = useFeature("declutter_haul_away");
  const raw = searchParams.get("haulAway");
  const [itemIds, setItemIds] = useState<string[] | null>(null);
  // Applied once per link: the switch can read false then true again (a failed
  // refetch), and re-applying would overwrite the seller's edits and add the
  // photos twice.
  const applied = useRef<string | null>(null);

  useEffect(() => {
    if (!on || !raw || applied.current === raw) return;
    const ids = parseHaulAwayParam(raw);
    if (ids.length === 0) return;
    applied.current = raw;
    let live = true;
    const failed = (err: unknown, words: (e: unknown) => string) => {
      report(err, { severity: "warning", tags: { source: "useHaulAwayPrefill" } });
      if (live) toast.error(`Couldn't load your items: ${words(err)}`);
    };
    declutter().then(async (d) => {
      let rows;
      try {
        rows = await d.fetchHaulAwayState(ids);
      } catch (err) {
        // Not silent: failed() reports it and tells the seller.
        failed(err, d.declutterErrorMessage);
        return;
      }
      if (!live) return;
      const p = d.buildHaulAwayPrefill(rows);
      if (!p) {
        toast(rows.some((r) => r.state === "booked" || r.state === "paying")
          ? "A Helpr is already booked, or a checkout is open, for this haul-away."
          : "These items can't be hauled away right now.");
        return;
      }
      const left = rows.length - p.itemIds.length;
      if (left > 0) toast(`${left} ${left === 1 ? "item" : "items"} couldn't be included (sold, booked, or not ready yet).`);
      s.setCategory("moving");
      s.setTitle(p.title);
      s.setDescription(p.description);
      s.setBudget(p.budget);
      s.setRequirePhotoProof(true);
      setItemIds(p.itemIds);
      const priv = await d.fetchMyItemPrivate(p.itemIds[0]).catch((err) => {
        report(err, { severity: "warning", tags: { source: "useHaulAwayPrefill.address" } });
        if (live) toast.error("Couldn't load the pickup address. Type it in below.");
        return null;
      });
      if (!live) return;
      if (priv?.pickup_address) {
        const loc = parseLocationIntoFields(priv.pickup_address);
        if (loc.city !== undefined) {
          s.setStreetAddress(loc.streetAddress);
          s.setCity(loc.city);
          s.setAddrState(loc.addrState ?? "LA");
          s.setZipCode(loc.zipCode ?? "");
        } else {
          // Not split into parts: the whole address in the street line, and
          // no city left over from the profile's smart default.
          s.setStreetAddress(priv.pickup_address);
          s.setCity("");
        }
      }
      const files = (await Promise.all(p.photoPaths.map((path) => photoFile(path, d.photoPublicUrl)))).filter((f): f is File => !!f);
      if (live && files.length > 0) s.addPrefillImages(files);
    }, (err) => failed(err, () => "please try again."));
    return () => { live = false; };
    // The setters are stable; the switch and the param are the triggers.
  }, [on, raw]);

  return itemIds;
}
