// Parts of the /support contact form, split out of Support.tsx to keep it under the component size cap
// (componentSizeRatchet): the inline field error, the topic picker (F042: the common reasons to write in) and a
// guest's matching Help answers (F046).
import { Link } from "react-router-dom";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORT_TOPICS, type SupportTopicKey, findSupportTopic } from "@/lib/supportTopics";

/** Inline field error — same shape as AddCalendarForm's budget error
 *  (role="alert" + the id the input points at via aria-describedby).
 *  Renders nothing when there's no message, so call sites stay flat. */
export const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? (
    <p
      id={id}
      role="alert"
      className="mt-1.5 font-sans text-ds-11 leading-snug"
      style={{ color: "hsl(var(--burnt-sienna))" }}
    >
      {message}
    </p>
  ) : null;

/** "What's this about?": the topic select, its error, or the chosen topic's one-line description. */
export function SupportTopicField({
  value,
  error,
  onChange,
}: {
  value: SupportTopicKey | "";
  error?: string;
  onChange: (value: SupportTopicKey) => void;
}) {
  const selectedTopic = findSupportTopic(value);
  return (
    <div>
      <Label htmlFor="support-topic" className="text-ds-11">
        What&apos;s this about? *
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v as SupportTopicKey)}>
        <SelectTrigger
          id="support-topic"
          className="mt-1.5"
          aria-invalid={!!error}
          aria-describedby={error ? "support-topic-error" : undefined}
        >
          <SelectValue placeholder="Choose a topic" />
        </SelectTrigger>
        <SelectContent>
          {SUPPORT_TOPICS.map((topic) => (
            <SelectItem key={topic.key} value={topic.key}>
              {topic.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldError id="support-topic-error" message={error} />
      ) : (
        selectedTopic && (
          <p
            className="mt-1.5 font-sans text-ds-11 leading-snug"
            style={{ color: "hsl(var(--olivewood) / 0.75)" }}
          >
            {selectedTopic.description}
          </p>
        )
      )}
    </div>
  );
}

/** F046 (owner 11-09): a guest gets up to three Help answers matching the subject, before writing in. */
export function SupportSuggestions({ items }: { items: ReadonlyArray<{ q: string; href: string }> }) {
  return (
    <div data-support-suggestions="" className="rounded-ds-md border border-border bg-card px-4 py-3">
      <p className="text-ds-13 font-semibold text-foreground">These answers might help</p>
      <ul className="mt-1.5 space-y-1">
        {items.map((s) => (
          <li key={s.q}>
            <Link to={s.href} className="text-ds-13 font-medium underline underline-offset-4" style={{ color: "hsl(var(--bark))" }}>
              {s.q}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
