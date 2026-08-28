// Who am I talking to? — the one question the Messages inbox exists to answer.
//
// Two real defects, both observed on a signed-in device, motivate this file:
//
//  1. A thread rendered a name from one person and an avatar from another. The
//     loader built the name and the avatar into two SEPARATE `Map`s; nothing
//     structurally tied them to the same row, so they were free to disagree.
//  2. A thread whose counterparty id happened to be a `profiles.id` rather than
//     an auth `user_id` resolved to nothing and fell through to the literal
//     word "User". `messages.sender_id` / `receiver_id` carry no foreign key,
//     so both kinds of id genuinely occur — prod has such a thread today.
//
// The tests below pin the invariant that fixes both: for a conversation the
// loader could resolve, the displayed name and the avatar come out of ONE
// profile record, and neither is the unresolved-person fallback.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => fromMock(table),
    rpc: (fn: string, args: unknown) => rpcMock(fn, args),
  },
}));

vi.mock("@/lib/userBlocks", () => ({
  getBlockedUserIds: async () => new Set<string>(),
}));
vi.mock("@/lib/messageAttachments", () => ({
  getMessageAttachmentSignedUrls: async () => ({}),
  isImageMime: () => false,
  getMessageAttachmentSignedUrl: async () => null,
}));
vi.mock("@/lib/threadMutes", () => ({
  getMutedThreadMap: async () => new Map(),
  threadMuteKey: (jobId: string, otherUserId: string) => `${jobId}_${otherUserId}`,
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { fetchConversations } from "./loadConversations";
import { ConversationRow } from "@/components/messages/ConversationRow";

// Real prod ids, so the fixture describes the exact shape that broke.
const ME = "76b07824-9b41-4741-a4c4-4f8de362f682";
const CAMILLE_AUTH = "11111111-1111-1111-1111-111111111101";
const ELI_AUTH = "11111111-1111-1111-1111-111111111104";
// Marie's PROFILE id — a different uuid from her auth id (…-103). The seeded
// thread on job …0008 stores this in `receiver_id`, which is what used to make
// her thread resolve to "User".
const MARIE_AUTH = "11111111-1111-1111-1111-111111111103";
const MARIE_PROFILE = "9de6198d-0949-45bd-bc8e-389dd666401f";

const CAMILLE_AVATAR = "https://cdn.example.test/camille.png";
const MARIE_AVATAR = "https://cdn.example.test/marie.png";

/** Chainable, awaitable stand-in for a PostgREST query builder. */
function makeBuilder(response: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "or", "order", "limit", "in", "eq", "maybeSingle"]) {
    builder[method] = () => builder;
  }
  builder.then = (
    onFulfilled?: (value: unknown) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(onFulfilled, onRejected);
  return builder;
}

function message(over: Record<string, unknown>) {
  return {
    id: `m-${Math.random()}`,
    job_id: "job-1",
    sender_id: ME,
    receiver_id: CAMILLE_AUTH,
    content: "See you then",
    read: true,
    created_at: "2026-08-17T10:00:00.000Z",
    attachment_url: null,
    attachment_mime: null,
    is_system: false,
    ...over,
  };
}

/** The rows `get_safe_profiles` returns once it resolves by either id. */
const PROFILE_ROWS = [
  {
    user_id: CAMILLE_AUTH,
    profile_id: "1e4e62f3-a809-4a6d-a5f9-cf045d36fd8f",
    full_name: "Camille Robicheaux",
    avatar_url: CAMILLE_AVATAR,
  },
  {
    user_id: ELI_AUTH,
    profile_id: "6bdc1f67-ae1f-46a0-8edf-4035629a6147",
    full_name: "Eli Thibodeaux",
    // No photo — this is the row whose avatar falls back to initials, which is
    // what lets the render test below compare initials against the name.
    avatar_url: null,
  },
  {
    user_id: MARIE_AUTH,
    profile_id: MARIE_PROFILE,
    full_name: "Marie Hebert",
    avatar_url: MARIE_AVATAR,
  },
];

let messagesResponse: unknown;
let profilesResponse: unknown;

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();

  messagesResponse = { data: [], error: null };
  profilesResponse = { data: PROFILE_ROWS, error: null };

  fromMock.mockImplementation((table: string) => {
    if (table === "messages") return makeBuilder(messagesResponse);
    if (table === "jobs") {
      return makeBuilder({
        data: [
          { id: "job-1", title: "Fix the fence", status: "open", customer_id: ME },
          { id: "job-2", title: "Move a couch", status: "open", customer_id: ME },
          { id: "job-3", title: "Walk the dog", status: "open", customer_id: ME },
        ],
        error: null,
      });
    }
    return makeBuilder({ data: [], error: null });
  });

  rpcMock.mockImplementation(async (fn: string) => {
    if (fn === "get_safe_profiles") return profilesResponse;
    return { data: [], error: null };
  });
});

const thumbRef = () => ({ current: false });

