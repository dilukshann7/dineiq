import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { authRequest, jsonRequest, setAuthSession, type AuthSession } from "@/lib/auth";
import type { SetupStatus } from "@/lib/setup-state";

export function BootstrapSetup({ status, onRefresh }: {
  status: SetupStatus;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unlocked = Boolean(status.csrf_token);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setError("");
    if (unlocked && data.get("password") !== data.get("confirm_password")) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      if (unlocked) {
        const result = await authRequest<AuthSession>("/setup/admin", {
          ...jsonRequest("POST", {
            username: data.get("username"), display_name: data.get("display_name"),
            password: data.get("password"),
          }),
          headers: { "Content-Type": "application/json", "X-CSRF-Token": status.csrf_token! },
        });
        setAuthSession(result);
      } else {
        await authRequest("/setup/access", jsonRequest("POST", { code: data.get("code") }));
      }
      form.reset();
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Setup failed. Please retry.");
      onRefresh();
    } finally { setBusy(false); }
  }
  return <main className="account-screen"><section className="account-card">
    <span className="account-brand">DineIQ</span>
    <h1>{unlocked ? "Create your admin account" : "Set up DineIQ"}</h1>
    <p>{unlocked
      ? "This account manages your camera, tables, and staff."
      : "Enter the setup code from your server administrator. Codes expire after 30 minutes."}</p>
    <form key={unlocked ? "admin" : "code"} className="account-form" onSubmit={submit}>
      {unlocked ? <>
        <label>Display name<input name="display_name" autoComplete="name" maxLength={100} required /></label>
        <label>Username<input name="username" autoComplete="username" autoCapitalize="none"
          spellCheck={false} minLength={3} maxLength={64} pattern="[A-Za-z0-9_.\-]+" required /></label>
        <label>Password<input name="password" type="password" autoComplete="new-password"
          minLength={12} maxLength={1024} required /></label>
        <label>Confirm password<input name="confirm_password" type="password" autoComplete="new-password"
          minLength={12} maxLength={1024} required /></label>
        <small>Use at least 12 characters.</small>
      </> : <label>Setup code<input name="code" autoComplete="off" autoCapitalize="none"
        spellCheck={false} maxLength={128} required /></label>}
      {error && <p role="alert" className="account-error">{error}</p>}
      <Button disabled={busy} type="submit">{busy ? "Please wait…" : unlocked ? "Create admin" : "Continue"}</Button>
    </form>
  </section></main>;
}
