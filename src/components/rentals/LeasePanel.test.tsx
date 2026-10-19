/**
 * Homes lease (D4, our Louisiana template only). The server side (who may act, a draft hidden from the
 * tenant, the stored-blanks and sent_at checks, consent and initials, final once signed, the account
 * cascade) is proven by src/test/pglite/homesLease.pglite.mjs and the template's words by
 * src/test/rentalsLeaseTemplate.test.ts; this pins the screen: what each side sees and that each control
 * sends the right call (lead review of the lease #3 #5 #7 #8).
 *
 * @mutate src/components/rentals/LeasePanel.tsx |   const ready = consent && name.trim().length >= 2 && initials.all; |   const ready = consent && name.trim().length >= 2;
 * @mutate src/components/rentals/LeasePanel.tsx |             disabled={send.isPending \|\| missing.length > 0 \|\| name.trim().length < 2 \|\| !consent \|\| !initials.all} |             disabled={send.isPending \|\| name.trim().length < 2}
 * @mutate src/components/rentals/LeasePanel.tsx |   if (r.tenancy_status === "ended" && r.signed.length === 0) return null; |   if (false) return null;
 * @mutate src/components/rentals/LeasePanel.tsx |     mutationFn: () => requestLeaseChanges(lease.id, note), |     mutationFn: () => requestLeaseChanges(lease.id, ""),
 * @mutate src/components/rentals/LeasePanel.tsx |     mutationFn: () => sendSavedLease(tenancyId, fields, name, consent, initials.keys), |     mutationFn: () => sendSavedLease(tenancyId, {}, name, consent, initials.keys),
 * @mutate src/components/rentals/LeasePanel.tsx |       open.body_sha256 !== signing.body_sha256 \|\| |       false \|\|
 * @mutate src/components/rentals/LeasePanel.tsx |   const signedNow = signing !== null ? r.signed.find((l) => l.id === signing.id) ?? null : null; |   const signedNow = null as SignedLease \| null;
 * @mutate src/components/rentals/LeasePanel.tsx |   const sections = verified.data?.ok ? verified.data.sections : null; |   const sections = verified.data && "sections" in verified.data ? verified.data.sections : leaseSections(lease.template_version, lease.fields);
 * @mutate src/components/rentals/LeasePanel.tsx |       open.sent_at !== signing.sent_at \|\| |       false \|\|
 * @mutate src/components/rentals/LeasePanel.tsx |     if (v.reason === "unknown_version") { |     if (false) {
 * @mutate src/components/rentals/LeasePanel.tsx |       // Any refusal refetches the lease: if it moved, signed or went, the sheet's notice takes over (round 3 M2).\n      refresh(); |       // no refetch
 * @mutate src/components/rentals/LeasePanel.tsx |       {v.data && !v.data.ok && ( |       {false && (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LeaseRecord, OpenLease } from "@/lib/rentals/lease";
import { initialLeaseFields, type LeaseFields } from "@/lib/rentals/leaseTemplate";

const state: { rec: LeaseRecord } = { rec: undefined as unknown as LeaseRecord };
const saveLeaseDraft = vi.fn(async (..._a: unknown[]) => "L1");
const sendSavedLease = vi.fn(async (..._a: unknown[]) => undefined);
const signLease = vi.fn(async (..._a: unknown[]) => undefined);
const requestLeaseChanges = vi.fn(async (..._a: unknown[]) => undefined);
const withdrawLease = vi.fn(async (..._a: unknown[]) => undefined);
const discardLease = vi.fn(async (..._a: unknown[]) => undefined);
const fetchLease = vi.fn(async () => state.rec);
const buildLeasePdf = vi.fn(async (..._a: unknown[]) => ({ fileName: "lease.pdf", base64: "", blob: new Blob() }));
const toastError = vi.fn();

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: (...a: unknown[]) => toastError(...a) }) }));
vi.mock("@/lib/rentals/leasePdf", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/leasePdf")>()),
  buildLeasePdf: (...a: unknown[]) => buildLeasePdf(...a),
}));
vi.mock("@/lib/nativeShare", () => ({ shareFileNative: vi.fn(async () => "downloaded") }));
const reportSpy = vi.fn();
vi.mock("@/lib/errorLogger", () => ({ report: (...a: unknown[]) => reportSpy(...a) }));

vi.mock("@/lib/rentals/lease", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/lease")>()),
  fetchLease: () => fetchLease(),
  fetchMyLeases: async () => [],
  saveLeaseDraft: (...a: unknown[]) => saveLeaseDraft(...a),
  sendSavedLease: (...a: unknown[]) => sendSavedLease(...a),
  signLease: (...a: unknown[]) => signLease(...a),
  requestLeaseChanges: (...a: unknown[]) => requestLeaseChanges(...a),
  withdrawLease: (...a: unknown[]) => withdrawLease(...a),
  discardLease: (...a: unknown[]) => discardLease(...a),
}));

import { LeasePanel, downloadLease } from "./LeasePanel";
import { leaseHash, leaseSections, type SignedLease } from "@/lib/rentals/lease";
import { leaseText } from "@/lib/rentals/leaseTemplate";
import { createHash } from "node:crypto";
import { RentalsCopyError } from "@/lib/rentals/copy";

const FULL: LeaseFields = {
  ...initialLeaseFields(),
  lease_date: "2026-10-20", landlord_name: "Dana Landlord", tenant_names: "Terry Tenant", home_address: "123 Oak St, Lafayette, LA 70501",
  home_type: "house", bedrooms: "3", bathrooms: "2", home_includes: "yard", term_kind: "monthly", start_date: "2026-11-01",
  rent_amount: "1200", pay_methods: "Zelle", payee: "Dana", first_rent_amount: "1200", late_fee: "50", late_fee_cap: "$100",
  deposit_amount: "1200", tenant_utilities: "electric", occupants: "none", guest_days_six_months: "30", emergency_contact: "Pat, 337-555-0100",
  appliances: "stove", pest_control: "Landlord", detector_locations: "hall", key_count: "2", key_cost: "25", landlord_contact: "d@example.com",
  tenant_contact: "337-555-0101", landlord_address: "PO Box 1", insurance: "recommended", holdover_amount: "$40 per day", foreclosure: "none",
  flood_zone: "No", flooded_before: "No", mold: "No",
};
/** The real text hash of these blanks (what the landlord's app would have sent). */
const hashOf = (f: LeaseFields): string => createHash("sha256").update(leaseText(leaseSections("la-2026-10-14", f) ?? [])).digest("hex");
const OPEN = (o: Partial<OpenLease> = {}): OpenLease => ({
  id: "L1", status: "sent", template_version: "la-2026-10-14", fields: FULL, change_request: null, body_sha256: hashOf(o.fields ?? FULL),
  landlord_signed_name: "Dana Landlord", landlord_signed_at: "2026-10-20T15:00:00Z", sent_at: "2026-10-20T15:00:00Z", updated_at: "2026-10-20T15:00:00Z", ...o,
});
const R = (o: Partial<LeaseRecord> = {}): LeaseRecord => ({ side: "tenant", tenancy_status: "active", can_edit: false, open: null, signed: [], ...o });

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LeasePanel tenancyId="t1" homeLabel="Oak house" />
    </QueryClientProvider>,
  );

