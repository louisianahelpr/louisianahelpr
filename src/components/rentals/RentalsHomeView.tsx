/**
 * /rentals (Rentals S1, docs/specs/landlord-hub-prep.md). One account, never
 * role-based: everyone sees "Homes you rent" (tenancies they accepted) and
 * "Properties you own" (add a property, ownership proof, units, invite links,
 * auto-approve, incoming requests). Hidden unless the 'rentals' switch is on.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import AppPage from "@/components/AppPage";
import { ErrorState } from "@/components/ui/ErrorState";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useAgeGate } from "@/hooks/useAgeGate";
import {
  addUnit,
  createProperty,
  fetchMyProperties,
  fetchMyRequests,
  fetchMyHomes,
  fetchUnits,
  inviteTenant,
  setAutoApprove,
  submitOwnershipProof,
  type MaintenanceRequest,
  type RentalProperty,
  type RentalUnit,
} from "@/lib/rentals/api";
import { OWNERSHIP_STATUS_LABEL, REQUEST_STATUS_LABEL, dollarsToCents, inviteUrl, rentalsErrorMessage } from "@/lib/rentals/copy";
import { RentalsCard, fmtDate } from "./rentalsUi";
import { MaintenanceRequestForm } from "./MaintenanceRequestForm";

function RequestRow({ r }: { r: MaintenanceRequest }) {
  return (
    <Link
      to={`/rentals/requests/${r.id}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="min-w-0">
        <span className="block font-medium truncate">
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
  const input = "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm";
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        m.mutate();
      }}
    >
      <input className={input} aria-label="Property name" placeholder="Name (e.g. Oak Street duplex)" value={label} onChange={(e) => setLabel(e.target.value)} required />
      <input className={input} aria-label="Street address" placeholder="Street address" value={street} onChange={(e) => setStreet(e.target.value)} required />
      <div className="flex gap-2">
        <input className={input} aria-label="City" placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} required />
        <input className={`${input} max-w-[7rem]`} aria-label="ZIP code" placeholder="ZIP" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} required />
      </div>
      <p className="text-xs text-muted-foreground">Only the owner of a property can add it. You need a verified ID.</p>
      <button type="submit" disabled={m.isPending} className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold">
        {m.isPending ? "Adding…" : "Add property"}
      </button>
    </form>
  );
}

function PropertyCard({ p, units, uid, onChange }: { p: RentalProperty; units: RentalUnit[]; uid: string; onChange: () => void }) {
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
              <button
                type="button"
                className="rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50"
                disabled={!approved || invite.isPending}
                onClick={() => invite.mutate(u.id)}
              >
                Invite tenant
              </button>
            </div>
            {links[u.id] && (
              <div className="rounded-lg bg-muted p-2 text-xs break-all">
                <p className="mb-1">Send this link to your tenant (works once, for 14 days):</p>
                <code>{links[u.id]}</code>
                <button
                  type="button"
                  className="block mt-1 font-semibold underline"
                  onClick={() => navigator.clipboard?.writeText(links[u.id]).then(() => toast.success("Link copied."), () => toast.error("Couldn't copy. Select the link and copy it."))}
                >
                  Copy link
                </button>
              </div>
            )}
          </div>
        ))}
        {!approved && <p className="text-xs text-muted-foreground">You can invite tenants once your ownership proof is approved.</p>}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            unit.mutate();
          }}
        >
          <input
            className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            aria-label="New unit name"
            placeholder="Unit name (e.g. Apt 2)"
            value={unitLabel}
            onChange={(e) => setUnitLabel(e.target.value)}
            required
          />
          <button type="submit" disabled={unit.isPending} className="rounded-full border border-border px-3 text-sm font-semibold">
            Add
          </button>
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
        <div className="flex gap-2">
          <input
            id={`auto-${p.id}`}
            className="flex-1 min-w-0 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            inputMode="decimal"
            placeholder="Off"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
          />
          <button type="submit" disabled={auto.isPending} className="rounded-full border border-border px-3 text-sm font-semibold">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export default function RentalsHomeView() {
  const { user } = useCurrentUser();
  const uid = user?.id ?? "";
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  // Q59: under 18 can't add a property, accept an invite or request a repair
  // (greyed out here; the server refuses too: rentals_assert_member).
  const { underAge } = useAgeGate();
  const data = useQuery({
    queryKey: ["rentals-home", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [properties, homes, requests] = await Promise.all([fetchMyProperties(uid), fetchMyHomes(), fetchMyRequests()]);
      const units = await fetchUnits(properties.map((p) => p.id));
      return { properties, units, homes, requests };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["rentals-home", uid] });

  return (
    <AppPage title="Rentals">
      {data.isError ? (
        <ErrorState onRetry={() => data.refetch()} />
      ) : !data.data ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading…
        </p>
      ) : (
        <div className="space-y-4">
          {underAge && (
            <p role="status" className="rounded-xl border border-border bg-muted p-3 text-sm">
              You must be 18 or older to send repair requests or add a property. You can still see your requests here.
            </p>
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
                </div>
              ))
            )}
            {data.data.requests.filter((r) => r.tenant_id === uid).map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </RentalsCard>

          <RentalsCard
            title="Properties you own"
            action={
              !adding && !underAge && (
                <button type="button" className="btn-grad-primary rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap" onClick={() => setAdding(true)}>
                  Add a property
                </button>
              )
            }
          >
            {adding && (
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
              <PropertyCard key={p.id} p={p} uid={uid} units={data.data.units.filter((u) => u.property_id === p.id)} onChange={refresh} />
            ))}
            {data.data.requests.filter((r) => r.landlord_id === uid).length > 0 && <p className="text-sm font-medium">Requests from tenants</p>}
            {data.data.requests.filter((r) => r.landlord_id === uid).map((r) => (
              <RequestRow key={r.id} r={r} />
            ))}
          </RentalsCard>
        </div>
      )}
    </AppPage>
  );
}
