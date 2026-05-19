/**
 * Open-job limit notice — surfaced at form mount so the user
 * discovers the 5-job cap before filling the whole form, not at submit.
 */
export function OpenJobLimitNotice() {
  return (
    <div
      className="rounded-ds-md p-4 flex items-start gap-3"
      style={{
        background: "hsl(var(--destructive) / 0.07)",
        border: "1px solid hsl(var(--destructive) / 0.35)",
      }}
      role="alert"
    >
      <div className="flex-1 min-w-0">
        <p className="text-ds-13 font-semibold" style={{ color: "hsl(var(--destructive))" }}>
          You have 5 open jobs
        </p>
        <p className="text-ds-11 text-muted-foreground mt-0.5">
          Helpr allows a maximum of 5 open jobs at a time. Close or complete an existing job before posting a new one.
        </p>
      </div>
    </div>
  );
}
