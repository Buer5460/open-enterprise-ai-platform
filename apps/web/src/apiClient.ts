const AUTH_TOKEN_KEY = "oeap.auth.token";
const LOCAL_API_BASE = "http://127.0.0.1:8787";

export const API_BASE = resolveApiBase();

const nativeFetch =
  globalThis.fetch.bind(globalThis);

function importRedirectSession(): void {
  try {
    const hash = window.location.hash;

    if (!hash.startsWith("#oeap_session=")) {
      return;
    }

    const token = decodeURIComponent(
      hash.slice("#oeap_session=".length)
    ).trim();

    if (token) {
      window.localStorage.setItem(
        AUTH_TOKEN_KEY,
        token
      );
    }

    window.history.replaceState(
      null,
      document.title,
      `${window.location.pathname}${window.location.search}`
    );
  } catch {
    // Ignore unavailable browser storage/history APIs.
  }
}

if (typeof window !== "undefined") {
  importRedirectSession();
  installOeapFetch();
}

export function getAuthToken(): string | undefined {
  try {
    return window.localStorage.getItem(
      AUTH_TOKEN_KEY
    ) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setAuthToken(
  token: string | undefined
): void {
  try {
    if (token) {
      window.localStorage.setItem(
        AUTH_TOKEN_KEY,
        token
      );
    } else {
      window.localStorage.removeItem(
        AUTH_TOKEN_KEY
      );
    }
  } catch {
    // Local storage can be unavailable in restricted browsers.
  }

  try {
    window.dispatchEvent(
      new CustomEvent("oeap-auth-changed")
    );
  } catch {
    // Ignore unavailable browser event APIs.
  }
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return normalizeAbsoluteUrl(path);
  }

  return `${API_BASE}${
    path.startsWith("/") ? path : `/${path}`
  }`;
}

export function authHeaders(
  headers?: HeadersInit
): Headers {
  const result = new Headers(headers);
  const token = getAuthToken();

  if (token) {
    result.set(
      "Authorization",
      `Bearer ${token}`
    );
  }

  return result;
}

export function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const normalized = normalizeInput(input);

  return nativeFetch(normalized, {
    ...init,
    headers: authHeaders(init.headers)
  });
}

function installOeapFetch(): void {
  const marker = "__oeap_fetch_installed__";
  const target = window as typeof window & {
    [marker]?: boolean;
  };

  if (target[marker]) {
    return;
  }

  target[marker] = true;

  window.fetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {}
  ) => {
    const normalized = normalizeInput(input);

    if (!isOeapApiRequest(normalized)) {
      return nativeFetch(normalized, init);
    }

    return nativeFetch(normalized, {
      ...init,
      headers: authHeaders(init.headers)
    });
  }) as typeof window.fetch;
}

function isOeapApiRequest(
  input: RequestInfo | URL
): boolean {
  const value =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  if (
    value.startsWith("/api/") ||
    value === "/health" ||
    value.startsWith("/invite/")
  ) {
    return true;
  }

  return (
    value === API_BASE ||
    value.startsWith(`${API_BASE}/`)
  );
}

function normalizeInput(
  input: RequestInfo | URL
): RequestInfo | URL {
  if (typeof input === "string") {
    return normalizeAbsoluteUrl(input);
  }

  if (input instanceof URL) {
    return new URL(
      normalizeAbsoluteUrl(input.toString())
    );
  }

  const normalizedUrl = normalizeAbsoluteUrl(
    input.url
  );

  if (normalizedUrl === input.url) {
    return input;
  }

  return new Request(normalizedUrl, input);
}

function normalizeAbsoluteUrl(
  value: string
): string {
  if (
    value === LOCAL_API_BASE ||
    value.startsWith(`${LOCAL_API_BASE}/`)
  ) {
    return `${API_BASE}${value.slice(
      LOCAL_API_BASE.length
    )}`;
  }

  return value;
}

function resolveApiBase(): string {
  const viteEnv = (
    import.meta as unknown as {
      env?: Record<string, string | undefined>;
    }
  ).env;
  const configured =
    viteEnv?.VITE_OEAP_API_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (typeof window !== "undefined") {
    const local =
      window.location.hostname === "127.0.0.1" ||
      window.location.hostname === "localhost";

    if (!local) {
      return window.location.origin.replace(
        /\/+$/,
        ""
      );
    }
  }

  return LOCAL_API_BASE;
}
