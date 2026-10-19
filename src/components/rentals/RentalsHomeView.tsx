/**
 * /rentals, the HOMES section (owner, 2026-10-19): opens on Browse (leftmost);
 * "Renting" holds the "Homes you rent" part and "Owning" the "Properties you
 * own" part below, each under status boxes that filter its groups. ?add=1
 * (the top bar's "+") opens Owning with the add-property form open.
 * Originally /rentals (Rentals S1, docs/specs/landlord-hub-prep.md). One account, never
 * role-based: everyone sees "Homes you rent" (tenancies they accepted) and
 * "Properties you own" (add a property, ownership proof, units, invite links,
 * auto-approve, incoming requests). Hidden unless the 'rentals' switch is on.
 */
import { SectionActionPill } from "@/components/ui/SectionActionPill";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Building2, KeyRound } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import {
  addUnit,
  createProperty,
  fetchMyIdentity,
  fetchMyProperties,
  fetchMyRequests,
  fetchMyHomes,
  fetchLiveTenancies,
  fetchUnits,
  inviteTenant,
  setAutoApprove,
  type MaintenanceRequest,
  type MyIdentity,
  type RentalProperty,
  type RentalUnit,
  type UnitTenancy,
} from "@/lib/rentals/api";
import { OWNERSHIP_STATUS_LABEL, REQUEST_STATUS_LABEL, dollarsToCents, inviteUrl, rentalsErrorMessage } from "@/lib/rentals/copy";
import { RENTALS_ITEM_CARD, RentalsCard, fmtDate } from "./rentalsUi";
import { MaintenanceRequestForm } from "./MaintenanceRequestForm";
import { RentalsHomeSkeleton } from "./RentalsSkeletons";
import { EndTenancyButton } from "./EndTenancyButton";
import { RentPanel } from "./RentPanel";
import { HomesBrowse } from "./HomesBrowse";
import { fetchMyListings, type RentalListing } from "@/lib/rentals/listings";
import { listingStatusLabel } from "@/lib/rentals/listingCopy";
import { IdStatusNotice, SendForReview, idPhotoNeeded } from "./LandlordIdReview";

function RequestRow({ r }: { r: MaintenanceRequest }) {
  return (
    <Link
      to={`/rentals/requests/${r.id}`}
      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className="block font-medium truncate" title={`${r.urgency === "emergency" ? "EMERGENCY: " : ""}${r.description}`}>
          {r.urgency === "emergency" ? "EMERGENCY: " : ""}
          {r.description}
        </span>
        <span className="block text-xs text-muted-foreground">
          {r.property_label}
          {r.unit_label ? `, ${r.unit_label}` : ""} · {fmtDate(r.created_at)}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold">{REQUEST_STATUS_LABEL[r.status] ?? r.status}</span>
    </Link>
  );
}

