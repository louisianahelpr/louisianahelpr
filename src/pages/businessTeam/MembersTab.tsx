// Members tab of the BusinessTeam workspace — invite form, seat plan,
// active/pending member lists. Extracted verbatim from BusinessTeam.tsx
// (behavior-preserving split). All JSX, strings, classNames, color
// tokens, seat prices, and gating logic are moved unchanged; the page
// owns the state/handlers and passes them in as props.

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Mail,
  Sparkles,
  CreditCard,
  Send,
  Check,
  FileSpreadsheet,
} from "lucide-react";
import { HelprSpinner } from "@/components/ui/HelprSpinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { ROLE_LABEL, ROLE_SPECS } from "@/components/business/roles";
import type { SeatTier, ExtendedRole } from "@/hooks/useMyBusiness";
import { TIERS, TIER_RANK } from "./businessTeamHelpers";
import type { Member } from "./types";

interface MembersTabProps {
  businessName: string;
  isOwner: boolean;
  isAdminOrOwner: boolean;
  currentTier: SeatTier;
  SEAT_LIMIT: number;
  totalSlots: number;
  remainingSlots: number;
  activeMembers: Member[];
  pendingMembers: Member[];
  membersLoading: boolean;
  membersError: boolean;
  refetchMembers: () => void;
  inviteEmail: string;
  setInviteEmail: (v: string) => void;
  inviteEmailValid: boolean;
  inviting: boolean;
  openingPortal: boolean;
  upgrading: SeatTier | null;
  savingRole: string | null;
  onBulkOpen: () => void;
  onInvite: (e: React.FormEvent) => void;
  onResendInvite: (memberEmail: string) => void;
  onChangeRole: (memberId: string, nextRole: Exclude<ExtendedRole, "owner">) => void;
  onUpgrade: (tier: SeatTier) => void;
  onManageBilling: () => void;
  onRemoveTarget: (m: Member) => void;
}

