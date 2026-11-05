import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  abortAuthenticatedRequests,
  authRequest,
  jsonRequest,
  setAuthSession,
} from "@/lib/auth";
import { refreshInstallation } from "@/lib/setup";

export function ResetSettings({
  generation,
  onStop,
  onRestart,
  onClose,
}: {
  generation?: number;
  onStop: () => void;
  onRestart: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    onStop();
    abortAuthenticatedRequests();
    try {
      await authRequest(
        "/admin/reset",
        jsonRequest("POST", {
          current_password: data.get("current_password"),
          confirmation: data.get("confirmation"),
          expected_generation: generation,
        }),
        60_000,
      );
      setAuthSession(null);
      refreshInstallation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Reset failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="mb-6 grid gap-4 rounded-lg border p-5"
      aria-labelledby="reset-title"
    >
      <h2 id="reset-title" className="text-xl font-semibold">
        Reset DineIQ
      </h2>
      <p>
        This permanently deletes all admin and staff accounts, login sessions,
        camera layouts, tables and seats, monitoring history, snapshots, visits,
        alerts, and activity. You will create a new admin and run setup again.
      </p>
      <p>
        Server configuration, Telegram credentials, model files, and backups
        remain available. Browser camera permissions stay managed by your
        browser.
      </p>
      <form className="account-form max-w-lg" onSubmit={submit}>
        <label>
          Current admin password
          <input
            name="current_password"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            required
          />
        </label>
        <label>
          Type RESET DINEIQ to confirm
          <input
            name="confirmation"
            autoComplete="off"
            spellCheck={false}
            pattern="RESET DINEIQ"
            required
          />
        </label>
        {error && (
          <p role="alert" className="account-error">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="destructive"
            disabled={busy || generation === undefined}
          >
            {busy
              ? "Resetting…"
              : error
                ? "Retry reset"
                : "Permanently reset DineIQ"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          {error && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onRestart();
                onClose();
              }}
            >
              Restart camera
            </Button>
          )}
        </div>
      </form>
      {busy && (
        <p role="status">
          Stopping monitoring and finishing active operations. Keep this page
          open.
        </p>
      )}
    </section>
  );
}
