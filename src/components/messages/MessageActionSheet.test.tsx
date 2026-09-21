// Pins the "Edit" action's gating rules: sender-only, plain-text-only,
// non-system, and inside the 15-minute window the server's RLS policy also
// enforces (supabase/migrations/20260831003117_add_message_editing.sql).
// A regression here would either hide a legitimately-editable message's
// Edit action, or offer one the server will reject.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MessageActionSheet } from "./MessageActionSheet";
import type { Message } from "./types";

const baseMessage: Message = {
  id: "msg-1",
  job_id: "job-1",
  sender_id: "me",
  receiver_id: "them",
  content: "Hello there",
  read: false,
  created_at: new Date().toISOString(),
  attachment_url: null,
  attachment_mime: null,
  attachment_size: null,
  attachment_duration: null,
};

const noop = () => {};

describe("MessageActionSheet — Edit gating", () => {
  it("offers Edit for my own recent plain-text message", () => {
    render(
      <MessageActionSheet
        message={baseMessage}
        mine
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("hides Edit when the message is not mine", () => {
    render(
      <MessageActionSheet
        message={baseMessage}
        mine={false}
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("hides Edit once the message is older than the 15-minute window", () => {
    const stale: Message = {
      ...baseMessage,
      created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    };
    render(
      <MessageActionSheet
        message={stale}
        mine
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("hides Edit for non-plain-text (photo/location) messages", () => {
    const photo: Message = { ...baseMessage, content: "📷 https://example.com/x.jpg" };
    render(
      <MessageActionSheet
        message={photo}
        mine
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("hides Edit for system messages even when sender_id happens to match", () => {
    const system: Message = { ...baseMessage, is_system: true };
    render(
      <MessageActionSheet
        message={system}
        mine
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("omits Edit entirely when the caller doesn't pass onEdit", () => {
    render(
      <MessageActionSheet
        message={baseMessage}
        mine
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
      />,
    );
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
  });

  it("calls onEdit with the message and closes on click", () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(
      <MessageActionSheet
        message={baseMessage}
        mine
        onClose={onClose}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={onEdit}
      />,
    );
    fireEvent.click(screen.getByText("Edit"));
    expect(onEdit).toHaveBeenCalledWith(baseMessage);
    expect(onClose).toHaveBeenCalled();
  });
});

/**
 * THE OWNERSHIP BRANCH ITSELF, not only the Edit row inside it.
 *
 * HOLLOW SPOT FOUND 2026-09-21. Every `mine`-related case above asserted only
 * `queryByText("Edit")`, and the sheet carries TWO ownership gates: the `mine &&`
 * clause inside `canEdit`, and the `{mine ? (...)}` branch that chooses the whole
 * action list. Breaking either one on its own left Edit hidden by the other, so
 * NEITHER could be shown able to fail — including the outer one, which is the
 * gate that also decides whether Delete is offered. Deleting the other party's
 * message is a bigger refusal than editing it, and nothing here tested it.
 *
 * So the branch is asserted as a whole: an inbound message gets Report + Block
 * and NO Delete; an outbound one gets Delete and NO Report/Block.
 */
describe("MessageActionSheet — the ownership branch picks the whole action list", () => {
  const renderSheet = (mine: boolean) =>
    render(
      <MessageActionSheet
        message={baseMessage}
        mine={mine}
        onClose={noop}
        onReport={noop}
        onBlock={noop}
        onDelete={noop}
        onEdit={noop}
      />,
    );

  it("offers Delete — and no safety actions — on my own message", () => {
    renderSheet(true);
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("Report")).not.toBeInTheDocument();
    expect(screen.queryByText("Block")).not.toBeInTheDocument();
  });

  it("never offers Delete on the other party's message, only Report and Block", () => {
    renderSheet(false);
    // The destructive half of the `mine` branch. `onDelete` is wired straight
    // to the message row's own delete path, so offering it here is offering to
    // destroy someone else's message.
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
    expect(screen.getByText("Report")).toBeInTheDocument();
    expect(screen.getByText("Block")).toBeInTheDocument();
  });
});

// The load-bearing ownership gate: it picks the entire action list, Delete
// included. (The `mine &&` clause inside `canEdit` is defence-in-depth behind
// this one and cannot be killed alone — see the note above.)
// @mutate src/components/messages/MessageActionSheet.tsx | {mine ? ( | {true ? (
// The 15-minute window matches the RLS policy the server enforces; widening it
// offers an edit the server will refuse.
// @mutate src/components/messages/MessageActionSheet.tsx | const EDIT_WINDOW_MS = 15 * 60 * 1000; | const EDIT_WINDOW_MS = 15 * 60 * 60 * 1000;
