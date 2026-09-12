const AUTH_TOKEN_KEY = "oeap.auth.token";

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
  return fetch(input, {
    ...init,
    headers: authHeaders(init.headers)
  });
}
