import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { dateLabel } from "@/lib/format";
import { tablePresentation } from "@/lib/monitoring/state";
import type {
  ConfiguredTable,
  Correction,
  TableState,
} from "@/lib/monitoring/types";

export function TableCard({
  table,
  states,
  now,
  busy,
  correct,
  staffAction,
  onServed,
  onAcknowledge,
}: {
  table: ConfiguredTable;
  states: TableState[];
  now: number;
  busy: string;
  correct: (id: string, action: Correction) => Promise<void>;
  staffAction: (id: string, action: () => Promise<void>) => Promise<void>;
  onServed: (id: string, visitId: string) => Promise<void>;
  onAcknowledge: (alertId: string) => Promise<void>;
}) {
  const state: TableState = states.find((item) => item.id === table.id) ?? {
    id: table.id,
    name: table.name,
    capacity: table.seats.length,
    count: null,
    occupancy: "unknown",
    cleanliness: "unknown",
    manual: false,
    valid: false,
    evidence: [],
    reason: "Waiting for monitoring",
    observed_at: null,
    updated_at: null,
    visit_id: null,
    arrived_at: null,
    served_at: null,
    service_status: "none",
    alerts: [],
  };
  const view = tablePresentation(state);
  const elapsedSeconds = state.arrived_at
    ? Math.max(0, Math.floor((now - Date.parse(state.arrived_at)) / 1000))
    : 0;
  return (
    <Card
      className="table-state-card min-w-0 gap-0 p-8 [&_p]:my-2.5"
      data-tone={view.tone}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 [&_h3]:text-base [&_h3]:font-medium [&_h3]:break-words">
        <h3>{table.name}</h3>
        <span
          className="text-[32px] font-light tracking-tight tabular-nums"
          aria-label={`${state.count === null ? "Unknown" : state.count} of ${state.capacity} seats occupied`}
        >
          {view.count}
        </span>
      </div>
      <p className="flex items-center gap-2 font-medium">
        <span
          className="size-[7px] rounded-full bg-current"
          aria-hidden="true"
        />
        {view.occupancy}
      </p>
      <p>
        {view.cleanliness}
        {state.manual && (
          <span className="ml-2 inline-block rounded-full border border-border bg-background px-2 py-0.5 text-[10px]">
            Manual correction
          </span>
        )}
      </p>
      {state.evidence.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          Visible items: {state.evidence.join(", ")}
        </p>
      )}
      {state.reason && (
        <p className="text-[13px] text-muted-foreground">{state.reason}</p>
      )}
      <dl className="my-[18px] grid gap-1.5 text-[11px] text-muted-foreground [&_div]:flex [&_div]:justify-between [&_div]:gap-3 [&_dd]:m-0 [&_dd]:text-right">
        <div>
          <dt>Last observed</dt>
          <dd>{dateLabel(state.observed_at)}</dd>
        </div>
        <div>
          <dt>Last change</dt>
          <dd>{dateLabel(state.updated_at)}</dd>
        </div>
      </dl>
      {state.visit_id && (
        <div className="mb-4 text-[13px]">
          <p>
            {state.served_at
              ? `Initial service confirmed · ${dateLabel(state.served_at)}`
              : !state.valid || state.reason
                ? "Service alerts paused — waiting for confirmed observations."
                : `Service wait: ${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s${state.service_status === "overdue" ? " · Initial service overdue" : ""}`}
          </p>
          {!state.served_at && (
            <Button
              variant="outline"
              size="sm"
              disabled={!state.valid || !!state.reason || busy === table.id}
              onClick={() =>
                void staffAction(table.id, () =>
                  onServed(table.id, state.visit_id!),
                )
              }
            >
              Mark served
            </Button>
          )}
        </div>
      )}
      {state.alerts.map((alert) => (
        <div
          key={alert.id}
          className="mb-4 rounded-md border border-border px-3 py-2 text-[13px]"
        >
          <p>
            {alert.kind === "cleaning"
              ? "Cleaning inspection requested"
              : "Initial service requested"}
          </p>
          <p className="text-xs text-muted-foreground">
            Telegram: {alert.delivery_status}
            {alert.delivery_status === "pending" &&
              " (requires enabled delivery)"}
            {alert.last_error && ` · ${alert.last_error.replaceAll("_", " ")}`}
          </p>
          {alert.kind === "cleaning" &&
            (alert.acknowledged_at ? (
              <p className="text-xs">
                Acknowledged · {dateLabel(alert.acknowledged_at)}
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!state.valid || !!state.reason || busy === table.id}
                onClick={() =>
                  void staffAction(table.id, () => onAcknowledge(alert.id))
                }
              >
                Acknowledge
              </Button>
            ))}
        </div>
      ))}
      <ToggleGroup
        className="table-status-tabs"
        spacing={0}
        multiple={false}
        aria-label={`${table.name} cleaning correction`}
        aria-describedby={
          state.manual ? `correction-help-${table.id}` : undefined
        }
        disabled={!state.valid || busy === table.id}
        value={state.manual && state.valid ? [state.cleanliness] : []}
        onValueChange={(values) => {
          const action = values[0];
          if (action === "looks_clear" || action === "needs_cleaning")
            void correct(table.id, action);
          else if (state.manual) void correct(table.id, "automatic");
        }}
      >
        <ToggleGroupItem value="looks_clear">Looks clear</ToggleGroupItem>
        <ToggleGroupItem value="needs_cleaning">Needs cleaning</ToggleGroupItem>
      </ToggleGroup>
      {state.manual && (
        <p
          id={`correction-help-${table.id}`}
          className="text-xs text-muted-foreground"
        >
          Select the active status again to resume automatic monitoring.
        </p>
      )}
    </Card>
  );
}
