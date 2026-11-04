import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { Correction, Layout, TableState } from "@/lib/monitoring/types";
import { TableCard } from "./TableCard";
import "./tables.css";

export function TableDashboard({
  admin,
  layout,
  layoutLoading,
  states,
  enabled,
  live,
  error,
  onConfigure,
  onToggle,
  onReload,
  onCorrect,
  onServed,
  onAcknowledge,
  now,
  children,
}: {
  admin: boolean;
  layout: Layout | null;
  layoutLoading: boolean;
  states: TableState[];
  enabled: boolean;
  live: boolean;
  error: string;
  onConfigure: () => void;
  onToggle: () => void;
  onReload: () => void;
  onCorrect: (id: string, action: Correction) => Promise<void>;
  onServed: (id: string, visitId: string) => Promise<void>;
  onAcknowledge: (alertId: string) => Promise<void>;
  now: number;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState("");
  async function correct(id: string, action: Correction) {
    setBusy(id);
    try {
      await onCorrect(id, action);
    } finally {
      setBusy("");
    }
  }

  async function staffAction(tableId: string, action: () => Promise<void>) {
    setBusy(tableId);
    try {
      await action();
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="camera-panel">
      {children ?? (
        <section aria-labelledby="tables-title">
          <div className="dashboard-section-header">
            <div>
              <h2 id="tables-title">Tables</h2>
              <p>
                {layoutLoading
                  ? "Loading table setup…"
                  : layout
                    ? `Setup revision ${layout.revision} · ${layout.tables.length} configured tables`
                    : "Configure tabletops and seats to begin monitoring."}
              </p>
            </div>
            {admin && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={!live || layoutLoading}
                  onClick={onConfigure}
                >
                  Configure tables
                </Button>
                <Button
                  disabled={
                    !live ||
                    layoutLoading ||
                    !layout
                  }
                  onClick={onToggle}
                >
                  {enabled ? "Stop monitoring" : layout?.recalibration_required ? "Retry verification" : "Start monitoring"}
                </Button>
              </div>
            )}
          </div>
          {error && (
            <div
              className="my-3 flex flex-col items-start justify-between gap-3 rounded-md border border-border bg-muted px-4 py-3 text-[13px] text-foreground sm:flex-row sm:items-center"
              role="alert"
            >
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={onReload}>
                Retry connection
              </Button>
            </div>
          )}
          {layout?.recalibration_required && (
            <p
              className="my-3 flex flex-col items-start justify-between gap-3 rounded-md border border-border bg-muted px-4 py-3 text-[13px] text-foreground sm:flex-row sm:items-center"
              role="alert"
            >
              {admin
                ? "Layout mismatch. Monitoring will retry verification. If the room or table setup changed, open Configure tables and save the reviewed setup."
                : "Camera position is unverified. Ask an admin to reconfirm table setup."}
            </p>
          )}
          {enabled && layout?.matching_status === "verifying" && !layout.recalibration_required && (
            <p className="my-3 text-[13px] text-muted-foreground" role="status">
              Verifying table and seat positions. Uncertain tables stay Unknown; monitoring retries automatically.
            </p>
          )}
          <div className="mb-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4">
            {layout?.tables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                states={states}
                now={now}
                busy={busy}
                correct={correct}
                staffAction={staffAction}
                onServed={onServed}
                onAcknowledge={onAcknowledge}
              />
            ))}
          </div>
          <p className="text-[13px] text-muted-foreground">
            Counts and cleaning states are estimates. “Looks clear” does not
            verify hygiene. Plates, stains, crumbs, and unfamiliar objects may
            be missed.
          </p>
        </section>
      )}
    </div>
  );
}
