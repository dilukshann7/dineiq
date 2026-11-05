import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateLabel } from "@/lib/format";
import type { MonitoringClient } from "@/lib/monitoring/client";
import type { HistoryPage, Layout } from "@/lib/monitoring/types";

export function TableHistory({
  layout,
  client,
}: {
  layout: Layout | null;
  client: MonitoringClient;
}) {
  const [filter, setFilter] = useState("");
  const [history, setHistory] = useState<HistoryPage>({
    events: [],
    next_before: null,
  });
  const [historyError, setHistoryError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const historyOptions = [
    { value: "", label: "All tables" },
    ...(layout?.tables.map((table) => ({
      value: table.id,
      label: table.name,
    })) ?? []),
  ];
  const requestId = useRef(0);
  useEffect(() => {
    let active = true;
    const currentRequest = ++requestId.current;
    async function loadHistory() {
      setLoading(true);
      setHistoryError("");
      try {
        const page = await client.history(undefined, filter || undefined);
        if (active) setHistory(page);
      } catch (cause: unknown) {
        if (active)
          setHistoryError(
            cause instanceof Error ? cause.message : "Could not load history.",
          );
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadHistory();
    return () => {
      active = false;
      requestId.current = currentRequest + 1;
    };
  }, [client, filter, refresh]);

  async function more() {
    if (!history.next_before || loading) return;
    setLoading(true);
    setHistoryError("");
    const currentRequest = requestId.current;
    try {
      const page = await client.history(
        history.next_before,
        filter || undefined,
      );
      if (currentRequest === requestId.current)
        setHistory((previous) => ({
          events: [...previous.events, ...page.events],
          next_before: page.next_before,
        }));
    } catch (cause) {
      if (currentRequest === requestId.current)
        setHistoryError(
          cause instanceof Error ? cause.message : "Could not load history.",
        );
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }
  return (
    <div className="camera-panel">
      <section aria-labelledby="history-title">
        <div className="dashboard-section-header">
          <div>
            <h2 id="history-title">History</h2>
            <p className="text-[13px] text-muted-foreground">
              Recorded table changes, manual corrections, and camera events.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label htmlFor="history-table-filter" className="text-[13px]">
            Table
          </label>
          <Select
            items={historyOptions}
            value={filter}
            disabled={loading}
            onValueChange={(value) => {
              if (value === null) return;
              setFilter(value);
              setLoading(true);
              setHistoryError("");
            }}
          >
            <SelectTrigger
              id="history-table-filter"
              className="w-52 min-w-0 max-w-full bg-background"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {historyOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            disabled={loading}
            onClick={() => {
              setRefresh((value) => value + 1);
              setLoading(true);
              setHistoryError("");
            }}
          >
            Refresh history
          </Button>
        </div>
        <Card
          className="history-card mt-6 gap-0 p-8 [&_ol]:m-0 [&_ol]:mb-3 [&_ol]:list-none [&_ol]:p-0 [&_li]:grid [&_li]:grid-cols-1 [&_li]:gap-1 [&_li]:border-b [&_li]:border-border [&_li]:py-4 [&_li]:text-xs [&_li]:break-words sm:[&_li]:grid-cols-[160px_120px_1fr] sm:[&_li]:gap-3 [&_time]:text-muted-foreground"
          aria-live="polite"
        >
          {historyError && (
            <p
              role="alert"
              className="my-3 flex flex-col items-start justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 text-[13px] text-foreground sm:flex-row sm:items-center"
            >
              {historyError}
            </p>
          )}
          {!loading && history.events.length === 0 && !historyError && (
            <p className="text-[13px] text-muted-foreground">
              No recorded events yet.
            </p>
          )}
          <ol>
            {history.events.map((event) => (
              <li key={event.id}>
                <time dateTime={event.at}>
                  {dateLabel(event.at)}
                  <br />
                  <small>
                    {event.actor?.kind === "user"
                      ? `${event.actor.display_name} (@${event.actor.username})`
                      : event.actor?.kind === "system"
                        ? "System"
                        : "Unattributed (before accounts)"}
                  </small>
                </time>
                <span>
                  {layout?.tables.find((table) => table.id === event.table_id)
                    ?.name ?? (event.table_id ? "Previous table" : "Camera")}
                </span>
                <span>
                  {event.kind.replaceAll("_", " ")}
                  {event.kind === "table_state"
                    ? ` · ${String(event.data.occupancy).replaceAll("_", " ")} · ${String(event.data.cleanliness).replaceAll("_", " ")}`
                    : event.kind === "manual_correction"
                      ? ` · ${String(event.data.action).replaceAll("_", " ")}`
                      : event.kind.startsWith("alert_")
                        ? ` · ${String(event.data.kind)} · ${String(event.data.delivery_status)}${event.data.error ? ` · ${String(event.data.error).replaceAll("_", " ")}` : ""}`
                        : ""}
                </span>
              </li>
            ))}
          </ol>
          {loading && (
            <p className="text-[13px] text-muted-foreground">
              Loading history…
            </p>
          )}
          {history.next_before && (
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => void more()}
            >
              Load older events
            </Button>
          )}
        </Card>
      </section>
    </div>
  );
}
