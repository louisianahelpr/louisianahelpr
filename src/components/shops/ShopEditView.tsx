/**
 * /shops/mine: open or edit the member's one free shop (L4, L53). Name,
 * category (the fixed list, L54), about, area (a town or neighborhood, never
 * an address; the pin is placed from it, L50), storefront, parishes served,
 * what the shop offers (selling, quotes, or both, L53), the optional
 * Secretary of State number (L56), opening hours, logo, cover and photos;
 * then the private pickup address (M1b part 2, ShopPickupAddressSection) and
 * the shop's items and daily order limit (slice 2, ShopItemsSection).
 * No phone, email or website field (L49); the server also rejects them typed
 * into the text.
 *
 * Who may save is decided on the server (18+, not banned, fewer than 3
 * Shops strikes (per section, owner 2026-10-18): L82); this screen shows the
 * server's words when it refuses. Payout setup is NOT a gate: it happens only
 * when a sale is owed (owner 2026-10-27, migration 20261027163240), so the
 * intro says so (audit 2026-10-28 P5-1).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { hasInAppHistory } from "@/lib/inAppHistory";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { confirmConsequential } from "@/lib/toastPolicy";
import AppPage from "@/components/AppPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { BrandConfirmDialog } from "@/components/ui/BrandConfirmDialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { geocodeAddress } from "@/lib/geocode";
import { PARISHES, parishByName, parishForCity } from "@/lib/parishes";
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
import { fetchCustomOrders, setCustomOrders } from "@/lib/shops/orders";
import { categoryGroups, useShopCategories, WEEKDAYS } from "./shopsUi";
import { ShopCategoryQuickPick } from "./ShopCategoryQuickPick";
import ShopItemsSection from "./ShopItemsSection";
import ShopPickupAddressSection from "./ShopPickupAddressSection";
import ShopFaqsEditor from "./ShopFaqsEditor";
import { UnsavedSectionsProvider } from "./unsavedSections";
import ShopPermitSection from "./ShopPermitSection";
import ShopOpenIntro from "./ShopOpenIntro";
import { EMPTY, EMPTY_HOURS, FIELD_ORDER, FieldError, type FieldErrors, type FieldKey, fieldOfError, focusField, type Form, invalidProps, validate } from "./shopEditForm";

/**
 * Builder 1 Shops pass (11-10): at 1440 every field on /shops/mine ran the full ~1600px column (a one-word town in a
 * 1590px box). The page column stays full width (src/lib/pageColumn.ts); the form and the field sections that save on
 * their own carry a LINE measure, as Edit profile's fields do. The items list below them keeps the column.
 * Guard: src/test/shopEditFormMeasure.test.ts.
 */
const SHOP_FORM_MEASURE = "max-w-[40rem]";

/**
 * Q2558: the placeholder IS the "Open a shop" form (the shorter of the two shapes), rendered invisible under one
 * bone, so it is that form's height at every width and theme; a fixed min-height (1472px on 2026-11-02) went stale
 * as the form grew (1760px by 2026-11-05). An existing shop's longer page grows below it.
 */
function ShopEditSkeleton({ children }: { children: ReactNode }) {
  return (
    <div className="relative" role="status" aria-label="Loading your shop">
      <div className="invisible" aria-hidden>
        {children}
      </div>
      <Skeleton className="absolute inset-0 rounded-xl" />
    </div>
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
      <span className="inline-flex h-9 items-center rounded-md border border-input bg-background px-3 text-ds-13 cursor-pointer" aria-hidden>
        {label}
      </span>
    </label>
  );
}

