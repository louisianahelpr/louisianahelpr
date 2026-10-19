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
import { KeyRound } from "lucide-react";
import { SectionScreen } from "@/components/sections/SectionScreen";
import { SectionTabs, useSectionTab } from "@/components/sections/SectionTabs";
import { StatusBoxes, useStatusFilter } from "@/components/sections/StatusBoxes";
import { sectionByKey } from "@/components/sections/sectionsConfig";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import {
  addUnit,
  createProperty,
  fetchMyProperties,
  fetchMyRequests,
  fetchMyHomes,
  fetchLiveTenancies,
  fetchUnits,
  inviteTenant,
  setAutoApprove,
  submitOwnershipProof,
  type MaintenanceRequest,
  type RentalProperty,
  type RentalUnit,
  type UnitTenancy,
} from "@/lib/rentals/api";
import { OWNERSHIP_STATUS_LABEL, REQUEST_STATUS_LABEL, dollarsToCents, inviteUrl, rentalsErrorMessage } from "@/lib/rentals/copy";
import { RentalsCard, fmtDate } from "./rentalsUi";
import { MaintenanceRequestForm } from "./MaintenanceRequestForm";
import { RentalsHomeSkeleton } from "./RentalsSkeletons";
import { EndTenancyButton } from "./EndTenancyButton";

function RequestRow({ r }: { r: MaintenanceRequest }) {
  return (
    <Link
      to={`/rentals/requests/${r.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
      toast.success("Property added. Next: add your ownership proof.");
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
      <p className="text-xs text-muted-foreground">Only the owner of a property can add it. You need a verified ID.</p>
      <Button type="submit" size="sm" disabled={m.isPending}>
        {m.isPending ? "Adding…" : "Add property"}
      </Button>
    </form>
  );
}

function PropertyCard({
  p,
  units,
  tenancies,
  uid,
  onChange,
}: {
  p: RentalProperty;
  units: RentalUnit[];
  tenancies: UnitTenancy[];
  uid: string;
  onChange: () => void;
}) {
  const [unitLabel, setUnitLabel] = useState("");
  const [limit, setLimit] = useState(p.auto_approve_limit_cents != null ? String(p.auto_approve_limit_cents / 100) : "");
  const [links, setLinks] = useState<Record<string, string>>({});
  const proof = useMutation({
    mutationFn: (f: File) => submitOwnershipProof(uid, p.id, f),
    onSuccess: () => {
      toast.success("Proof sent. An admin will check it.");
      onChange();
    },
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
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
    onError: (e) => toast.error(rentalsErrorMessage(e)),
  });
  const approved = p.ownership_status === "approved";
  return (
    <div className="rounded-xl border border-border p-3 space-y-3">
      <div>
        <p className="font-semibold">{p.label}</p>
        <p className="text-xs text-muted-foreground">
          {p.street_address}, {p.city} {p.zip_code}
        </p>
        <p className="text-xs font-semibold mt-1">{OWNERSHIP_STATUS_LABEL[p.ownership_status] ?? p.ownership_status}</p>
        {p.ownership_status === "rejected" && p.ownership_review_note && (
          <p className="text-xs text-muted-foreground">Reason: {p.ownership_review_note}</p>
        )}
      </div>
      {!approved && p.ownership_status !== "pending_review" && (
        <label className="block text-sm">
          <span className="block mb-1">Ownership proof: a deed, tax bill or parish assessor page with your name</span>
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            disabled={proof.isPending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) proof.mutate(f);
            }}
          />
        </label>
      )}
      <div className="space-y-2">
        <p className="text-sm font-medium">Units</p>
        {units.length === 0 && <p className="text-xs text-muted-foreground">No units yet. A house can be one unit called "Main".</p>}
        {units.map((u) => (
          <div key={u.id} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{u.label}</span>
              <Button type="button" size="sm" variant="outline" disabled={!approved || invite.isPending} onClick={() => invite.mutate(u.id)}>
                Invite tenant
              </Button>
            </div>
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
export const HOMES_TABS = [
  { value: "rent", label: "Renting" },
  { value: "own", label: "Owning" },
] as const;
const HOMES_TAB_VALUES = HOMES_TABS.map((t) => t.value);
const RENT_GROUPS = ["waiting", "approved", "closed"] as const;
const OWN_GROUPS = ["needs", "repairs", "properties"] as const;
const requestGroup = (r: MaintenanceRequest) => (r.status === "submitted" ? "waiting" : r.status === "approved" ? "approved" : "closed");

/** Browse: no homes are listed for browsing yet, so a clean empty state. */
function HomesBrowse() {
  return (
    <div className="liquid-glass flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="homes-browse-empty">
      <span className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
        <KeyRound className="w-6 h-6" aria-hidden />
      </span>
      <p className="text-ds-15 font-semibold">No homes listed near you yet</p>
      <p className="text-sm text-muted-foreground">Rent from a landlord on Helpr? Open their invite link and your home shows under Renting.</p>
    </div>
  );
}

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
      const [properties, homes, requests, tenancies] = await Promise.all([
        fetchMyProperties(uid),
        fetchMyHomes(),
        fetchMyRequests(),
        fetchLiveTenancies(uid),
      ]);
      const units = await fetchUnits(properties.map((p) => p.id));
      return { properties, units, homes, requests, tenancies };
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
          <RentalsCard title="Homes you rent">
            {data.data.homes.length === 0 ? (
              <p className="text-sm text-muted-foreground">When your landlord sends you an invite link, open it to connect your home here.</p>
            ) : (
              data.data.homes.map((h) => (
                <div key={h.tenancy_id} className="space-y-2">
                  <p className="font-semibold">
                    {h.label}
                    {h.unit_label ? `, ${h.unit_label}` : ""}
                  </p>
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
            action={
              !adding && !underAge && (
                <SectionActionPill onClick={() => setAdding(true)}>
                  Add a property
                </SectionActionPill>
              )
            }
          >
            {adding && !underAge && (
              <AddPropertyForm
                onDone={() => {
                  setAdding(false);
                  refresh();
                }}
              />
            )}
            {data.data.properties.length === 0 && !adding && (
              <p className="text-sm text-muted-foreground">Own a rental? Add it, invite your tenants, and turn their repair requests into Helpr jobs.</p>
            )}
            {data.data.properties.map((p) => (
              <PropertyCard
                key={p.id}
                p={p}
                uid={uid}
                units={data.data.units.filter((u) => u.property_id === p.id)}
                tenancies={data.data.tenancies}
                onChange={refresh}
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
