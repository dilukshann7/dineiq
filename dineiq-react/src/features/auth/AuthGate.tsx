import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ChangePasswordForm } from "@/features/settings/ChangePasswordForm";
import { loginDestination } from "@/lib/routes";
import {
  ApiError,
  authRequest,
  jsonRequest,
  setAuthSession,
  subscribeAuth,
  type AuthSession,
  type User,
} from "@/lib/auth";
import "./accounts.css";

export function AuthGate({
  children,
}: {
  children: (user: User, logout: () => void) => ReactNode;
}) {
  const [session, setSession] = useState<AuthSession | null | undefined>(
    undefined,
  );
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(
    () =>
      subscribeAuth((value) => {
        setSession(value);
      }),
    [],
  );
  useEffect(() => {
    const controller = new AbortController();
    void authRequest<AuthSession>("/auth/me", { signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setAuthSession(value);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setSession(null);
        if (!(cause instanceof ApiError && cause.status === 401))
          setError("Cannot reach the backend. Check the connection and retry.");
      });
    return () => controller.abort();
  }, [retry]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const body = {
        username: data.get("username"),
        password: data.get("password"),
      };
      const result = await authRequest<AuthSession>(
        "/auth/login",
        jsonRequest("POST", body),
      );
      setAuthSession(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await authRequest("/auth/logout", jsonRequest("POST"));
      setAuthSession(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign out failed. Please retry.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  if (session === undefined || loggingOut)
    return (
      <main className="account-screen">
        <p role="status">{loggingOut ? "Signing out…" : "Checking session…"}</p>
      </main>
    );
  if (!session && location.pathname !== "/login")
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    );
  if (session && location.pathname === "/login")
    return (
      <Navigate
        to={loginDestination(session.user, location.state?.from)}
        replace
      />
    );
  if (session?.user.must_change_password) {
    if (location.pathname !== "/settings")
      return <Navigate to="/settings" replace />;
    return (
      <main className="account-screen">
        <section className="account-card">
          <Logo />
          <h1>Settings</h1>
          <h2>Change password</h2>
          <ChangePasswordForm required />
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="account-actions">
            <Button variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </section>
      </main>
    );
  }
  if (session)
    return (
      <>
        {error && (
          <p className="account-banner" role="alert">
            {error}
          </p>
        )}
        {children(session.user, () => void logout())}
      </>
    );
  return (
    <main className="account-screen">
      <section className="account-card">
        <Logo />
        <h1>Welcome back</h1>
        <p>Sign in to your restaurant dashboard.</p>
        <form onSubmit={submit} className="account-form">
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={3}
              maxLength={64}
              required
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
          </label>
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <Button disabled={busy} type="submit">
            {busy ? "Please wait…" : "Sign in"}
          </Button>
        </form>
        {error && (
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              setSession(undefined);
              setRetry((value) => value + 1);
            }}
          >
            Retry connection
          </Button>
        )}
      </section>
    </main>
  );
}