export default function ShopEditView() {
  const navigate = useNavigate();
  // The shop page's "Add an item" (an owner's empty shop) opens the item editor here.
  const location = useLocation();
  const startAdding = location.hash === "#add-item";
  const qc = useQueryClient();
  const { user, profile } = useCurrentUser();
  const categories = useShopCategories();
  const myId = useQuery({ queryKey: ["shops", "mine"], queryFn: fetchMyShopId });
  const shop = useQuery({
    queryKey: ["shops", "page", myId.data],
    queryFn: () => fetchShop(myId.data as string),
    enabled: !!myId.data,
  });
  // S2-034 (Shops audit 2): custom orders have ONE switch, shops.custom_orders (the dashboard picker and the server's
  // request check read it). The "Custom orders" box here shows and sets that same switch; offers_quotes only follows it.
  const customMode = useQuery({
    queryKey: ["shops", "custom-orders", myId.data],
    queryFn: () => fetchCustomOrders(myId.data as string),
    enabled: !!myId.data,
  });
  const [form, setForm] = useState<Form>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  // S2-041 (Shops audit 2): the sections that save on their own report unsaved edits here. The main save then stays
  // on the page and names them instead of leaving (which lost them), and closing the tab warns.
  const loadedForm = useRef<string | null>(null);
  const [dirtySections, setDirtySections] = useState<string[]>([]);
  const onSectionsChange = useCallback((d: string[]) => setDirtySections(d), []);
  const [stillUnsaved, setStillUnsaved] = useState<string[] | null>(null);
  // The back arrow asks before throwing unsaved edits away (as the item editor's Cancel does, S2-007).
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leave = () => (hasInAppHistory(location.key) ? navigate(-1) : navigate("/shops"));
  const mainDirty = loaded && loadedForm.current !== null && JSON.stringify(form) !== loadedForm.current;
  const anyUnsaved = mainDirty || dirtySections.length > 0;
  useEffect(() => {
    if (!anyUnsaved) return;
    const warnNow = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warnNow);
    return () => window.removeEventListener("beforeunload", warnNow);
  }, [anyUnsaved]);
  const [confirmClose, setConfirmClose] = useState(false);
  // Shops audit 11-10 F4: "Add an item" is its own screen; the item section names it ("Add an item", then "Edit item").
  const [itemTitle, setItemTitle] = useState("Add an item");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showAllParishes, setShowAllParishes] = useState(false);
  // F6: the optional business number waits behind one tap unless the shop already has one.
  const [showSos, setShowSos] = useState(false);
  // A new shop's parish follows its town (or the member's own parish) until the owner picks parishes themselves (F6).
  const [parishesTouched, setParishesTouched] = useState(false);
  const homeParish = parishByName((profile as { parish?: string | null } | null)?.parish ?? null)?.name ?? null;
  useEffect(() => {
    if (myId.data || myId.isLoading || parishesTouched) return;
    const fromTown = parishForCity(form.areaLabel)?.name ?? null;
    const pick = fromTown ?? homeParish;
    setForm((f) => (pick && !(f.parishes.length === 1 && f.parishes[0] === pick) ? { ...f, parishes: [pick] } : f));
  }, [form.areaLabel, homeParish, myId.data, myId.isLoading, parishesTouched]);

  useEffect(() => {
    // A failed custom-order read never blocks the form: the box then shows the saved offers_quotes and Save leaves
    // the switch alone.
    if (loaded || !shop.data || customMode.isLoading) return;
    const s = shop.data;
    const hours = EMPTY_HOURS();
    for (const h of s.hours) hours[h.weekday] = { open: true, opens: h.opens, closes: h.closes };
    const next: Form = {
      name: s.name,
      about: s.about,
      category: s.category,
      areaLabel: s.area_label,
      storefront: s.storefront,
      parishes: s.parishes_served,
      offersSelling: s.offers_selling,
      offersQuotes: customMode.data ? customMode.data !== "off" : s.offers_quotes,
      sosNumber: s.sos_number ?? "",
      hours,
    };
    loadedForm.current = JSON.stringify(next);
    setForm(next);
    setLoaded(true);
  }, [shop.data, customMode.data, customMode.isLoading, loaded]);

  const groups = useMemo(() => categoryGroups(categories.data), [categories.data]);
  const FIELD_OF_FORM_KEY: Partial<Record<keyof Form, FieldKey>> = {
    name: "name", category: "category", about: "about", areaLabel: "area", offersSelling: "offers", offersQuotes: "offers",
    parishes: "parishes", hours: "hours", sosNumber: "sos",
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    const field = FIELD_OF_FORM_KEY[k];
    if (field) setErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
    if (k === "parishes") setParishesTouched(true);
    setFormError(null);
  };

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
      // S2-034: the box turns the one custom-order switch on (paid in full, changeable on the dashboard) or off.
      // A new shop has no switch yet (off); an existing one whose read failed is left as it is.
      const known = myId.data ? customMode.data : "off";
      if (known && form.offersQuotes !== (known !== "off")) await setCustomOrders(form.offersQuotes ? "full_hold" : "off");
      return id;
    },
    onSuccess: (id) => {
      // Opening a shop puts it in front of every member, so it is confirmed through the one
      // channel the toast policy lets render (audit 2026-10-28 P5-9: toast.success is a no-op
      // at boot, so "Your shop is open." never showed). A later save stays silent: the form is the answer.
      if (myId.data) toast.success("Your shop is saved.");
      else confirmConsequential("Your shop is open.");
      void qc.invalidateQueries({ queryKey: ["shops"] });
      // S2-041: other sections still hold unsaved edits: stay, and name them, instead of leaving and losing them.
      if (myId.data && dirtySections.length > 0) {
        loadedForm.current = JSON.stringify(form);
        setStillUnsaved(dirtySections);
        return;
      }
      navigate(`/shops/${id}`);
    },
    onError: (err) => {
      // F2: beside the field it is about, or under the button; never a toast that stacks over the form.
      const field = fieldOfError(err);
      const msg = shopsErrorMessage(err);
      if (field) {
        setErrors({ [field]: msg });
        focusField(field);
      } else {
        setFormError(msg);
      }
    },
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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    toast.dismiss(); // F2: no stale toast from an earlier try stays on screen
    setFormError(null);
    const found = validate(form);
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      focusField(first);
      return;
    }
    save.mutate();
  };
  const photos = shop.data?.photos ?? [];
  const busy = photo.isPending || unphoto.isPending;

  const formEl = (
  <form className={`space-y-5 pb-8 ${SHOP_FORM_MEASURE}`} onSubmit={onSubmit} noValidate>
    {!myId.data && (
      <ShopOpenIntro />
    )}
    <div className="space-y-1.5">
      <Label htmlFor="shop-name">Shop or business name</Label>
      <Input id="shop-name" value={form.name} maxLength={60} onChange={(e) => set("name", e.target.value)} required {...invalidProps("name", errors)} />
      <FieldError field="name" errors={errors} />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="shop-category">Category</Label>
      <ShopCategoryQuickPick id="shop-category" value={form.category} onChange={(slug) => set("category", slug)} groups={groups}
        invalid={!!errors.category} describedBy={errors.category ? "shop-category-error" : undefined} />
      <FieldError field="category" errors={errors} />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="shop-about">About</Label>
      <Textarea id="shop-about" value={form.about} maxLength={2000} rows={5} onChange={(e) => set("about", e.target.value)} {...invalidProps("about", errors)} />
      <FieldError field="about" errors={errors} />
      <p className="text-ds-11 text-muted-foreground">No phone numbers, emails or websites: Shops does not allow contact details.</p>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="shop-area">Town or neighborhood</Label>
      <Input id="shop-area" value={form.areaLabel} maxLength={80} placeholder="e.g. Broussard"
        onChange={(e) => set("areaLabel", e.target.value)} required {...invalidProps("area", errors)} />
      <FieldError field="area" errors={errors} />
      <p className="text-ds-11 text-muted-foreground">Never your street address. Your pin shows the area, not your house.</p>
    </div>
    <div className="flex items-start gap-2">
      <Checkbox id="shop-storefront" checked={form.storefront} onCheckedChange={(v) => set("storefront", v === true)} />
      <Label htmlFor="shop-storefront" className="block min-h-11 flex-1 font-normal leading-snug">
        I have a storefront people can visit (the pin shows its exact place)
      </Label>
    </div>
    <fieldset className="space-y-2">
      <legend className="text-ds-13 font-medium">What your shop offers</legend>
      <div className="flex items-center gap-2">
        <Checkbox id="shop-selling" checked={form.offersSelling} onCheckedChange={(v) => set("offersSelling", v === true)} />
        <Label htmlFor="shop-selling" className="flex min-h-11 flex-1 items-center font-normal">Selling things I make or have</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="shop-quotes" checked={form.offersQuotes} onCheckedChange={(v) => set("offersQuotes", v === true)} />
        <Label htmlFor="shop-quotes" className="flex min-h-11 flex-1 flex-col justify-center font-normal leading-snug">
          <span>Custom orders (made to order)</span>
          <span className="text-ds-11 text-muted-foreground">Buyers can ask you for something made just for them. How they pay is on your dashboard.</span>
        </Label>
      </div>
      <FieldError field="offers" errors={errors} />
    </fieldset>
    <fieldset id="shop-parishes" tabIndex={-1} className="space-y-2" {...invalidProps("parishes", errors)}>
      <legend className="text-ds-13 font-medium">Parishes you serve</legend>
      {form.parishes.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Parishes picked">
          {form.parishes.map((name) => (
            <li key={name} className="inline-flex items-center gap-1 rounded-full border border-border bg-card pl-3 text-ds-13">
              {name}
              <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground"
                aria-label={`Remove ${name}`} onClick={() => set("parishes", form.parishes.filter((x) => x !== name))}>×</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ds-13 text-muted-foreground">None picked yet. Type your town above and its parish is picked for you.</p>
      )}
      <Button type="button" variant="outline" size="sm" aria-expanded={showAllParishes} onClick={() => setShowAllParishes((v) => !v)}>
        {showAllParishes ? "Done adding parishes" : "Add other parishes"}
      </Button>
      <FieldError field="parishes" errors={errors} />
      {showAllParishes && (
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
              <Label htmlFor={id} className="block min-h-11 min-w-0 flex-1 truncate py-3 font-normal">{p.name}</Label>
            </div>
          );
        })}
      </div>
      )}
    </fieldset>
    <fieldset id="shop-hours" tabIndex={-1} className="space-y-2" {...invalidProps("hours", errors)}>
      <legend className="text-ds-13 font-medium">Open days and hours</legend>
      {!myId.data && <p className="text-ds-11 text-muted-foreground">Set to Monday to Friday, 9 to 5. Change any day that's different.</p>}
      {WEEKDAYS.map((day, i) => {
        const h = form.hours[i];
        // S023 (Shops audit 11-12): at 375 the "to" time wrapped to its own line under the checkbox and the clock
        // icons were clipped by the fixed w-32 fields. Phone: the day on its line, then ONE row "opens to closes"
        // whose two fields share the width. sm and up: day and times on one row, as before.
        return (
          <div key={day} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2" data-testid="shop-hours-day">
            <div className="flex items-center gap-2 sm:w-32">
              <Checkbox
                id={`open-${i}`}
                checked={h.open}
                onCheckedChange={(v) => set("hours", { ...form.hours, [i]: { ...h, open: v === true } })}
              />
              <Label htmlFor={`open-${i}`} className="flex min-h-11 flex-1 items-center font-normal">{day}</Label>
            </div>
            {h.open && (
              <div className="flex min-w-0 items-center gap-2" data-testid="shop-hours-times">
                <Input
                  type="time"
                  aria-label={`${day} opens`}
                  className="min-w-0 flex-1 sm:w-36 sm:flex-none"
                  value={h.opens}
                  onChange={(e) => set("hours", { ...form.hours, [i]: { ...h, opens: e.target.value } })}
                />
                <span className="text-ds-13 text-muted-foreground">to</span>
                <Input
                  type="time"
                  aria-label={`${day} closes`}
                  className="min-w-0 flex-1 sm:w-36 sm:flex-none"
                  value={h.closes}
                  onChange={(e) => set("hours", { ...form.hours, [i]: { ...h, closes: e.target.value } })}
                />
              </div>
            )}
          </div>
        );
      })}
      {/* S2-042 (Shops audit 2): one tap copies the first open day's hours to the other open days. */}
      {(() => {
        const openDays = [1, 2, 3, 4, 5, 6, 0].filter((d) => form.hours[d].open);
        if (openDays.length < 2) return null;
        const from = openDays[0];
        const src = form.hours[from];
        const same = openDays.every((d) => form.hours[d].opens === src.opens && form.hours[d].closes === src.closes);
        return (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={same}
            data-testid="shop-hours-copy"
            onClick={() => set("hours", Object.fromEntries(Object.entries(form.hours).map(([d, h]) => [d, h.open ? { ...h, opens: src.opens, closes: src.closes } : h])))}
          >
            Copy {WEEKDAYS[from]}'s hours to all open days
          </Button>
        );
      })()}
      <FieldError field="hours" errors={errors} />
    </fieldset>
    {showSos || form.sosNumber.trim() !== "" ? (
      <div className="space-y-1.5">
        <Label htmlFor="shop-sos">Louisiana Secretary of State number (optional)</Label>
        <Input id="shop-sos" value={form.sosNumber} maxLength={20} onChange={(e) => set("sosNumber", e.target.value)} {...invalidProps("sos", errors)} />
        <FieldError field="sos" errors={errors} />
        <p className="text-ds-11 text-muted-foreground">Once we check it, your shop shows "Registered business". A shop without one is still welcome.</p>
      </div>
    ) : (
      <Button type="button" variant="outline" size="sm" className="self-start" aria-expanded={false} onClick={() => setShowSos(true)}>
        Have a Louisiana business number?
      </Button>
    )}
    {myId.data && (
      <section className="space-y-2" aria-labelledby="shop-edit-photos">
        <h2 id="shop-edit-photos" className="text-ds-13 font-medium">Logo, cover and photos</h2>
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
                  className="absolute bottom-1 right-1 px-2 text-ds-11"
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
    {formError && <p className="text-ds-13 text-destructive-ink" role="alert">{formError}</p>}
    {stillUnsaved && dirtySections.length > 0 && (
      <p className="rounded-xl bg-muted/70 px-3 py-2 text-ds-13" role="status" data-testid="shop-still-unsaved">
        Your shop is saved. These parts below have changes that aren't saved yet: {stillUnsaved.join(", ")}. Use each part's own Save.
      </p>
    )}
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
  );

  if (myId.isLoading || categories.isLoading || (myId.data && (shop.isLoading || customMode.isLoading))) {
    // The page shell is returned here (not inside the skeleton) so the shell guard can see it.
    return (
      <AppPage title="My shop" backTo="/shops">
        <ShopEditSkeleton>{formEl}</ShopEditSkeleton>
      </AppPage>
    );
  }
  if (myId.isError || categories.isError || shop.isError) {
    return (
      <AppPage title="My shop" backTo="/shops">
        <ErrorState
          variant="inline"
          title="We couldn't load your shop."
          body={shopsErrorMessage(myId.error ?? categories.error ?? shop.error)}
          onRetry={() => {
            void myId.refetch();
            void categories.refetch();
            if (myId.data) { void shop.refetch(); void customMode.refetch(); }
          }}
        />
      </AppPage>
    );
  }


  if (startAdding && myId.data && user?.id) {
    return (
      <AppPage title={itemTitle} backTo="/shops/mine">
        {/* The item editor's fields carry the shop form's line measure (Q1958 pass: ~1540px wide at 1440). */}
        <div className={`w-full ${SHOP_FORM_MEASURE}`}>
          <ShopItemsSection shopId={myId.data} ownerId={user.id} startAdding onTitle={setItemTitle} onLeave={() => navigate("/shops/mine")} />
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage title={myId.data ? "Edit my shop" : "Open a shop"} backTo="/shops" onBack={() => (anyUnsaved ? setConfirmLeave(true) : leave())}>
      <UnsavedSectionsProvider onChange={onSectionsChange}>
      {formEl}
      {/* The private pickup address (M1b part 2): saves on its own, needed before orders. */}
      {myId.data && <div className={`pb-6 ${SHOP_FORM_MEASURE}`}><ShopPickupAddressSection /></div>}
      {/* Permit on file (Q1952): optional, saves on its own; an admin checks it. */}
      {myId.data && user?.id && <div className={`pb-6 ${SHOP_FORM_MEASURE}`}><ShopPermitSection userId={user.id} /></div>}
      {/* FAQs (SH12): save on their own, like the pickup address. */}
      {myId.data && <div className={`pb-6 ${SHOP_FORM_MEASURE}`}><ShopFaqsEditor shopId={myId.data} /></div>}
      {/* Items (slice 2): outside the shop form, each item saves on its own. */}
      {myId.data && user?.id && <ShopItemsSection shopId={myId.data} ownerId={user.id} />}
      </UnsavedSectionsProvider>
      <BrandConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave without saving?"
        description={dirtySections.length > 0
          ? `Your changes aren't saved yet${mainDirty ? "" : ` (${dirtySections.join(", ")})`}.`
          : "Your changes aren't saved yet."}
        primaryLabel="Leave"
        onPrimary={() => { setConfirmLeave(false); leave(); }}
        secondaryLabel="Keep editing"
      />
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
