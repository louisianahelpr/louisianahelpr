/**
 * The second line of an Active sessions row (Account and security).
 *
 * Q2649 (account audit 1102d row 8): the row of the device in use read "Last seen Oct 20" while it was signed in
 * right then (login_history only records sign-ins, so its newest row can be weeks old), and the parts were joined
 * by a margin, not a space ("Oct 20· 22 sign-ins" to a screen reader and to copy-paste). The device in use says
 * "Active now"; every part is joined by " · ".
 */
export function sessionSeenWords(opts: {
  isThisDevice: boolean;
  lastSeenAt: string | number | Date;
  ipAddress?: string | null;
  count: number;
  now?: number;
}): string {
  const now = opts.now ?? Date.now();
  const lastSeen = new Date(opts.lastSeenAt);
  const minsAgo = Math.floor((now - lastSeen.getTime()) / 60_000);
  const when =
    minsAgo < 2 ? "just now" :
    minsAgo < 60 ? `${minsAgo}m ago` :
    minsAgo < 60 * 24 ? `${Math.floor(minsAgo / 60)}h ago` :
    minsAgo < 60 * 24 * 7 ? `${Math.floor(minsAgo / (60 * 24))}d ago` :
    lastSeen.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const parts = [opts.isThisDevice ? "Active now" : `Last seen ${when}`];
  if (opts.ipAddress) parts.push(opts.ipAddress);
  if (opts.count > 1) parts.push(`${opts.count} sign-ins`);
  return parts.join(" · ");
}
