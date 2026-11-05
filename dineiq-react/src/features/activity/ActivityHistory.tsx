import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  activityQuery,
  authRequest,
  type ActivityPage,
  type User,
} from "@/lib/auth";

const actions = [
  "login",
  "logout",
  "password_changed",
  "manual_correction",
  "service_confirmed",
  "alert_acknowledged",
  "layout_saved",
  "session_started",
  "session_stopped",
  "staff_created",
  "staff_updated",
  "staff_disabled",
  "staff_enabled",
  "staff_password_reset",
  "admin_password_recovered",
  "telegram_settings_updated",
];
const label = (value: string) => value.replaceAll("_", " ");

function ActivityFilter({
  title,
  value,
  items,
  onChange,
}: {
  title: string;
  value: string;
  items: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={id}>{title}</Label>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => onChange(next ?? "")}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ActivityHistory({
  admin,
  initialUser = "",
  tables,
}: {
  admin: boolean;
  initialUser?: string;
  tables: { id: string; name: string }[];
}) {
  const [users, setUsers] = useState<User[]>([]);
  const [user, setUser] = useState(initialUser);
  const [action, setAction] = useState("");
  const [table, setTable] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState<ActivityPage>({
    events: [],
    next_before: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [cursor, setCursor] = useState<number | undefined>();
  useEffect(() => {
    if (!admin) return;
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
            cause instanceof Error
              ? cause.message
              : "Cannot load staff filter.",
          );
      });
    return () => controller.abort();
  }, [admin]);
  useEffect(() => {
    const controller = new AbortController();
    const filters = {
      user_id: admin ? user : undefined,
      action,
      table_id: table,
      since: since ? new Date(since).toISOString() : "",
      until: until ? new Date(until).toISOString() : "",
      before: cursor,
    };
    void authRequest<ActivityPage>(`/activity?${activityQuery(filters)}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted)
          setPage((previous) =>
            cursor
              ? { ...result, events: [...previous.events, ...result.events] }
              : result,
          );
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Cannot load activity.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [admin, user, action, table, since, until, cursor, refresh]);
  function change(update: () => void) {
    setLoading(true);
    setError("");
    update();
    setCursor(undefined);
    setPage({ events: [], next_before: null });
  }
  return (
    <section className="grid min-w-0 gap-6" aria-labelledby="activity-title">
      <header className="dashboard-section-header mb-0!">
        <div>
          <h2 id="activity-title">{admin ? "Activity" : "My activity"}</h2>
          <p>
            {admin
              ? "Staff actions, account updates, and sign-in history."
              : "Your table actions and account activity."}
          </p>
        </div>
      </header>
      <Card size="sm" className="border bg-background">
        <CardContent className="grid gap-4">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-4">
            {admin && (
              <ActivityFilter
                title="Staff"
                value={user}
                onChange={(value) => change(() => setUser(value))}
                items={[
                  { value: "", label: "All accounts" },
                  ...users.map((item) => ({
                    value: item.id,
                    label: `${item.display_name} (@${item.username})${item.active ? "" : " · Disabled"}`,
                  })),
                ]}
              />
            )}
            <ActivityFilter
              title="Action"
              value={action}
              onChange={(value) => change(() => setAction(value))}
              items={[
                { value: "", label: "All actions" },
                ...actions.map((item) => ({ value: item, label: label(item) })),
              ]}
            />
            <ActivityFilter
              title="Table"
              value={table}
              onChange={(value) => change(() => setTable(value))}
              items={[
                { value: "", label: "All tables" },
                ...tables.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="activity-since">From</Label>
              <Input
                id="activity-since"
                type="datetime-local"
                value={since}
                onChange={(event) => change(() => setSince(event.target.value))}
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor="activity-until">Until</Label>
              <Input
                id="activity-until"
                type="datetime-local"
                value={until}
                onChange={(event) => change(() => setUntil(event.target.value))}
              />
            </div>
          </div>
          <div className="flex justify-start border-t pt-4">
            <Button
              variant="outline"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                setError("");
                setCursor(undefined);
                setRefresh((value) => value + 1);
              }}
            >
              Refresh activity
            </Button>
          </div>
        </CardContent>
      </Card>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      {page.events.length > 0 && (
        <ol className="divide-y rounded-lg border" aria-busy={loading}>
          {page.events.map((event) => (
            <li
              key={event.id}
              className="grid gap-1.5 px-4 py-4 text-sm [overflow-wrap:anywhere] sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6"
            >
              <time
                className="text-xs text-muted-foreground sm:col-start-2 sm:row-span-2 sm:text-right"
                dateTime={event.at}
              >
                {new Date(event.at).toLocaleString()}
              </time>
              <strong className="font-medium sm:col-start-1 sm:row-start-1">
                {label(event.action)}
                {event.action === "manual_correction" &&
                typeof event.data.action === "string"
                  ? ` · ${label(event.data.action)}`
                  : ""}
              </strong>
              <span className="text-muted-foreground sm:col-start-1">
                {event.actor.display_name} (@{event.actor.username})
                {event.table_id
                  ? ` · ${tables.find((item) => item.id === event.table_id)?.name || event.table_id}`
                  : ""}
              </span>
              {event.target_user_id && (
                <small className="text-muted-foreground sm:col-start-1">
                  Affected account:{" "}
                  {users.find((item) => item.id === event.target_user_id)
                    ?.display_name || event.target_user_id}
                </small>
              )}
            </li>
          ))}
        </ol>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading activity…
        </p>
      )}
      {!loading && !error && page.events.length === 0 && (
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No activity for these filters.
        </p>
      )}
      {page.next_before && (
        <Button
          className="justify-self-start"
          variant="outline"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            setError("");
            setCursor(page.next_before!);
          }}
        >
          Load older activity
        </Button>
      )}
    </section>
  );
}
