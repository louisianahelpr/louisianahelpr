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