describe("fetchConversations — counterparty identity", () => {
  it("resolves auth-user-id threads to the real person, name and avatar from the same profile", async () => {
    messagesResponse = {
      data: [
        message({ job_id: "job-1", receiver_id: CAMILLE_AUTH }),
        message({ job_id: "job-2", sender_id: ELI_AUTH, receiver_id: ME }),
      ],
      error: null,
    };

    const convos = await fetchConversations(ME, thumbRef());
    const byId = new Map(convos.map((c) => [c.otherUserId, c]));

    // Real names, not the fallback.
    expect(byId.get(CAMILLE_AUTH)?.otherUserName).toBe("Camille R.");
    expect(byId.get(ELI_AUTH)?.otherUserName).toBe("Eli T.");

    // …and the avatar on each row belongs to THAT person. This is the
    // assertion the two-map version could not make: Camille's row must not
    // carry Eli's face, and vice versa.
    expect(byId.get(CAMILLE_AUTH)?.otherUserAvatarUrl).toBe(CAMILLE_AVATAR);
    expect(byId.get(ELI_AUTH)?.otherUserAvatarUrl).toBeNull();
    for (const c of convos) {
      expect(c.otherUserName).not.toBe("User");
      expect(c.otherUserName).not.toBe("A neighbor");
    }
  });

  it("resolves a thread whose participant id is a profiles.id, not an auth id", async () => {
    // The real prod row: `receiver_id` holds Marie's profile PK.
    messagesResponse = {
      data: [message({ job_id: "job-3", receiver_id: MARIE_PROFILE })],
      error: null,
    };

    const [convo] = await fetchConversations(ME, thumbRef());

    expect(convo.otherUserName).toBe("Marie H.");
    // Same record backs the face — resolving by the second key must not hand
    // back a name with a missing or mismatched avatar.
    expect(convo.otherUserAvatarUrl).toBe(MARIE_AVATAR);
  });

  it("surfaces a failed profile lookup instead of renaming every thread 'User'", async () => {
    messagesResponse = {
      data: [message({ job_id: "job-1", receiver_id: CAMILLE_AUTH })],
      error: null,
    };
    profilesResponse = { data: null, error: { message: "permission denied" } };

    // An inbox full of anonymous rows looks loaded but answers nothing. The
    // query must fail loudly so the page can offer a retry.
    await expect(fetchConversations(ME, thumbRef())).rejects.toThrow(
      "permission denied",
    );
  });
});

describe("ConversationRow — the avatar agrees with the name", () => {
  it("draws its initial from the same resolved profile as the displayed name", async () => {
    messagesResponse = {
      data: [message({ job_id: "job-2", sender_id: ELI_AUTH, receiver_id: ME })],
      error: null,
    };
    const [convo] = await fetchConversations(ME, thumbRef());

    const { container } = render(
      <ConversationRow
        convo={convo}
        currentUserId={ME}
        openConvo={vi.fn()}
      />,
    );

    // The name the row shows.
    expect(screen.getByText("Eli T.")).toBeInTheDocument();

    // The letter in the avatar circle. It has no photo, so the fallback
    // initial is what renders — and it must be Eli's, not some other
    // person's (the observed bug drew "DG" beside "Eli T.").
    const avatar = container.querySelector<HTMLElement>(".rounded-full.w-11, .w-11.rounded-full");
    expect(avatar).not.toBeNull();
    const initial = within(avatar!).getByText(/^[A-Z]$/).textContent;
    expect(initial).toBe("E");
    // Both derive from one string, so they cannot disagree — assert the
    // relationship, not just the literal.
    expect(initial).toBe(convo.otherUserName.charAt(0).toUpperCase());
    // And it is a real person's initial, not the fallback's.
    expect(initial).not.toBe("U");
    expect(initial).not.toBe("A");
  });
});

// The poster-first composer lock is meant to hold only while an application is
// PENDING. It used to key off "not the poster", so it survived acceptance and
// silenced the hired helper mid-job — while `public.can_message_in_job` (the
// WITH CHECK on the messages INSERT policy) would have accepted the write.
// These pin the flag the lock now reads, so the client can never drift back to
// being stricter than the RLS rule it mirrors.
describe("fetchConversations — viewerIsAssignedHelper mirrors can_message_in_job", () => {
  const POSTER = CAMILLE_AUTH;

  function withJobs(rows: Record<string, unknown>[]) {
    fromMock.mockImplementation((table: string) => {
      if (table === "messages") return makeBuilder(messagesResponse);
      if (table === "jobs") return makeBuilder({ data: rows, error: null });
      return makeBuilder({ data: [], error: null });
    });
  }

  beforeEach(() => {
    messagesResponse = {
      data: [message({ job_id: "job-1", sender_id: ME, receiver_id: POSTER })],
      error: null,
    };
  });

  it("is true when the viewer is the job's assigned helper", async () => {
    withJobs([
      { id: "job-1", title: "Mow a corner lot", status: "in_progress", customer_id: POSTER, helper_id: ME, offered_to_helper_id: null },
    ]);
    const [convo] = await fetchConversations(ME, thumbRef());
    expect(convo.viewerIsPoster).toBe(false);
    expect(convo.viewerIsAssignedHelper).toBe(true);
  });

  it("is true when the job is merely OFFERED to the viewer", async () => {
    withJobs([
      { id: "job-1", title: "Mow a corner lot", status: "open", customer_id: POSTER, helper_id: null, offered_to_helper_id: ME },
    ]);
    const [convo] = await fetchConversations(ME, thumbRef());
    expect(convo.viewerIsAssignedHelper).toBe(true);
  });

  it("is FALSE for a pending applicant — the poster-first lock must still apply", async () => {
    withJobs([
      { id: "job-1", title: "Mow a corner lot", status: "open", customer_id: POSTER, helper_id: null, offered_to_helper_id: null },
    ]);
    const [convo] = await fetchConversations(ME, thumbRef());
    expect(convo.viewerIsPoster).toBe(false);
    expect(convo.viewerIsAssignedHelper).toBe(false);
  });

  it("does not mistake the poster for the assigned helper", async () => {
    withJobs([
      { id: "job-1", title: "Mow a corner lot", status: "in_progress", customer_id: ME, helper_id: POSTER, offered_to_helper_id: null },
    ]);
    const [convo] = await fetchConversations(ME, thumbRef());
    expect(convo.viewerIsPoster).toBe(true);
    expect(convo.viewerIsAssignedHelper).toBe(false);
  });
});
