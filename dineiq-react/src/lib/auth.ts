export type User = {
  id: string;
  username: string;
  display_name: string;
  role: "ADMIN" | "STAFF";
  active: boolean;
  must_change_password: boolean;
};
export type AuthSession = { user: User; csrf_token: string };
export const API_BASE =
  import.meta.env?.VITE_API_URL ||
  (typeof window === "undefined"
    ? "http://localhost:8000"
    : `${window.location.protocol}//${window.location.hostname}:8000`);

let current: AuthSession | null = null;
let passwordRotation: Promise<AuthSession> | null = null;
let requests = new AbortController();
const listeners = new Set<(session: AuthSession | null) => void>();

export function abortAuthenticatedRequests() {
  requests.abort();
  requests = new AbortController();
}

export function setAuthSession(
  session: AuthSession | null,
  preserveRequests = false,
) {
  const sameUser =
    session &&
    current &&
    session.user.id === current.user.id &&
    session.user.role === current.user.role &&
    !session.user.must_change_password;
  if (!preserveRequests || !sameUser) abortAuthenticatedRequests();
  current = session;
  for (const listener of listeners) listener(session);
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("dineiq:setup-changed"));
}

export function subscribeAuth(listener: (session: AuthSession | null) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function sectionsFor(role: User["role"]) {
  return role === "ADMIN"
    ? ([
        "camera",
        "tables",
        "history",
        "staff",
        "activity",
        "settings",
      ] as const)
    : (["tables", "activity", "settings"] as const);
}

export async function apiFetch(
  url: string,
  options: RequestInit = {},
  retryRotation = true,
): Promise<Response> {
  const changingPassword =
    url === `${API_BASE.replace(/\/$/, "")}/auth/change-password`;
  // New operations wait for the replacement cookie and CSRF token.
  if (passwordRotation && !changingPassword)
    await passwordRotation.catch(() => {});
  const sessionAtStart = current;
  const identity = requests;
  const headers = new Headers(options.headers);
  if (
    !["GET", "HEAD", "OPTIONS"].includes(
      (options.method || "GET").toUpperCase(),
    ) &&
    current &&
    !headers.has("X-CSRF-Token")
  )
    headers.set("X-CSRF-Token", current.csrf_token);
  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include",
    signal: options.signal
      ? AbortSignal.any([options.signal, requests.signal])
      : requests.signal,
  });
  const unauthenticatedBody =
    response.status === 401 ? await response.arrayBuffer() : undefined;
  const forbiddenBody =
    response.status === 403
      ? await response
          .clone()
          .json()
          .catch(() => null)
      : null;
  // Password changes revoke the old cookie before their response reaches this browser.
  // A rejected concurrent operation can retry once after rotation; successful writes
  // are never replayed, and logout/identity changes still invalidate all requests.
  if ([401, 403].includes(response.status) && !changingPassword) {
    if (passwordRotation) await passwordRotation.catch(() => {});
    if (
      retryRotation &&
      identity === requests &&
      sessionAtStart &&
      current &&
      sessionAtStart !== current &&
      sessionAtStart.user.id === current.user.id &&
      sessionAtStart.user.role === current.user.role &&
      !options.signal?.aborted
    )
      return apiFetch(url, options, false);
  }
  if (identity !== requests || options.signal?.aborted)
    throw new DOMException(
      "Request belongs to an expired session.",
      "AbortError",
    );
  if (response.status === 401) {
    setAuthSession(null);
    return new Response(unauthenticatedBody, {
      status: response.status,
      headers: response.headers,
    });
  }
  if (response.status === 403 && current) {
    if (
      identity === requests &&
      current &&
      forbiddenBody?.detail?.code === "password_change_required"
    )
      setAuthSession({
        ...current,
        user: { ...current.user, must_change_password: true },
      });
  }
  return response;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function authRequest<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 20_000,
): Promise<T> {
  const response = await apiFetch(`${API_BASE.replace(/\/$/, "")}${path}`, {
    ...options,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body?.detail === "string"
        ? body.detail
        : body?.detail?.message ||
          (Array.isArray(body?.detail)
            ? body.detail.map((item: { msg: string }) => item.msg).join(" ")
            : "Request failed. Please retry.");
    throw new ApiError(message, response.status);
  }
  return body as T;
}

export function jsonRequest(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export async function changeAccountPassword(
  currentPassword: string,
  newPassword: string,
) {
  if (passwordRotation)
    throw new Error("A password change is already in progress.");
  passwordRotation = (async () => {
    const session = await authRequest<AuthSession>(
      "/auth/change-password",
      jsonRequest("POST", {
        current_password: currentPassword,
        new_password: newPassword,
      }),
    );
    setAuthSession(session, true);
    return session;
  })();
  try {
    return await passwordRotation;
  } finally {
    passwordRotation = null;
  }
}

export type ActivityFilters = {
  user_id?: string;
  action?: string;
  table_id?: string;
  since?: string;
  until?: string;
  before?: number;
};
export function activityQuery(filters: ActivityFilters) {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== "" && value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

export type ActivityEvent = {
  id: number;
  actor: Pick<User, "id" | "username" | "display_name">;
  target_user_id: string | null;
  action: string;
  at: string;
  camera_id: string | null;
  table_id: string | null;
  visit_id: string | null;
  alert_id: string | null;
  data: Record<string, unknown>;
};
export type ActivityPage = {
  events: ActivityEvent[];
  next_before: number | null;
};