const MembersTab = ({
  businessName,
  isOwner,
  isAdminOrOwner,
  currentTier,
  SEAT_LIMIT,
  totalSlots,
  remainingSlots,
  activeMembers,
  pendingMembers,
  membersLoading,
  membersError,
  refetchMembers,
  inviteEmail,
  setInviteEmail,
  inviteEmailValid,
  inviting,
  openingPortal,
  upgrading,
  savingRole,
  onBulkOpen,
  onInvite,
  onResendInvite,
  onChangeRole,
  onUpgrade,
  onManageBilling,
  onRemoveTarget,
}: MembersTabProps) => {
  return (
    <>
      {isAdminOrOwner && (
        <Card className="p-5">
          <div className="flex items-center justify-between gap-3 mb-1">
            <h2 className="font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4" /> Invite a team member
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={onBulkOpen}
              disabled={remainingSlots <= 0}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" /> Bulk CSV
            </Button>
          </div>
          <p className="text-ds-11 text-muted-foreground mb-4">
            They'll get full access to post and manage jobs on behalf of {businessName}.
            All jobs are billed to your card on file.
          </p>
          <form onSubmit={onInvite} className="flex gap-2">
            <div className="flex-1 relative">
              <Label htmlFor="invite-email" className="sr-only">
                Email
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="teammate@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={remainingSlots <= 0}
                className={inviteEmailValid ? "pr-10" : undefined}
              />
              {inviteEmailValid && (
                <Check
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
                  strokeWidth={2.5}
                  aria-hidden
                />
              )}
            </div>
            <Button type="submit" disabled={inviting || remainingSlots <= 0 || !inviteEmailValid}>
              {inviting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Invite"}
            </Button>
          </form>
          {remainingSlots <= 0 && (
            totalSlots > SEAT_LIMIT ? (
              // OVER the plan, not merely at it. This happens without the
              // customer doing anything wrong — a downgrade, or migration
              // 20260817120000, which corrected the enforced cap to the tier
              // that was actually sold (Starter went from an accidental 2 to
              // the 1 seat the pricing page has always advertised). Telling
              // someone in that state to "upgrade to add more members" bills
              // them for a change they did not make and would not fix what
              // they are looking at, which is the exact failure this screen
              // was corrected for. State the position instead.
              <p className="text-ds-11 text-muted-foreground mt-2">
                Your plan includes {SEAT_LIMIT} {SEAT_LIMIT === 1 ? "seat" : "seats"} and you're
                using {totalSlots}. Everyone keeps their access — you just can't add anyone new
                until you upgrade or remove {totalSlots - SEAT_LIMIT}.
              </p>
            ) : (
              <p className="text-ds-11 text-destructive mt-2">
                You've reached your {SEAT_LIMIT}-seat limit. Upgrade your plan below to add more
                members.
              </p>
            )
          )}
        </Card>
      )}

      {isOwner && (
        <Card className="p-5">
          <div className="flex items-start justify-between mb-3 gap-3">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4" /> Seat plan
              </h2>
              <p className="text-ds-11 text-muted-foreground mt-1">
                Upgrade or downgrade anytime. Changes apply to your next billing cycle.
              </p>
            </div>
            {currentTier !== "starter" && (
              <Button
                variant="outline"
                size="sm"
                onClick={onManageBilling}
                disabled={openingPortal}
                className="shrink-0"
              >
                {openingPortal ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <CreditCard className="w-3.5 h-3.5 mr-1.5" /> Manage
                  </>
                )}
              </Button>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            {TIERS.map((tier) => {
              const isCurrent = tier.id === currentTier;
              const isUpgrade = TIER_RANK[tier.id] > TIER_RANK[currentTier];
              const isDowngrade = TIER_RANK[tier.id] < TIER_RANK[currentTier];
              const wouldFitCurrent = tier.seats >= totalSlots;

              return (
                <div
                  key={tier.id}
                  className={`rounded-ds-sm border p-3 ${
                    isCurrent ? "border-primary/50 bg-primary/5" : "border-border/60 bg-background/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="font-medium text-ds-13">{tier.name}</p>
                      <p className="text-ds-11 text-muted-foreground">
                        {tier.seats} seats · {tier.price}
                      </p>
                    </div>
                    {isCurrent && <Badge className="text-ds-10 h-5">Current</Badge>}
                  </div>
                  {!isCurrent && (
                    <Button
                      variant={isUpgrade ? "default" : "outline"}
                      size="sm"
                      className="w-full h-8 text-ds-11"
                      onClick={() => onUpgrade(tier.id)}
                      disabled={
                        upgrading !== null ||
                        openingPortal ||
                        (isDowngrade && !wouldFitCurrent)
                      }
                    >
                      {upgrading === tier.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : isUpgrade ? (
                        "Upgrade"
                      ) : isDowngrade && !wouldFitCurrent ? (
                        `Remove ${totalSlots - tier.seats} seat${totalSlots - tier.seats === 1 ? "" : "s"} first`
                      ) : (
                        "Switch via portal"
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <h3 className="text-ds-13 font-semibold text-muted-foreground px-1">
          Team ({activeMembers.length})
        </h3>
        {membersLoading ? (
          <div className="flex justify-center my-8">
            <HelprSpinner size={20} />
          </div>
        ) : membersError ? (
          <ErrorState
            variant="inline"
            title="Couldn't load your team."
            body="Tap Try again to reload your team members."
            onRetry={() => refetchMembers()}
          />
        ) : (
          <>
            {activeMembers.map((m) => (
              <Card key={m.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{m.full_name || m.email || "Team member"}</p>
                      {m.role === "owner" && (
                        <Badge variant="sienna" className="text-ds-11 gap-1">
                          <Crown className="w-3 h-3" /> Owner
                        </Badge>
                      )}
                    </div>
                    {m.email && (
                      <p className="text-ds-11 text-muted-foreground truncate">{m.email}</p>
                    )}
                    {m.role !== "owner" && isAdminOrOwner ? (
                      <div className="mt-2 flex items-center gap-2">
                        <label
                          htmlFor={`role-${m.id}`}
                          className="text-ds-11 text-muted-foreground"
                        >
                          Role
                        </label>
                        <select
                          id={`role-${m.id}`}
                          value={m.extended_role}
                          onChange={(e) =>
                            onChangeRole(
                              m.id,
                              e.target.value as Exclude<ExtendedRole, "owner">,
                            )
                          }
                          disabled={savingRole === m.id}
                          className="rounded-ds-sm border border-input bg-background px-2 py-1 text-ds-11"
                        >
                          {ROLE_SPECS.map((spec) => (
                            <option key={spec.id} value={spec.id}>
                              {spec.label}
                            </option>
                          ))}
                        </select>
                        {savingRole === m.id && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    ) : (
                      m.role !== "owner" && (
                        <Badge variant="outline" className="mt-2 text-ds-10">
                          {ROLE_LABEL[m.extended_role]}
                        </Badge>
                      )
                    )}
                  </div>
                  {isAdminOrOwner && m.role !== "owner" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemoveTarget(m)}
                      aria-label="Remove team member"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </Card>
            ))}

            {pendingMembers.length > 0 && (
              <>
                <h3 className="text-ds-13 font-semibold text-muted-foreground px-1 pt-4">
                  Pending invites ({pendingMembers.length})
                </h3>
                {pendingMembers.map((m) => (
                  <Card key={m.id} className="p-4 flex items-center justify-between bg-muted/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Mail className="w-4 h-4 text-muted-foreground" />
                        <p className="font-medium truncate">{m.invited_email}</p>
                        <Badge variant="outline" className="text-ds-10">
                          {ROLE_LABEL[m.extended_role]}
                        </Badge>
                      </div>
                      <p className="text-ds-11 text-muted-foreground mt-0.5">
                        Will join when they sign up with this email
                      </p>
                    </div>
                    {isAdminOrOwner && (
                      <div className="flex items-center gap-1 shrink-0">
                        {m.invited_email && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onResendInvite(m.invited_email!)}
                            aria-label="Resend invite email"
                            title="Resend invite email"
                          >
                            <Send className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemoveTarget(m)}
                          aria-label="Cancel pending invite"
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default MembersTab;
