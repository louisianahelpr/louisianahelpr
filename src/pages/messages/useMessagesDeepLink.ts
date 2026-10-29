import { useState } from "react";
import { threadFromChatFlag } from "./constants";

/** The thread the Messages page should open from its URL, plus the thread a resumed open-chat flag names. */
export function useMessagesDeepLink(searchParams: URLSearchParams) {
  // F27: the thread a URL we MOUNTED on names in its open-chat flag (`?chat=<jobId>&with=<userId>`):
  // a resume from route memory, a reload, a shared link. Read once, at mount: once this page is
  // running, the flag follows the thread the user opens (chatOpenPath), and reading it live would
  // send every inbox tap back through the deep-link loader.
  const [resumedThread] = useState(() => threadFromChatFlag(searchParams));
  const deepLinkJobId = searchParams.get("jobId") ?? resumedThread?.jobId ?? null;
  const deepLinkUserId = searchParams.get("userId") ?? resumedThread?.userId ?? null;
  // `?teamThread=<user>` — a "Louisiana Helpr Team" thread (src/lib/teamThread.ts).
  const deepLinkTeamUserId = searchParams.get("teamThread") ?? resumedThread?.teamUserId ?? null;
  return { resumedThread, deepLinkJobId, deepLinkUserId, deepLinkTeamUserId };
}
