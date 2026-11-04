import { UserAvatar } from "@/components/UserAvatar";
import { typeIcons, MONEY_TYPES } from "./notificationPanelHelpers";
import type { NotificationFace } from "./useNotificationFaces";
import type { Notification } from "./types";

/**
 * The 40px circle at the start of a bell row. Q2037: a job notice caused by a member shows that member's photo
 * (or initials) in place of the type icon; every other notice keeps the type icon on its tint.
 */
export function NotificationLeading({ n, face }: { n: Notification; face: NotificationFace | undefined }) {
  if (n.actor_id && face) {
    return (
      <UserAvatar
        data-notif-face=""
        userId={n.actor_id}
        src={face.avatarUrl}
        name={face.name}
        pixelSize={40}
        className="shrink-0 w-10 h-10"
      />
    );
  }
  const money = MONEY_TYPES.has(n.type);
  return (
    <div
      className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
      data-notif-tint={money ? "money" : "plain"}
      style={
        money
          ? { background: "hsl(var(--burnt-sienna) / 0.12)", color: "hsl(var(--burnt-sienna))" }
          : { background: "hsl(var(--muted))", color: "hsl(var(--bark))" }
      }
    >
      {typeIcons[n.type] || typeIcons.info}
    </div>
  );
}
