/**
 * AL-6 (owner 2026-10-28, "Chats saved and filtered"): on a reported Declutter problem the admin reads the handover
 * chat the buyer and seller had while the items waited in the cart, and the questions asked on the items with their
 * answers (declutter_admin_problem_talk, admin only). Who wrote each line is a side, never a name: "Buyer",
 * "Seller", or "Another member" for a question someone else asked. A question the app hid is kept and marked.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchProblemTalk, type ProblemTalkRow } from "@/lib/declutter/adminProblemCase";
import { declutterErrorMessage } from "@/lib/declutter/errors";

const SIDE: Record<ProblemTalkRow["side"], string> = { buyer: "Buyer", seller: "Seller", another_member: "Another member" };
const when = (iso: string) => new Date(iso).toLocaleString();

export function ProblemTalk({ problemId }: { problemId: string }) {
  const talk = useQuery({ queryKey: ["declutter", "admin-problem-talk", problemId], queryFn: () => fetchProblemTalk(problemId) });
  if (talk.isError) {
    return (
      <p className="text-xs" role="alert">
        The chat couldn't load: {declutterErrorMessage(talk.error)}{" "}
        <button type="button" className="underline" onClick={() => void talk.refetch()}>Try again</button>
      </p>
    );
  }
  // Not on the server yet (PGRST202): nothing to show, as before.
  if (talk.isPending || talk.data === null) return null;
  const chat = talk.data.filter((r) => r.kind === "chat");
  const questions = talk.data.filter((r) => r.kind === "question");
  return (
    <section className="space-y-2" aria-label="Chat and questions" data-problem-talk="">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Chat and questions</h4>
      {chat.length === 0 && questions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No chat and no questions on these items.</p>
      ) : null}
      {chat.length > 0 && (
        <ol className="space-y-1.5" aria-label="Handover chat">
          {chat.map((m, i) => (
            <li key={`c${i}`} className="rounded-lg border border-border px-2.5 py-1.5 text-sm">
              <span className="block text-xs font-medium text-muted-foreground">{SIDE[m.side]} · {when(m.said_at)}</span>
              <span className="whitespace-pre-line [overflow-wrap:anywhere]">{m.body}</span>
            </li>
          ))}
        </ol>
      )}
      {questions.length > 0 && (
        <ol className="space-y-1.5" aria-label="Questions on the items">
          {questions.map((q, i) => (
            <li key={`q${i}`} className="rounded-lg border border-border px-2.5 py-1.5 text-sm">
              <span className="block text-xs font-medium text-muted-foreground">
                Question from {SIDE[q.side].toLowerCase()} · {when(q.said_at)}{q.removed ? " · hidden in the app" : ""}
              </span>
              <span className="block whitespace-pre-line [overflow-wrap:anywhere]">{q.body}</span>
              {q.answer ? (
                <span className="mt-1 block whitespace-pre-line text-muted-foreground [overflow-wrap:anywhere]">
                  Seller's answer{q.answered_at ? ` · ${when(q.answered_at)}` : ""}: {q.answer}
                </span>
              ) : (
                <span className="mt-1 block text-xs text-muted-foreground">Not answered.</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
