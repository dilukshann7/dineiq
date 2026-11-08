import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Link } from "react-router";
import type { User } from "@/lib/auth";

export function DashboardHeader({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const isAdmin = user.role === "ADMIN";
  return (
    <header className="camera-header">
      <div className="camera-container camera-masthead">
        <Link
          className="camera-brand"
          aria-label="DineIQ home"
          to={isAdmin ? "/camera" : "/tables"}
        >
          <Logo />
        </Link>
        <span className="camera-breadcrumb" aria-hidden="true">
          /
        </span>
        <span className="camera-project">Vision</span>
        <span className="camera-header-note">Restaurant dashboard</span>
        <details className="account-menu">
          <summary>
            {user.display_name} · {isAdmin ? "Admin" : "Staff"}
          </summary>
          <div>
            <span>@{user.username}</span>
            <Link
              className="account-settings-link"
              to="/settings"
              onClick={(event) =>
                event.currentTarget.closest("details")?.removeAttribute("open")
              }
            >
              Settings
            </Link>
            <Button variant="outline" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </details>
      </div>
    </header>
  );
}