const SIGNED = (o: Partial<SignedLease> = {}): SignedLease => ({ id: "S1", tenancy_id: "t1", side: "tenant", home_label: "Oak house", template_version: "la-2026-10-14",
  fields: FULL, body_sha256: "a".repeat(64), landlord_signed_name: "Dana Landlord", landlord_signed_at: "2026-10-20T15:00:00Z", tenant_signed_name: "Terry Tenant",
  tenant_signed_at: "2026-10-21T15:00:00Z", sent_at: "2026-10-20T15:00:00Z", ...o });

describe("LeasePanel (D4 our template only)", () => {
  beforeEach(() => {
    state.rec = R();
    for (const f of [saveLeaseDraft, sendSavedLease, signLease, requestLeaseChanges, withdrawLease, discardLease, fetchLease, buildLeasePdf, toastError, reportSpy]) f.mockClear();
  });

  it("tenant, nothing yet: says the landlord can send one", async () => {
    renderPanel();
    expect(await screen.findByText("No lease here yet. Your landlord can send one for you to sign in the app.")).toBeTruthy();
  });

  it("tenant, a draft: told it is being prepared, never shown the blanks", async () => {
    state.rec = R({ open: { status: "draft", change_request: null } });
    renderPanel();
    expect(await screen.findByText("Your landlord is preparing your lease.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read and sign" })).toBeNull();
  });

  it("tenant signs: every initialed clause ticked, consent, a typed name", async () => {
    state.rec = R({ open: OPEN({ fields: { ...FULL, notice_waiver: true } }) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    expect((await screen.findByTestId("lease-text")).textContent).toContain("Waiver of notice to vacate");
    const sign = screen.getByRole("button", { name: "Sign the lease" });
    fireEvent.click(screen.getByLabelText("I agree to sign electronically"));
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Terry Tenant" } });
    expect((sign as HTMLButtonElement).disabled).toBe(true); // the initialed waiver is not ticked yet
    fireEvent.click(screen.getByLabelText("Section 19: the tenant waives the five-day notice to vacate."));
    expect((sign as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sign);
    await waitFor(() => expect(signLease).toHaveBeenCalledTimes(1));
    expect((signLease.mock.calls[0][0] as OpenLease).sent_at).toBe("2026-10-20T15:00:00Z");
    expect(signLease.mock.calls[0][1]).toBe(hashOf({ ...FULL, notice_waiver: true }));
    expect(signLease.mock.calls[0][2]).toBe("Terry Tenant");
    expect(signLease.mock.calls[0][3]).toBe(true);
    expect(signLease.mock.calls[0][4]).toEqual(["notice_waiver"]);
  });

  it("tenant asks for changes with a note", async () => {
    state.rec = R({ open: OPEN() });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ask for changes" }));
    fireEvent.change(screen.getByLabelText("What would you like changed?"), { target: { value: "Please allow my cat." } });
    fireEvent.click(screen.getByRole("button", { name: "Send to landlord" }));
    await waitFor(() => expect(requestLeaseChanges).toHaveBeenCalledWith("L1", "Please allow my cat."));
  });

  it("landlord: write, step through (each Next saves), and Sign and send stays off until every blank is filled", async () => {
    state.rec = R({ side: "landlord", can_edit: true });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Write the lease" }));
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: i === 6 ? "Save and read it" : "Save and next" }));
      await waitFor(() => expect(saveLeaseDraft).toHaveBeenCalledTimes(i + 1));
    }
    expect(await screen.findByText("Fill these in before you sign:")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Dana Landlord" } });
    expect((screen.getByRole("button", { name: "Sign and send" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("landlord: a complete draft is signed and sent with its blanks", async () => {
    state.rec = R({ side: "landlord", can_edit: true, open: OPEN({ status: "draft", body_sha256: null, landlord_signed_name: null, landlord_signed_at: null, sent_at: null, change_request: "Please allow my cat." }) });
    renderPanel();
    expect(await screen.findByText("Your tenant asked: Please allow my cat.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: i === 6 ? "Save and read it" : "Save and next" }));
      await waitFor(() => expect(saveLeaseDraft).toHaveBeenCalledTimes(i + 1));
    }
    expect(screen.queryByText("Fill these in before you sign:")).toBeNull();
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Dana Landlord" } });
    const send = screen.getByRole("button", { name: "Sign and send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // #3: the landlord agrees to sign electronically too
    fireEvent.click(screen.getByLabelText("I agree to sign electronically"));
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(sendSavedLease).toHaveBeenCalledTimes(1));
    expect(sendSavedLease.mock.calls[0][0]).toBe("t1");
    expect((sendSavedLease.mock.calls[0][1] as LeaseFields).rent_amount).toBe("1200");
    expect(sendSavedLease.mock.calls[0][2]).toBe("Dana Landlord");
    expect(sendSavedLease.mock.calls[0][3]).toBe(true);
    expect(sendSavedLease.mock.calls[0][4]).toEqual([]);
  });

  it("landlord, sent: waiting, and can take it back", async () => {
    state.rec = R({ side: "landlord", can_edit: true, open: OPEN() });
    renderPanel();
    expect(await screen.findByText(/Waiting for your tenant to sign/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Take back" }));
    await waitFor(() => expect(withdrawLease).toHaveBeenCalledWith("L1"));
  });

  it("an ended tenancy shows only signed leases (nothing at all when none)", async () => {
    state.rec = R({ tenancy_status: "ended" });
    const { container, unmount } = renderPanel();
    await waitFor(() => expect(fetchLease).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(container.querySelector("section[aria-label='Lease']")).toBeNull();
    unmount();
    state.rec = R({ tenancy_status: "ended", signed: [SIGNED()] });
    renderPanel();
    expect(await screen.findByTestId("lease-signed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "PDF" })).toBeTruthy();
  });

  it("#7: the landlord changes the lease while the tenant's sheet is open: nothing is signed, the sheet starts over on the new words", async () => {
    state.rec = R({ open: OPEN({ fields: { ...FULL, notice_waiver: true } }) });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LeasePanel tenancyId="t1" homeLabel="Oak house" />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    fireEvent.click(await screen.findByLabelText("I agree to sign electronically"));
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Terry Tenant" } });
    // The landlord took it back, raised the rent and sent it again; the query refetches (window focus).
    state.rec = R({ open: OPEN({ fields: { ...FULL, rent_amount: "1500" }, sent_at: "2026-10-22T09:00:00Z" }) });
    await act(async () => { await qc.invalidateQueries(); });
    expect(await screen.findByTestId("lease-changed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign the lease" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Read the new version" }));
    expect((await screen.findByTestId("lease-text")).textContent).toContain("$1,500.00");
    expect((screen.getByLabelText("Type your full name to sign") as HTMLInputElement).value).toBe("");
    expect((screen.getByRole("button", { name: "Sign the lease" }) as HTMLButtonElement).disabled).toBe(true);
    expect(signLease).not.toHaveBeenCalled();
  });

  it("#5: a PDF is made only when the stored fingerprint matches the stored blanks", async () => {
    await downloadLease(SIGNED(), "Oak house"); // "aaaa..." is not the hash of these blanks
    expect(buildLeasePdf).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    const good = SIGNED({ body_sha256: (await leaseHash("la-2026-10-14", FULL)) as string });
    await downloadLease(good, "Oak house");
    expect(buildLeasePdf).toHaveBeenCalledTimes(1);
    expect((buildLeasePdf.mock.calls[0][0] as { bodySha256: string }).bodySha256).toBe(good.body_sha256);
  });

  it("round 2 #6: an unknown template version says update the app (no fingerprint error, no report)", async () => {
    await downloadLease(SIGNED({ template_version: "la-2099-01-01" }), "Oak house");
    expect(buildLeasePdf).not.toHaveBeenCalled();
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/newest app/);
    expect(reportSpy).not.toHaveBeenCalled();
    await downloadLease(SIGNED(), "Oak house"); // a real mismatch is reported
    expect(reportSpy).toHaveBeenCalledTimes(1);
  });

  it("round 2 #9: reading a signed lease applies the same check, and warns on a mismatch", async () => {
    state.rec = R({ tenancy_status: "ended", signed: [SIGNED()] });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read" }));
    expect(await screen.findByTestId("lease-verify-warning")).toBeTruthy();
    expect(screen.queryByTestId("lease-text")).toBeNull();
  });

  it("round 3 M2: a sign refused because the lease moved shows the changed notice", async () => {
    state.rec = R({ open: OPEN() });
    signLease.mockImplementationOnce(async () => {
      state.rec = R({ open: OPEN({ fields: { ...FULL, rent_amount: "1500" }, sent_at: "2026-10-22T09:00:00Z" }) });
      throw new RentalsCopyError("x", { message: "lease_changed", code: "22023" });
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    fireEvent.click(await screen.findByLabelText("I agree to sign electronically"));
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Terry Tenant" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign the lease" }));
    expect(await screen.findByTestId("lease-changed")).toBeTruthy();
  });

  it("round 3 M2: the same sent_at with another fingerprint is a changed lease too", async () => {
    state.rec = R({ open: OPEN() });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><LeasePanel tenancyId="t1" homeLabel="Oak house" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    state.rec = R({ open: OPEN({ fields: { ...FULL, rent_amount: "1500" } }) }); // same sent_at
    await act(async () => { await qc.invalidateQueries(); });
    expect(await screen.findByTestId("lease-changed")).toBeTruthy();
  });

  it("round 3 M2: the same words sent again (a new sent_at) are a changed lease too", async () => {
    state.rec = R({ open: OPEN() });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={qc}><LeasePanel tenancyId="t1" homeLabel="Oak house" /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    state.rec = R({ open: OPEN({ sent_at: "2026-10-22T09:00:00Z" }) }); // same blanks, same hash
    await act(async () => { await qc.invalidateQueries(); });
    expect(await screen.findByTestId("lease-changed")).toBeTruthy();
  });

  it("round 3 M3: a double tap (lease_not_open) after the lease was signed says it is signed, with Read and PDF", async () => {
    state.rec = R({ open: OPEN() });
    signLease.mockImplementationOnce(async () => {
      state.rec = R({ signed: [SIGNED({ id: "L1", body_sha256: hashOf(FULL) })] });
      throw new RentalsCopyError("x", { message: "lease_not_open", code: "22023" });
    });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    fireEvent.click(await screen.findByLabelText("I agree to sign electronically"));
    fireEvent.change(screen.getByLabelText("Type your full name to sign"), { target: { value: "Terry Tenant" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign the lease" }));
    expect(await screen.findByTestId("lease-now-signed")).toBeTruthy();
    expect(screen.queryByTestId("lease-changed")).toBeNull();
    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeTruthy();
  });

  it("round 3 M1b: a sent lease whose stored fingerprint doesn't match its blanks cannot be signed, and is reported", async () => {
    state.rec = R({ open: OPEN({ body_sha256: "a".repeat(64) }) });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Read and sign" }));
    expect(await screen.findByTestId("lease-record-mismatch")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign the lease" })).toBeNull();
    expect(reportSpy).toHaveBeenCalled();
  });

});
