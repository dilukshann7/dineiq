import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { readSetupStatus } from "@/lib/setup";
import type { SetupStatus } from "@/lib/setup-state";
import { BootstrapSetup } from "./BootstrapSetup";
import { setAuthSession } from "@/lib/auth";

export function InstallationGate({
  children,
}: {
  children: (status: SetupStatus, refresh: () => void) => ReactNode;
}) {
  const location = useLocation();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (status?.phase === "needs_admin") setAuthSession(null);
  }, [status?.phase]);
  useEffect(() => {
    window.addEventListener("dineiq:setup-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("dineiq:setup-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const next = await readSetupStatus(controller.signal);
        if (!controller.signal.aborted) {
          setStatus(next);
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Cannot check setup status.",
          );
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 5000);
      }
    }
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [revision]);
  if (!status)
    return (
      <main className="account-screen">
        <section className="account-card">
          <h1>DineIQ</h1>
          <p role={error ? "alert" : "status"}>
            {error || "Checking installation…"}
          </p>
          {error && <Button onClick={refresh}>Retry connection</Button>}
        </section>
      </main>
    );
  return (
    <>
      {error && (
        <p className="account-banner" role="alert">
          {error}
        </p>
      )}
      {status.phase === "needs_admin" ? (
        location.pathname === "/setup" ? (
          <BootstrapSetup status={status} onRefresh={refresh} />
        ) : (
          <Navigate to="/setup" replace />
        )
      ) : (
        children(status, refresh)
      )}
    </>
  );
}
