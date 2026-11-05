import {
  History,
  Table2,
  Video,
  Users,
  ListChecks,
  Settings,
} from "lucide-react";
import { NavLink } from "react-router";
import { sectionsFor, type User } from "@/lib/auth";
import { sectionPaths } from "@/lib/routes";

const icons = {
  camera: Video,
  tables: Table2,
  history: History,
  staff: Users,
  activity: ListChecks,
  settings: Settings,
};

export function DashboardNavigation({ role }: { role: User["role"] }) {
  const isAdmin = role === "ADMIN";
  return (
    <nav aria-label="Dashboard sections" className="camera-sidebar">
      {sectionsFor(role).map((section) => {
        const Icon = icons[section];
        const name =
          section === "activity"
            ? isAdmin
              ? "Activity"
              : "My activity"
            : section[0].toUpperCase() + section.slice(1);
        return (
          <NavLink
            key={section}
            to={sectionPaths[section]}
            className="camera-nav-item"
            title={name}
          >
            <Icon aria-hidden="true" />
            <span>{name}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
