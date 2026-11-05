import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { changeAccountPassword } from "@/lib/auth";

export function ChangePasswordForm({
  required = false,
}: {
  required?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    setSaved(false);
    if (data.get("new_password") !== data.get("confirm_password")) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changeAccountPassword(
        String(data.get("current_password")),
        String(data.get("new_password")),
      );
      form.reset();
      setSaved(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Password change failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form max-w-lg" onSubmit={submit}>
      <p>
        {required
          ? "Set your own password before continuing."
          : "Update your password. Other sessions will be signed out."}
      </p>
      <label>
        Current password
        <input
          name="current_password"
          type="password"
          autoComplete="current-password"
          maxLength={1024}
          required
          disabled={busy}
        />
      </label>
      <label>
        New password
        <input
          name="new_password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
          disabled={busy}
        />
      </label>
      <label>
        Confirm new password
        <input
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={1024}
          required
          disabled={busy}
        />
      </label>
      <small>Use 12 to 1024 characters and choose a different password.</small>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {saved && <p role="status">Password updated.</p>}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save password"}
        </Button>
      </div>
    </form>
  );
}