function AddPropertyForm({ onDone }: { onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  const m = useMutation({
    mutationFn: () => createProperty(label, street, city, zip),
    onSuccess: () => {
      toast.success("Property added. Next: send your ownership proof for review.");
      onDone();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <Input aria-label="Property name" placeholder="Name (e.g. Oak Street duplex)" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <Input aria-label="Street address" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} required />
      <div className="flex gap-2">
        <Input aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required />
        <Input className="max-w-[7rem]" aria-label="ZIP code" placeholder="ZIP" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} required />
      </div>
      <p className="text-xs text-muted-foreground">Only the owner of a property can add it. Next you send ownership proof and, if you aren't ID-verified yet, a photo of your ID.</p>
      <Button type="submit" size="sm" disabled={m.isPending}>
        {m.isPending ? "Adding…" : "Add property"}
      </Button>
    </form>
  );
}

/** Homes -> Rent (RL1a): list a unit for rent, or open its listing. Only once ownership is approved. */
/**
 * A property an admin took down (Q2187): the owner sees, once, that its listings are gone and why, and that
 * nothing on it can be listed until Louisiana Helpr lifts it (lead review must-fix 3: shown from the property,
 * never from an old removed row that could hide a live listing).
 */
function TakenDown({ reason }: { reason: string | null }) {
  return (
    <p role="status" className="rounded-xl bg-muted px-3 py-2 text-xs">
      <span className="font-semibold">Listings removed by Louisiana Helpr.</span> {reason} Contact support if you think this is a mistake.
    </p>
  );
}

function UnitListingLink({ unitId, approved, listing }: { unitId: string; approved: boolean; listing: RentalListing | undefined }) {
  if (!approved) return null;
  return listing ? (
    <Link to={`/rentals/listings/${listing.id}/edit`} className="flex justify-between gap-2 pl-3 text-xs">
      <span className="text-muted-foreground">Listing: {listingStatusLabel(listing.status, listing.expires_at)}</span>
      <span className="font-semibold">Edit listing</span>
    </Link>
  ) : (
    <Link to={`/rentals/listings/new?unit=${unitId}`} className="block pl-3 text-xs font-semibold">
      List this unit for rent
    </Link>
  );
}

/**
 * Homes -> Buy (20261019061241): the property's own for-sale listing. Only an
 * approved owner sees it (the server refuses anyone else too).
 */
function SaleListingLink({ propertyId, approved, listing }: { propertyId: string; approved: boolean; listing: RentalListing | undefined }) {
  if (!approved) return null;
  return listing ? (
    <Link to={`/rentals/listings/${listing.id}/edit`} className="flex justify-between gap-2 text-sm">
      <span className="text-muted-foreground">For sale: {listingStatusLabel(listing.status, listing.expires_at)}</span>
      <span className="font-semibold">Edit</span>
    </Link>
  ) : (
    <Link to={`/rentals/listings/new?sell=${propertyId}`} className="block text-sm font-semibold">
      Sell this home
    </Link>
  );
}

function PropertyCard({
  p,
  units,
  tenancies,
  listings,
  uid,
  onChange,
  identity,
}: {
  p: RentalProperty;
  units: RentalUnit[];
  tenancies: UnitTenancy[];
  listings: RentalListing[];
  uid: string;
  onChange: () => void;
  identity: MyIdentity;
}) {
  const [unitLabel, setUnitLabel] = useState("");
  const [limit, setLimit] = useState(p.auto_approve_limit_cents != null ? String(p.auto_approve_limit_cents / 100) : "");
  const [links, setLinks] = useState<Record<string, string>>({});
  const unit = useMutation({
    mutationFn: () => addUnit(p.id, unitLabel),
    onSuccess: () => {
      setUnitLabel("");
      onChange();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const auto = useMutation({
    mutationFn: (cents: number | null) => setAutoApprove(p.id, cents),
    onSuccess: (_d, cents) => {
      toast.success(cents == null ? "Auto-approve is off." : "Auto-approve saved.");
      onChange();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const invite = useMutation({
    mutationFn: (unitId: string) => inviteTenant(unitId),
    onSuccess: (token, unitId) => setLinks((l) => ({ ...l, [unitId]: inviteUrl(window.location.origin, token) })),
    onError: (e) => {
      toast.error(rentalsErrorMessage(e));
      onChange(); // identity_not_verified / ownership_not_approved: show the current state
    },
  });
  const approved = p.ownership_status === "approved";
  const needsProof = !approved && p.ownership_status !== "pending_review";
  // An admin took this property's listings down: nothing on it can be listed until that is lifted (Q2187).
  const takenDown = !!p.listings_taken_down_at;
  return (
    <div className={`${RENTALS_ITEM_CARD} space-y-3`}>
      <div>
        <p className="font-semibold">{p.label}</p>
        <p className="text-xs text-muted-foreground">
          {p.street_address}, {p.city} {p.zip_code}
        </p>
        <p className="mt-2">
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-ds-12 font-semibold ${approved ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]" : "bg-muted"}`}
          >
            {OWNERSHIP_STATUS_LABEL[p.ownership_status] ?? p.ownership_status}
          </span>
        </p>
        {p.ownership_status === "rejected" && p.ownership_review_note && (
          <p className="text-xs text-muted-foreground">Reason: {p.ownership_review_note}</p>
        )}
      </div>
      {/* The ID rides with this property's proof; with no proof to send, the ID form stands alone above. */}
      <SendForReview uid={uid} propertyId={p.id} needsId={needsProof && idPhotoNeeded(identity)} needsProof={needsProof} onSent={onChange} />
      {takenDown && <TakenDown reason={p.listings_taken_down_reason} />}
      <SaleListingLink
        propertyId={p.id}
        approved={approved && !takenDown}
        listing={listings.find((l) => l.kind === "sale" && l.property_id === p.id && l.status !== "sold")}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium">Units</p>
        {units.length === 0 && <p className="text-xs text-muted-foreground">No units yet. A house can be one unit called "Main".</p>}
        {units.map((u) => (
          <div key={u.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{u.label}</span>
              <Button type="button" size="sm" variant="outline" disabled={!approved || !identity.verified || invite.isPending} onClick={() => invite.mutate(u.id)}>
                Invite tenant
              </Button>
            </div>
            <UnitListingLink unitId={u.id} approved={approved && !takenDown} listing={listings.find((l) => l.kind === "rent" && l.unit_id === u.id && l.status !== "leased")} />
            {tenancies.filter((t) => t.unit_id === u.id).map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-2 pl-3 text-xs">
                <span className="text-muted-foreground">
                  {t.status === "active"
                    ? `Tenant connected ${fmtDate(t.accepted_at)}`
                    : new Date(t.invite_expires_at).getTime() < Date.now()
                      ? `Invite expired ${fmtDate(t.invite_expires_at)}, never used`
                      : `Invite not used yet (works until ${fmtDate(t.invite_expires_at)})`}
                </span>
                <EndTenancyButton tenancyId={t.id} kind={t.status === "active" ? "end" : "cancel-invite"} onDone={onChange} />
              </div>
            ))}
            {tenancies.filter((t) => t.unit_id === u.id && t.status === "active").map((t) => (
              <div key={`rent-${t.id}`} className="pl-3">
                <RentPanel tenancyId={t.id} />
              </div>
            ))}
            {links[u.id] && (
              <div className="rounded-lg bg-muted p-2 text-xs break-all">
                <p className="mb-1">Send this link to your tenant (works once, for 14 days):</p>
                <code>{links[u.id]}</code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => navigator.clipboard?.writeText(links[u.id]).then(() => toast.success("Link copied."), () => toast.error("Couldn't copy. Select the link and copy it."))}
                >
                  Copy link
                </Button>
              </div>
            )}
          </div>
        ))}
        {!approved && <p className="text-xs text-muted-foreground">You can invite tenants once your ownership proof is approved.</p>}
        {approved && !identity.verified && <p className="text-xs text-muted-foreground">You can invite tenants once your ID is checked.</p>}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            unit.mutate();
          }}
        >
          <Input
            className="flex-1 min-w-0"
            aria-label="New unit name"
            placeholder="Unit name (e.g. Apt 2)"
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
            required
          />
          <Button type="submit" size="sm" variant="outline" disabled={unit.isPending}>
            Add
          </Button>
        </form>
      </div>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (limit.trim() === "") return auto.mutate(null);
          const cents = dollarsToCents(limit);
          if (cents == null) return toast.error("Enter an amount like 150.");
          auto.mutate(cents);
        }}
      >
        <label className="block text-sm font-medium" htmlFor={`auto-${p.id}`}>
          Auto-approve repairs up to $ (leave blank for off)
        </label>
        <p className="text-xs text-muted-foreground">Emergencies always wait for you. You still post and pay for every job.</p>
        <div className="flex items-center gap-2">
          <Input
            id={`auto-${p.id}`}
            className="flex-1 min-w-0"
            inputMode="decimal"
            placeholder="Off"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={auto.isPending}>
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

/** One word each, Browse always first (owner, 2026-10-19). */
const HOMES_TABS = [
  { value: "rent", label: "Renting" },
  { value: "own", label: "Owning" },
] as const;
const HOMES_TAB_VALUES = HOMES_TABS.map((t) => t.value);
const RENT_GROUPS = ["waiting", "approved", "closed"] as const;
const OWN_GROUPS = ["needs", "repairs", "properties"] as const;
const requestGroup = (r: MaintenanceRequest) => (r.status === "submitted" ? "waiting" : r.status === "approved" ? "approved" : "closed");

export default function RentalsHomeView() {
  const [tab, setTab] = useSectionTab(HOMES_TAB_VALUES);
  const [params, setParams] = useSearchParams();
  const [rentStatus, toggleRent] = useStatusFilter(RENT_GROUPS);
  const [ownStatus, toggleOwn] = useStatusFilter(OWN_GROUPS);
  const { user } = useCurrentUser();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const [adding, setAdding] = useState(() => params.get("add") === "1");
  // The top bar's "+" lands on ?tab=own&add=1: open the form, then drop the flag.
  useEffect(() => {
    if (params.get("add") !== "1") return;
    setAdding(true);
    const next = new URLSearchParams(params);
    next.delete("add");
    setParams(next, { replace: true });
  }, [params, setParams]);
  // Q59: under 18 can't add a property, accept an invite or request a repair
  // (greyed out here; the server refuses too: rentals_assert_member).
  const { underAge } = useAgeGate();
  const data = useQuery({
    queryKey: ["rentals-home", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [properties, homes, requests, tenancies, listings, identity] = await Promise.all([
        fetchMyProperties(uid),
        fetchMyHomes(),
        fetchMyRequests(),
        fetchLiveTenancies(uid),
        fetchMyListings(uid),
        fetchMyIdentity(),
      ]);
      const units = await fetchUnits(properties.map((p) => p.id));
      return { properties, units, homes, requests, tenancies, listings, identity };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rentals-home", uid] });

  // The page's own loading state is the gate's frame (RentalsSkeletons.tsx), so nothing moves between them.
  const tabs = <SectionTabs label="Homes" tabs={HOMES_TABS} value={tab} onChange={setTab} />;
  if (tab === "browse") {
    return (
      <SectionScreen title="Homes" add={sectionByKey("homes").add}>
        {tabs}
        <HomesBrowse />
      </SectionScreen>
    );
  }
  if (!data.isError && !data.data) return <RentalsHomeSkeleton />;
  const mineAsTenant = data.data ? data.data.requests.filter((r) => r.tenant_id === uid) : [];
  const mineAsLandlord = data.data ? data.data.requests.filter((r) => r.landlord_id === uid) : [];
  const landlordNeeds = mineAsLandlord.filter((r) => r.status === "submitted");
  const landlordOther = mineAsLandlord.filter((r) => r.status !== "submitted");
  const showOwn = (g: (typeof OWN_GROUPS)[number]) => ownStatus === null || ownStatus === g;
  return (
    <SectionScreen title="Homes" add={sectionByKey("homes").add}>
      {tabs}
      {data.isError || !data.data ? (
        <ErrorState onRetry={() => data.refetch()} />
      ) : (
        <div className="space-y-4">
          {underAge && (
            <p role="status" className="rounded-xl border border-border bg-muted p-3 text-sm">
              You must be 18 or older to send repair requests or add a property. You can still see your requests here.
            </p>
          )}
          {tab === "rent" && (
          <>
          <StatusBoxes
            boxes={RENT_GROUPS.map((g) => ({
              key: g,
              label: g === "waiting" ? "Waiting" : g === "approved" ? "Approved" : "Closed",
              count: mineAsTenant.filter((r) => requestGroup(r) === g).length,
            }))}
            value={rentStatus}
            onToggle={toggleRent}
          />
          {mineAsTenant.filter((r) => rentStatus === null || requestGroup(r) === rentStatus).length > 0 && (
            <RentalsCard title="Your repair requests">
              {mineAsTenant.filter((r) => rentStatus === null || requestGroup(r) === rentStatus).map((r) => (
                <RequestRow key={r.id} r={r} />
              ))}
            </RentalsCard>
          )}
          <RentalsCard title="Homes you rent" bare>
            {data.data.homes.length === 0 ? (
              <EmptyState
                variant="inline"
                icon={KeyRound}
                title="No home connected yet"
                body="When your landlord sends you an invite link, open it and your home shows up here."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link to="/rentals">Browse homes for rent</Link>
                  </Button>
                }
              />
            ) : (
              data.data.homes.map((h) => (
                <div key={h.tenancy_id} className={`${RENTALS_ITEM_CARD} space-y-2`}>
                  <p className="font-semibold">
                    {h.label}
                    {h.unit_label ? `, ${h.unit_label}` : ""}
                  </p>
                  <RentPanel tenancyId={h.tenancy_id} />
                  {!underAge && <MaintenanceRequestForm tenancyId={h.tenancy_id} uid={uid} onFiled={refresh} />}
                  <EndTenancyButton tenancyId={h.tenancy_id} kind="leave" onDone={refresh} />
                </div>
              ))
            )}
          </RentalsCard>
          </>
          )}

          {tab === "own" && (
          <>
          <StatusBoxes
            boxes={[
              { key: "needs", label: "Needs you", count: landlordNeeds.length, hot: true },
              { key: "repairs", label: "Repairs", count: landlordOther.length },
              { key: "properties", label: "Properties", count: data.data.properties.length },
            ]}
            value={ownStatus}
            onToggle={toggleOwn}
          />
          {showOwn("needs") && landlordNeeds.length > 0 && (
            <RentalsCard title="Requests from tenants">
              {landlordNeeds.map((r) => <RequestRow key={r.id} r={r} />)}
            </RentalsCard>
          )}
          {showOwn("repairs") && landlordOther.length > 0 && (
            <RentalsCard title="Earlier repairs">
              {landlordOther.map((r) => <RequestRow key={r.id} r={r} />)}
            </RentalsCard>
          )}
          {showOwn("properties") && (
          <RentalsCard
            title="Properties you own"
            bare
            action={
              !adding && !underAge && data.data.properties.length > 0 && (
                <SectionActionPill onClick={() => setAdding(true)}>
                  Add a property
                </SectionActionPill>
              )
            }
          >
            {(data.data.properties.length > 0 || data.data.identity.idStatus !== null) && <IdStatusNotice id={data.data.identity} />}
            {/* The ID alone, when no property is waiting for its proof (e.g. a new photo after a rejection). */}
            {idPhotoNeeded(data.data.identity) && data.data.properties.length > 0
              && !data.data.properties.some((p) => p.ownership_status === "needs_proof" || p.ownership_status === "rejected") && (
              <div className={RENTALS_ITEM_CARD}>
                <SendForReview uid={uid} propertyId={null} needsId needsProof={false} onSent={refresh} />
              </div>
            )}
            {adding && !underAge && (
              <div className={RENTALS_ITEM_CARD}>
              <AddPropertyForm
                onDone={() => {
                  setAdding(false);
                  refresh();
                }}
              />
              </div>
            )}
            {data.data.properties.length === 0 && !adding && (
              <EmptyState
                variant="inline"
                icon={Building2}
                title="Own a rental?"
                body="Add it, invite your tenants, and turn their repair requests into Helpr jobs."
                action={
                  !underAge && (
                    <Button type="button" size="sm" onClick={() => setAdding(true)}>
                      Add a property
                    </Button>
                  )
                }
              />
            )}
            {data.data.properties.map((p) => (
              <PropertyCard
                key={p.id}
                p={p}
                uid={uid}
                units={data.data.units.filter((u) => u.property_id === p.id)}
                tenancies={data.data.tenancies}
                listings={data.data.listings}
                onChange={refresh}
                identity={data.data.identity}
              />
            ))}
          </RentalsCard>
          )}
          </>
          )}
        </div>
      )}
    </SectionScreen>
  );
}
