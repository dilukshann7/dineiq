import { StaffEditor } from "./StaffEditor";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authRequest, jsonRequest, type User } from "@/lib/auth";

type IssuedPassword = { user: User; temporary_password: string };

export function StaffManagement({
  onHistory,
  onPendingChange,
}: {
  onHistory?: (id: string) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedPassword | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    onPendingChange?.(busy || issued !== null);
  }, [busy, issued, onPendingChange]);
  useEffect(() => {
    const controller = new AbortController();
    void authRequest<{ users: User[] }>("/admin/staff", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setUsers(result.users);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Cannot load staff.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);

  async function perform(operation: () => Promise<unknown>) {
    onPendingChange?.(true);
    setBusy(true);
    setError("");
    setIssued(null);
    try {
      await operation();
      setLoading(true);
      setReload((value) => value + 1);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Account update failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    await perform(async () => {
      setIssued(
        await authRequest<IssuedPassword>(
          "/admin/staff",
          jsonRequest("POST", {
            username: data.get("username"),
            display_name: data.get("display_name"),
          }),
        ),
      );
      form.reset();
    });
  }
  return (
    <section className="grid min-w-0 gap-6" aria-labelledby="staff-title">
      <header className="dashboard-section-header mb-0!">
        <div>
          <h2 id="staff-title">Staff</h2>
          <p>
            Manage accounts and access. Disabling an account preserves its
            history.
          </p>
        </div>
      </header>
      <Card size="sm" className="border bg-background">
        <CardHeader>
          <CardTitle>Register staff</CardTitle>
          <CardDescription>
            Create an account for a new staff member.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={create}>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="staff-username">Username</Label>
              <Input
                id="staff-username"
                name="username"
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9_.\-]+"
                autoComplete="off"
                autoCapitalize="none"
                required
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="staff-display-name">Display name</Label>
              <Input
                id="staff-display-name"
                name="display_name"
                maxLength={100}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Create staff account
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      {issued && (
        <div
          className="grid gap-3 rounded-lg border bg-muted p-4 [overflow-wrap:anywhere]"
          role="status"
        >
          <strong>Temporary password for {issued.user.username}</strong>
          <code className="select-all text-base">
            {issued.temporary_password}
          </code>
          <p>
            Share it privately. Staff must change it after signing in. This
            password is shown only now.
          </p>
          <Button
            className="justify-self-start"
            variant="outline"
            onClick={() => setIssued(null)}
          >
            Dismiss password
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <Card size="sm" className="border bg-background">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Staff accounts</CardTitle>
          <CardAction>
            <Button
              variant="outline"
              disabled={loading || busy}
              onClick={() => {
                setError("");
                setLoading(true);
                setReload((value) => value + 1);
              }}
            >
              Refresh staff
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4" aria-busy={loading}>
          {loading && (
            <p role="status" className="py-6 text-center text-muted-foreground">
              Loading staff…
            </p>
          )}
          {!loading && users.length === 0 && !error && (
            <div className="grid justify-items-center gap-2 rounded-md border border-dashed px-4 py-10 text-center">
              <p className="font-medium">No staff registered yet.</p>
              <p className="text-sm text-muted-foreground">
                Use the form above to create your first staff account.
              </p>
            </div>
          )}
          {users.length > 0 && (
            <div className="grid gap-4">
              {users.map((user) => (
                <StaffEditor
                  key={`${user.id}:${user.username}:${user.display_name}`}
                  user={user}
                  busy={busy}
                  onHistory={onHistory}
                  onSave={(id, changes) =>
                    perform(async () => {
                      await authRequest(
                        `/admin/staff/${encodeURIComponent(id)}`,
                        jsonRequest("PATCH", changes),
                      );
                    })
                  }
                  onReset={(id) =>
                    void perform(async () => {
                      setIssued(
                        await authRequest<IssuedPassword>(
                          `/admin/staff/${encodeURIComponent(id)}/reset-password`,
                          jsonRequest("POST"),
                        ),
                      );
                    })
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
