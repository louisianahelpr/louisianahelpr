import { UserAvatar } from "@/components/UserAvatar";
import { typeIcons, MONEY_TYPES } from "./notificationPanelHelpers";
import type { NotificationFace } from "./useNotificationFaces";
import type { Notification } from "./types";

/**
 * The start of a bell row. Q2037: a job notice caused by a member shows that member's photo (or initials) in place of
 * the type icon. Every other notice shows its type icon bare, in its tone's colour (polish audit 11-27 #13: no tinted
 * circle behind it; owner rule, no icons in circles).
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
  // Design audit 11-17 #28: every non-money notice sat on the same grey circle. A warning wears the warning tone; the
  // rest a light olive tint. Money keeps rust (rust is money).
  const warn = n.type === "warning";
  const tint = money ? "money" : warn ? "warn" : "plain";
  return (
    <div
      className="shrink-0 w-5 h-5 mt-0.5 flex items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]"
      data-notif-tint={tint}
      style={
        money
          ? { color: "hsl(var(--burnt-sienna))" }
          : warn
            ? { color: "hsl(var(--alert-ink))" }
            : { color: "hsl(var(--bark))" }
      }
    >
      {typeIcons[n.type] || typeIcons.info}
    </div>
  );
}
