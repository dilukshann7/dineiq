import type { User } from "./auth";

export const sectionPaths = {
  camera: "/camera",
  tables: "/tables",
  history: "/history",
  staff: "/staff",
  activity: "/activity",
  settings: "/settings",
} as const;

export function dashboardRedirect(
  role: User["role"],
  onboarding: boolean,
  pathname: string,
) {
  const path = pathname.replace(/\/+$/, "").toLowerCase() || "/";
  if (onboarding)
    return ["/setup", "/settings"].includes(path)
      ? path === pathname
        ? null
        : path
      : "/setup";
  const home = role === "ADMIN" ? "/camera" : "/tables";
  if (["/", "/setup"].includes(path)) return home;
  if (role !== "ADMIN" && ["/camera", "/history", "/staff"].includes(path))
    return home;
  if (
    path !== pathname &&
    Object.values(sectionPaths).some((value) => value === path)
  )
    return path;
  return null;
}

export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32) ||
    value.split(/[?#]/)[0].replace(/\/+$/, "").toLowerCase() === "/login"
  )
    return "/";
  return value;
}

export function loginDestination(
  user: Pick<User, "role" | "must_change_password">,
  from: unknown,
): string {
  if (user.must_change_password) return "/settings";
  const destination = safeReturnPath(from);
  return destination.split(/[?#]/)[0] === "/"
    ? user.role === "ADMIN"
      ? "/camera"
      : "/tables"
    : destination;
}
