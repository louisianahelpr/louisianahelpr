/**
 * /shops/mine: open or edit the member's one free shop (L4, L53). Name,
 * category (the fixed list, L54), about, area (a town or neighborhood, never
 * an address; the pin is placed from it, L50), storefront, parishes served,
 * what the shop offers (selling, quotes, or both, L53), the optional
 * Secretary of State number (L56), opening hours, logo, cover and photos.
 * No phone, email or website field (L49); the server also rejects them typed
 * into the text.
 *
 * Who may save is decided on the server (18+, not banned, fewer than 3
 * marketplace strikes, payout setup finished: L3, L45, L82); this screen
 * shows the server's words when it refuses.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { geocodeAddress } from "@/lib/geocode";
import { PARISHES } from "@/lib/parishes";
import {
  addShopPhoto,
  closeMyShop,
  fetchMyShopId,
  fetchShop,
  removeShopPhoto,
  saveMyShop,
  setShopHours,
  shopPhotoUrl,
  type ShopHour,
  type ShopPhotoKind,
} from "@/lib/shops/api";
import { shopsErrorMessage } from "@/lib/shops/errors";
import { categoryGroups, ShopsNotice, useShopCategories, WEEKDAYS } from "./shopsUi";

interface Form {
  name: string;
  about: string;
  category: string;
  areaLabel: string;
  storefront: boolean;
  parishes: string[];
  offersSelling: boolean;
  offersQuotes: boolean;
  sosNumber: string;
  hours: Record<number, { open: boolean; opens: string; closes: string }>;
}

const EMPTY_HOURS = (): Form["hours"] =>
  Object.fromEntries(WEEKDAYS.map((_, i) => [i, { open: false, opens: "09:00", closes: "17:00" }]));

const EMPTY: Form = {
  name: "",
  about: "",
  category: "",
  areaLabel: "",
  storefront: false,
  parishes: [],
  offersSelling: true,
  offersQuotes: false,
  sosNumber: "",
  hours: EMPTY_HOURS(),
};

function ShopEditSkeleton() {
  return (
    <AppPage title="My shop" backTo="/shops">
      <div className="space-y-4" role="status" aria-label="Loading your shop">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </AppPage>
  );
}

function PhotoPicker({ label, kind, onPick, busy }: { label: string; kind: ShopPhotoKind; onPick: (k: ShopPhotoKind, f: File) => void; busy: boolean }) {
  return (
    <label className="inline-flex">
      <span className="sr-only">{label}</span>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPick(kind, f);
        }}
      />
      <span className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-sm cursor-pointer" aria-hidden>
        {label}
      </span>
    </label>
  );
}

export default function ShopEditView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useCurrentUser();
  const categories = useShopCategories();
  const myId = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const shop = useQuery({
    queryKey: ["shops", "page", myId.data],
    queryFn: () => fetchShop(myId.data as string),
    enabled: !!myId.data,
  });
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    if (loaded || !shop.data) return;
    const s = shop.data;
    const hours = EMPTY_HOURS();
    for (const h of s.hours) hours[h.weekday] = { open: true, opens: h.opens, closes: h.closes };
    setForm({
      name: s.name,
      about: s.about,
      category: s.category,
      areaLabel: s.area_label,
      storefront: s.storefront,
      parishes: s.parishes_served,
      offersSelling: s.offers_selling,
      offersQuotes: s.offers_quotes,
      sosNumber: s.sos_number ?? "",
      hours,
    });
    setLoaded(true);
  }, [shop.data, loaded]);

  const groups = useMemo(() => categoryGroups(categories.data), [categories.data]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      // The pin comes from the area (L50): the server rounds a home maker's to ~1 km.
      const place = await geocodeAddress(`${form.areaLabel.trim()}, Louisiana`);
      if (!place) throw new Error("invalid_location");
      const id = await saveMyShop({
        name: form.name,
        about: form.about,
        category: form.category,
        parishesServed: form.parishes,
        areaLabel: form.areaLabel,
        storefront: form.storefront,
        pinLat: place.latitude,
        pinLng: place.longitude,
        offersSelling: form.offersSelling,
        offersQuotes: form.offersQuotes,
        sosNumber: form.sosNumber,
      });
      const hours: ShopHour[] = Object.entries(form.hours)
        .filter(([, h]) => h.open)
        .map(([d, h]) => ({ weekday: Number(d), opens: h.opens, closes: h.closes }));
      await setShopHours(hours);
      return id;
    },
    onSuccess: (id) => {
      toast.success(myId.data ? "Your shop is saved." : "Your shop is open.");
      void qc.invalidateQueries({ queryKey: ["shops"] });
      navigate(`/shops/${id}`);
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  const photo = useMutation({
    mutationFn: ({ kind, file }: { kind: ShopPhotoKind; file: File }) => addShopPhoto(user?.id ?? "", kind, file),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shops", "page", myId.data] }),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const unphoto = useMutation({
    mutationFn: (photoId: string) => removeShopPhoto(photoId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["shops", "page", myId.data] }),
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });
  const close = useMutation({
    mutationFn: closeMyShop,
    onSuccess: () => {
      setConfirmClose(false);
      toast.success("Your shop is closed.");
      void qc.invalidateQueries({ queryKey: ["shops"] });
      navigate("/shops");
    },
    onError: (err) => toast.error(shopsErrorMessage(err)),
  });

  if (myId.isLoading || categories.isLoading || (myId.data && shop.isLoading)) return <ShopEditSkeleton />;
  if (myId.isError || categories.isError || shop.isError) {
    return (
      <AppPage title="My shop" backTo="/shops">
        <ShopsNotice title="We couldn't load your shop." tone="warn">
          <p>{shopsErrorMessage(myId.error ?? categories.error ?? shop.error)}</p>
        </ShopsNotice>
      </AppPage>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  const photos = shop.data?.photos ?? [];
  const busy = photo.isPending || unphoto.isPending;

  return (
    <AppPage title={myId.data ? "Edit my shop" : "Open a shop"} backTo="/shops">
      <form className="space-y-5 pb-8" onSubmit={onSubmit} noValidate>
        {!myId.data && (
          <p className="text-sm text-muted-foreground">
            A shop is free, and it is also your business profile. You need to be 18 or older and have payouts set up.
          </p>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="shop-name">Shop or business name</Label>
          <Input id="shop-name" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shop-category">Category</Label>
          <select
            id="shop-category"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-base sm:text-sm"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            required
          >
            <option value="" disabled>Choose a category</option>
            {groups.map((g) => (
              <optgroup key={g.slug} label={g.label}>
                {g.items.map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shop-about">About</Label>
          <Textarea id="shop-about" value={form.about} maxLength={2000} rows={5} onChange={(e) => set("about", e.target.value)} />
          <p className="text-xs text-muted-foreground">No phone numbers, emails or websites: members reach you in the app.</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shop-area">Town or neighborhood</Label>
          <Input id="shop-area" value={form.areaLabel} maxLength={80} placeholder="Broussard" onChange={(e) => set("areaLabel", e.target.value)} required />
          <p className="text-xs text-muted-foreground">Never your street address. Your pin shows the area, not your house.</p>
        </div>
        <div className="flex items-start gap-2">
          <Checkbox id="shop-storefront" checked={form.storefront} onCheckedChange={(v) => set("storefront", v === true)} />
          <Label htmlFor="shop-storefront" className="font-normal leading-snug">
            I have a storefront people can visit (the pin shows its exact place)
          </Label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">What your shop offers</legend>
          <div className="flex items-center gap-2">
            <Checkbox id="shop-selling" checked={form.offersSelling} onCheckedChange={(v) => set("offersSelling", v === true)} />
            <Label htmlFor="shop-selling" className="font-normal">Selling things I make or have</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="shop-quotes" checked={form.offersQuotes} onCheckedChange={(v) => set("offersQuotes", v === true)} />
            <Label htmlFor="shop-quotes" className="font-normal">Quotes for work</Label>
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Parishes you serve</legend>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[...PARISHES].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
              const id = `parish-${p.slug}`;
              const on = form.parishes.includes(p.name);
              return (
                <div key={p.slug} className="flex items-center gap-2 min-w-0">
                  <Checkbox
                    id={id}
                    checked={on}
                    onCheckedChange={(v) => set("parishes", v === true ? [...form.parishes, p.name] : form.parishes.filter((x) => x !== p.name))}
                  />
                  <Label htmlFor={id} className="font-normal truncate">{p.name}</Label>
                </div>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Open days and hours</legend>
          {WEEKDAYS.map((day, i) => {
            const h = form.hours[i];
            return (
              <div key={day} className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 w-32">
                  <Checkbox
                    id={`open-${i}`}
                    checked={h.open}
                    onCheckedChange={(v) => set("hours", { ...form.hours, [i]: { ...h, open: v === true } })}
                  />
                  <Label htmlFor={`open-${i}`} className="font-normal">{day}</Label>
                </div>
                {h.open && (
                  <>
                    <Input
                      type="time"
                      aria-label={`${day} opens`}
                      className="w-32"
                      value={h.opens}
                      onChange={(e) => set("hours", { ...form.hours, [i]: { ...h, opens: e.target.value } })}
                    />
                    <span className="text-sm text-muted-foreground">to</span>
                    <Input
                      type="time"
                      aria-label={`${day} closes`}
                      className="w-32"
                      value={h.closes}
                      onChange={(e) => set("hours", { ...form.hours, [i]: { ...h, closes: e.target.value } })}
                    />
                  </>
                )}
              </div>
            );
          })}
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor="shop-sos">Louisiana Secretary of State number (optional)</Label>
          <Input id="shop-sos" value={form.sosNumber} maxLength={20} onChange={(e) => set("sosNumber", e.target.value)} />
          <p className="text-xs text-muted-foreground">Once we check it, your shop shows "Registered business". A shop without one is still welcome.</p>
        </div>
        {myId.data && (
          <section className="space-y-2" aria-labelledby="shop-edit-photos">
            <h2 id="shop-edit-photos" className="text-sm font-medium">Logo, cover and photos</h2>
            <div className="flex flex-wrap gap-2">
              <PhotoPicker label="Choose logo" kind="logo" busy={busy} onPick={(kind, file) => photo.mutate({ kind, file })} />
              <PhotoPicker label="Choose cover" kind="cover" busy={busy} onPick={(kind, file) => photo.mutate({ kind, file })} />
              <PhotoPicker label="Add a photo" kind="gallery" busy={busy} onPick={(kind, file) => photo.mutate({ kind, file })} />
            </div>
            {photos.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {photos.map((p) => (
                  <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                    <img src={shopPhotoUrl(p.storage_path)} alt="" className="h-full w-full object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-background/90 px-1.5 text-ds-11">
                      {p.kind === "logo" ? "Logo" : p.kind === "cover" ? "Cover" : "Photo"}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="absolute bottom-1 right-1 px-2 text-xs"
                      disabled={busy}
                      onClick={() => unphoto.mutate(p.id)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <Button type="submit" className="btn-grad-primary w-full" disabled={save.isPending}>
          {save.isPending ? "Saving…" : myId.data ? "Save my shop" : "Open my shop"}
        </Button>
        {myId.data && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={close.isPending}
            onClick={() => setConfirmClose(true)}
          >
            Close my shop
          </Button>
        )}
      </form>
      {/* The app's own confirm, never window.confirm (off-brand and
          unreliable inside the iOS WebView; SecurityTab). */}
      <BrandConfirmDialog
        open={confirmClose}
        onOpenChange={(next) => {
          if (!close.isPending) setConfirmClose(next);
        }}
        title="Close your shop?"
        description="Its page, photos and followers are removed. You can open a new shop later."
        primaryLabel={close.isPending ? "Closing…" : "Close my shop"}
        primaryTone="sienna"
        primaryDisabled={close.isPending}
        onPrimary={(e) => {
          e.preventDefault();
          close.mutate();
        }}
        secondaryLabel="Cancel"
      />
    </AppPage>
  );
}
