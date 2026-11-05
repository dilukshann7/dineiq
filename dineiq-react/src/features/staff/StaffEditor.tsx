import { useId, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { User } from "@/lib/auth";

export function StaffEditor({
  user,
  busy,
  onSave,
  onReset,
  onHistory,
}: {
  user: User;
  busy: boolean;
  onSave: (id: string, changes: Partial<User>) => Promise<void>;
  onReset: (id: string) => void;
  onHistory?: (id: string) => void;
}) {
  const fieldId = useId();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave(user.id, {
      username: String(data.get("username")),
      display_name: String(data.get("display_name")),
    });
  }
  return (
    <Card size="sm" className="border bg-background">
      <CardHeader className="gap-2">
        <CardTitle className="break-words">{user.display_name}</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-muted px-2.5 py-1">
            {user.active ? "Active" : "Disabled"}
          </span>
          {user.must_change_password && <span>Password change required</span>}
        </div>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${fieldId}-username`}>Username</Label>
              <Input
                id={`${fieldId}-username`}
                name="username"
                defaultValue={user.username}
                minLength={3}
                maxLength={64}
                pattern="[A-Za-z0-9_.\-]+"
                autoCapitalize="none"
                required
              />
            </div>
            <div className="grid min-w-0 gap-2">
              <Label htmlFor={`${fieldId}-display-name`}>Display name</Label>
              <Input
                id={`${fieldId}-display-name`}
                name="display_name"
                defaultValue={user.display_name}
                maxLength={100}
                required
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="outline" disabled={busy}>
              Save profile
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void onSave(user.id, { active: !user.active })}
            >
              {user.active ? "Disable access" : "Re-enable access"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onReset(user.id)}
            >
              Reset password
            </Button>
            {onHistory && <Button
              type="button"
              variant="ghost"
              onClick={() => onHistory(user.id)}
            >
              View history
            </Button>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
