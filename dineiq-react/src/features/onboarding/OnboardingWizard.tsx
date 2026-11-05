import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SetupTables } from "@/features/table-setup/SetupTables";
import { StaffManagement } from "@/features/staff/StaffManagement";
import type { useDashboardWorkspace } from "@/features/dashboard/useDashboardWorkspace";
import { authRequest, jsonRequest } from "@/lib/auth";
import {
  onboardingStep,
  type SetupCheckpoint,
  type SetupStatus,
} from "@/lib/setup-state";

export function OnboardingWizard({
  workspace,
  status,
  onRefresh,
  active = true,
}: {
  active?: boolean;
  workspace: ReturnType<typeof useDashboardWorkspace>;
  status: SetupStatus;
  onRefresh: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [staffPending, setStaffPending] = useState(false);
  const { monitor, camera, detector, toggleMonitoring } = workspace;
  const step = onboardingStep(status, camera.live, staffPending);
  const layoutReady = Boolean(monitor.layout?.tables.length && !monitor.layout.recalibration_required);
  useEffect(() => {
    if (!camera.live || monitor.layoutLoading || monitor.setup) return;
    const checkpoint = status.checkpoint;
    const next = checkpoint === "camera" ? "tables"
      : checkpoint === "tables" && layoutReady ? "staff" : null;
    if (!next) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function advance() {
      try {
        await authRequest("/setup/progress", {
          ...jsonRequest("POST", { checkpoint: next }), signal: controller.signal,
        });
        if (!controller.signal.aborted) { setError(""); onRefresh(); }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not advance setup.");
          timer = setTimeout(() => void advance(), 2000);
        }
      }
    }
    void advance();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [camera.live, monitor.layoutLoading, monitor.setup, layoutReady, status.checkpoint, onRefresh]);
  async function perform(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function progress(checkpoint: SetupCheckpoint) {
    await authRequest("/setup/progress", jsonRequest("POST", { checkpoint }));
  }
  return (
    <section
      hidden={!active}
      className="camera-panel grid gap-5"
      aria-labelledby="onboarding-title"
    >
      <header className="dashboard-section-header">
        <div>
          <h2 id="onboarding-title">Finish setting up DineIQ</h2>
          <p>Camera · Tables and seats · Staff · Monitoring check</p>
        </div>
      </header>
      <p role="status">
        Current step:{" "}
        {step === "review"
          ? "Monitoring check"
          : step === "tables"
            ? "Tables and seats"
            : step === "staff"
              ? "Staff (optional)"
              : "Camera"}
      </p>
      {step === "camera" && (
        <>
          <p>
            Start your camera above. Keep it fixed, show the seating area, and
            leave stationary background visible.
          </p>
          <Button
            disabled={!camera.live || busy}
            onClick={() =>
              void perform(async () => {
                if (status.checkpoint === "camera") await progress("tables");
              })
            }
          >
            Continue to tables
          </Button>
        </>
      )}
      {step === "tables" && (
        <>
          {monitor.setup ? (
            <SetupTables
              client={monitor.client}
              frame={monitor.setup.frame}
              layout={monitor.setup.layout}
              onCancel={() => monitor.setSetup(null)}
              onSave={async (tables) => {
                await monitor.saveSetup(tables);
                await progress("staff");
                onRefresh();
              }}
            />
          ) : (
            <>
              <p>
                Tables and seats are detected and saved automatically. Keep the
                camera fixed with the tables, chairs, and stationary background visible.
              </p>
              <Button
                disabled={busy || monitor.layoutLoading}
                onClick={monitor.configureTables}
              >
                Edit tables manually
              </Button>
              {monitor.layout && !monitor.layout.recalibration_required && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void perform(() => progress("staff"))}
                >
                  Use saved table setup
                </Button>
              )}
            </>
          )}
        </>
      )}
      {step === "staff" && (
        <>
          <StaffManagement onPendingChange={setStaffPending} />
          {staffPending && (
            <p role="status">
              Finish the staff account update and dismiss its temporary password
              before continuing.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy || staffPending}
              onClick={() => void perform(() => progress("review"))}
            >
              Continue to monitoring check
            </Button>
            <Button
              variant="outline"
              disabled={busy || staffPending}
              onClick={() => void perform(() => progress("review"))}
            >
              Skip staff for now
            </Button>
          </div>
        </>
      )}
      {step === "review" && (
        <>
          <p>
            {monitor.layout?.tables.length ?? 0} detected tables. Monitoring starts
            automatically and checks camera alignment before opening your dashboard.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy} onClick={toggleMonitoring}>
              {monitor.monitoring ? "Stop check" : "Start monitoring check"}
            </Button>
            <Button
              disabled={
                busy ||
                !monitor.monitoring ||
                !detector.monitoringFrame ||
                !monitor.layout
              }
              onClick={() =>
                void perform(async () => {
                  await authRequest(
                    "/setup/complete",
                    jsonRequest("POST", {
                      session_id: detector.monitoringFrame!.session_id,
                      expected_revision: monitor.layout!.revision,
                    }),
                  );
                })
              }
            >
              {busy ? "Checking…" : "Finish setup and open dashboard"}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (monitor.monitoring) toggleMonitoring();
                  await progress("tables");
                })
              }
            >
              Review tables again
            </Button>
          </div>
          {detector.monitoringFrame && (
            <p role="status">
              Camera check received. Finish setup to continue.
            </p>
          )}
        </>
      )}
      {(error || monitor.monitorError || detector.detectionError) && (
        <p className="account-error" role="alert">
          {error || monitor.monitorError || detector.detectionError}
        </p>
      )}
    </section>
  );
}
