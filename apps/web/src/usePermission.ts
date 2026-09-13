import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";

export function usePermission(
  permission: string,
  appId?: string
): boolean | null {
  const [allowed, setAllowed] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let active = true;

    async function load() {
      try {
        const params = new URLSearchParams({ permission });
        if (appId) params.set("appId", appId);

        const response = await apiFetch(
          apiUrl(`/api/tenancy/authorize?${params.toString()}`)
        );
        const result = await response.json().catch(() => ({}));

        if (active) {
          setAllowed(
            response.ok && result.ok
              ? Boolean(result.allowed)
              : false
          );
        }
      } catch {
        if (active) setAllowed(false);
      }
    }

    setAllowed(null);
    void load();

    return () => {
      active = false;
    };
  }, [permission, appId]);

  return allowed;
}
