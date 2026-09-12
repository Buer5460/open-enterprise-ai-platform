const AUTH_TOKEN_KEY = "oeap.auth.token";

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
