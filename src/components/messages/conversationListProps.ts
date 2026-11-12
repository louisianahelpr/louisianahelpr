import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { OrderTalkInbox } from "./DeclutterOrderTalkInbox";
import type { SectionEmpty } from "./SectionInboxEmpty";
import type { Conversation } from "./types";

/**
 * The props of ConversationList (the Messages inbox surface). Moved out of ConversationList.tsx verbatim (Q806, the
 * god-component ratchet: that file is over the 600-line threshold); useConversationListState reads it from here.
 */
export interface ConversationListProps {
  conversations: Conversation[];
  /** Full inbox including locally-archived threads — needed for the
   *  hamburger's "Recently Deleted" view, since `conversations` above has
   *  archived threads already filtered out (see useMessagesData). */
  allConversations?: Conversation[];
  loading: boolean;
  loadError: boolean;
  /**
   * Retry for the inbox error state. Must come from the hook rather than
   * being built here from `userId`: `loadError` is true in a branch where
   * `userId` is null by definition, so a `if (userId)` retry is dead in the
   * one state it most needs to work. See useMessagesData.retryInbox.
   */
  retryInbox: () => void | Promise<void>;
  userId: string | null;
  /** Reloads the conversation list — drives retry + pull-to-refresh. */
  loadConversations: (uid: string) => Promise<void>;
  /** Opens a conversation into the chat view. */
  openConvo: (convo: Conversation) => void;
  /** Opens the confirm dialog for hiding one thread (an honest local
   *  archive, not a hard delete). Fired by the row's left swipe. */
  setDeleteConvoConfirm: Dispatch<SetStateAction<Conversation | null>>;
  /** When true, render only the inbox body (no PageScaffold / fixed-
   *  viewport shell, no title card) so the desktop Messages page can host
   *  it as the left pane of a list+thread split. Defaults to false —
   *  mobile/native render the full standalone PageScaffold exactly as
   *  before. The selected thread is highlighted via `activeKey`.
   *
   *  NOTHING IN PRODUCTION PASSES `true` — the desktop list+thread split was
   *  removed (Messages.tsx passes `embedded={false}` on both panes), so every
   *  branch below still keyed on this prop is unreachable outside tests. The
   *  desktop-website behaviours that DO have to ship (the inline tab strip,
   *  the absent disclosure, the sr-only page name) are keyed on
   *  `useIsWebDesktop()` instead. Left in place rather than deleted: it is a
   *  public prop of a shared component and removing it is a separate change,
   *  not a side effect of this one. */
  embedded?: boolean;
  /** `${jobId}_${otherUserId}` of the open thread — used to highlight the
   *  active row in the embedded (desktop split) layout. */
  activeKey?: string | null;
  /** Batch-hide the selected threads (multi-select delete). Reuses the
   *  same honest local-archive semantics as the single-row delete — the
   *  parent opens ONE combined confirm dialog and, on confirm, archives
   *  each. Never a hard delete. */
  onBatchArchive: (convos: Conversation[]) => void;
  /** Bumped by the parent after a batch archive resolves — clears the
   *  in-list selection and exits select mode. */
  resetSelectionNonce?: number;
  /** Messages' section tabs (Jobs | Declutter | Shops | Homes) under the title; absent = no strip. */
  sectionTabs?: ReactNode;
  /** A section tab with no conversations yet: its own empty state, and no Active / All (job states). */
  sectionEmpty?: SectionEmpty | null;
  /** The All / Unread empty inbox's line (messageSections.mainInboxEmptyBody): names Declutter when it is on. */
  mainEmptyBody?: string;
  /** F420: the member's Declutter order chats, drawn as rows among the threads (newest first); null/absent = none here. */
  orderTalks?: OrderTalkInbox | null;
  /** S2-016: the member's shop chats, above the threads under All / Unread (SectionEmpty's Lead shape); null = none. */
  inboxLead?: SectionEmpty["Lead"] | null;
}
