import { X } from "lucide-react";
import type { CareRelationship, ProfileStub } from "./types";

/** Card shown to the senior (care recipient) listing their caregivers. */
export function CaregiverCard({
  relationship,
  caregiverProfile,
  onRevokeAccess,
}: {
  relationship: CareRelationship;
  caregiverProfile: ProfileStub | undefined;
  onRevokeAccess: (id: string) => void;
}) {
  const name = caregiverProfile?.full_name ?? "A family member";
  const isPending = relationship.status === "pending";

  return (
    <div
      className="rounded-ds-md p-4"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
        boxShadow: "0 1px 4px hsl(var(--olivewood) / 0.06)",
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-[12px] flex items-center justify-center shrink-0 text-ds-14 font-sans font-semibold"
          style={{ background: "hsl(var(--sage) / 0.14)", color: "hsl(var(--sage))" }}
        >
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
            {name}
          </p>
          <p className="text-ds-12 font-serif italic mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            {isPending ? "Invite sent — waiting for your approval" : "Manages your jobs"}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {relationship.permissions.map((p) => (
              <span
                key={p}
                className="text-ds-10 font-sans px-2 py-0.5 rounded-full"
                style={{
                  background: "hsl(var(--bark) / 0.08)",
                  color: "hsl(var(--bark))",
                }}
              >
                {p.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        </div>
        <button
          aria-label="Remove access"
          onClick={() => onRevokeAccess(relationship.id)}
          className="mt-0.5 flex items-center gap-1 h-8 px-2.5 rounded-ds-md text-ds-12 font-sans font-medium active:scale-95 transition-all"
          style={{
            background: "hsl(var(--destructive) / 0.08)",
            color: "hsl(var(--destructive))",
          }}
        >
          <X className="w-3.5 h-3.5" />
          Remove
        </button>
      </div>
    </div>
  );
}
