import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hapticLight, hapticSuccess } from "@/lib/haptics";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  UserPlus,
  ChevronRight,
} from "lucide-react";

// ─── Invite form ─────────────────────────────────────────────────────────────

export function InviteForm({ myUserId }: { myUserId: string }) {
  const [contact, setContact] = useState("");
  const [relationship, setRelationship] = useState("child");
  const [showForm, setShowForm] = useState(false);
  // The generated invite link is only ever shown once — keep it on screen
  // (not just in a toast) so a failed clipboard write can't lose the token.
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const qc = useQueryClient();

  const inviteMut = useMutation({
    mutationFn: async () => {
      const token = crypto.randomUUID();
      // Exact-match lookup, NOT `.ilike`: in a LIKE/ILIKE pattern `%` and `_`
      // are wildcards, so an input like "admin%" would match somebody else's
      // account and mint a care_relationships row pointing at it. Auth stores
      // emails lowercased (every profiles.email row is already lower-case), so
      // lowercasing the input preserves the case-insensitive behaviour without
      // exposing any wildcard surface.
      const lookupRes = await supabase
        .from("profiles")
        .select("user_id")
        .eq("email", contact.trim().toLowerCase())
        .maybeSingle();
      if (lookupRes.error) throw lookupRes.error;

      if (!lookupRes.data) {
        // No existing account — store a pending invite with token only;
        // when they sign up and visit the link, they can accept.
        throw new Error(
          "No account found for that email. Ask them to sign up first, then share the invite link."
        );
      }

      const recipientId = lookupRes.data.user_id;
      const res = await supabase.from("care_relationships").insert({
        caregiver_id: myUserId,
        care_recipient_id: recipientId,
        relationship,
        permissions: ["view_jobs", "post_jobs", "message_helpers"],
        status: "pending",
        invite_token: token,
      });
      if (res.error) throw res.error;
      return token;
    },
    onSuccess: async (token) => {
      hapticSuccess();
      const url = `${window.location.origin}/family/accept/${token}`;
      // Nothing is emailed here — we only create a pending invite row and hand
      // the caller a link, so the copy must not claim the invite was "sent".
      // The clipboard API rejects outright in a non-secure context and in some
      // Capacitor WebViews; the old un-caught `.then()` meant that rejection
      // showed NO toast at all and the one-time token vanished. Await it in a
      // try/catch and succeed loudly either way.
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        // Deliberately never log the URL — it carries the invite token.
        report(new Error("Clipboard write failed for family invite link"), {
          severity: "info",
          tags: { source: "FamilyDashboard.invite.clipboard" },
        });
      }
      setInviteUrl(url);
      toast.success(
        copied ? "Invite link created — copied to clipboard" : "Invite link created — copy it below",
        { description: "Send them the link. The invite stays pending until they open it and approve." },
      );
      setContact("");
      setShowForm(false);
      void qc.invalidateQueries({ queryKey: ["care_relationships", myUserId] });
    },
    onError: (err: Error) => {
      report(err, { severity: "warning", tags: { source: "FamilyDashboard.invite" } });
      toast.error(err.message || "Couldn't create the invite — try again.");
    },
  });

  // Persistent copy of the freshly-minted invite link. Stays until dismissed
  // so the token survives a clipboard failure (or a toast the user missed).
  const linkPanel = inviteUrl ? (
    <div
      className="rounded-ds-md p-3 space-y-2"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
      }}
    >
      <p className="text-ds-12 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
        Invite link — send this to them
      </p>
      <p
        className="text-ds-11 break-all select-all"
        style={{ color: "hsl(var(--olivewood))" }}
      >
        {inviteUrl}
      </p>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="h-9 flex-1 text-ds-12"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(inviteUrl);
              toast.success("Link copied");
            } catch {
              toast.error("Couldn't copy — select the link above and copy it manually.");
            }
          }}
        >
          Copy link
        </Button>
        <Button variant="ghost" className="h-9 flex-1 text-ds-12" onClick={() => setInviteUrl(null)}>
          Done
        </Button>
      </div>
    </div>
  ) : null;

  if (!showForm) {
    return (
      <div className="space-y-2">
        {linkPanel}
        <button
          onClick={() => { hapticLight(); setShowForm(true); }}
          className="w-full flex items-center gap-2.5 h-12 px-4 rounded-ds-md text-ds-14 font-sans font-medium active:scale-[0.98] transition-all"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "0.5px dashed hsl(var(--bark) / 0.3)",
            color: "hsl(var(--bark))",
          }}
        >
          <UserPlus className="w-4 h-4" />
          Add a family member
          <ChevronRight className="w-4 h-4 ml-auto opacity-50" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
    {linkPanel}
    <div
      className="rounded-ds-md p-4 space-y-3"
      style={{
        background: "hsl(var(--ivory-sand))",
        border: "0.5px solid hsl(var(--sand) / 0.6)",
      }}
    >
      <p className="font-sans font-semibold text-ds-15" style={{ color: "hsl(var(--ink-deep))" }}>
        Invite a family member
      </p>
      <p className="text-ds-12 font-serif italic" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Enter their email. They'll get an invite link to approve your access.
      </p>
      <Input
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="Email address"
        type="email"
        inputMode="email"
        autoComplete="email"
        className="h-11"
        aria-label="Family member email address"
      />
      <div className="flex gap-2">
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          aria-label="Relationship to family member"
          className="flex-1 h-11 rounded-ds-sm px-3 text-ds-13 font-sans border"
          style={{
            background: "hsl(var(--ivory-sand))",
            borderColor: "hsl(var(--sand))",
            color: "hsl(var(--ink-deep))",
          }}
        >
          <option value="child">Child</option>
          <option value="spouse">Spouse</option>
          <option value="sibling">Sibling</option>
          <option value="friend">Friend</option>
          <option value="professional_caregiver">Professional caregiver</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-1 h-11"
          onClick={() => setShowForm(false)}
          disabled={inviteMut.isPending}
        >
          Cancel
        </Button>
        <Button
          className="flex-1 h-11"
          onClick={() => inviteMut.mutate()}
          disabled={!contact.trim() || inviteMut.isPending}
        >
          {inviteMut.isPending ? "Creating…" : "Create invite link"}
        </Button>
      </div>
    </div>
    </div>
  );
}
