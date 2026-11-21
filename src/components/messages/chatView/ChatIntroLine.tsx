import { getLang, t } from "@/lib/i18n/language";
import "@/lib/i18n/enMessages";

/**
 * The line that opens a thread (owner-approved polish 2026-11-20): "Conversation
 * with Perry P. · started Nov 3". A short thread now starts near the top of the
 * pane under this line instead of sinking to the bottom under a blank band.
 * Drawn only when the thread's first message is loaded (no older page left), so
 * "started" is the real start; after a "delete for me" it is the first message
 * the member still sees.
 */
export function ChatIntroLine({ name, firstAt }: { name: string; firstAt: string }) {
  const d = new Date(firstAt);
  if (!Number.isFinite(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const date = d.toLocaleDateString(getLang() === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return (
    <p data-chat-intro="" className="px-4 pb-3 text-center font-sans text-ds-12 text-muted-foreground">
      {t("msg.introLine", { name, date })}
    </p>
  );
}
