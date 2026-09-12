import React from "react";
import { apiFetch } from "./apiClient";
import "./BrandRuntime.css";

const API = "http://127.0.0.1:8787";

export type BrandSettings = {
  organizationName: string;
  shortName: string;
  logoUrl: string;
  primaryColor: string;
  loginTitle: string;
  loginSubtitle: string;
  emailSignature: string;
  invitationSubject: string;
  invitationFooter: string;
  updatedAt?: string;
};

const DEFAULT_BRAND: BrandSettings = {
  organizationName: "OpenEnterpriseAI",
  shortName: "OpenEnterpriseAI",
  logoUrl: "",
  primaryColor: "#2563EB",
  loginTitle: "OpenEnterpriseAI",
  loginSubtitle: "AI 原生企业应用平台",
  emailSignature: "OpenEnterpriseAI",
  invitationSubject: "邀请加入企业工作区",
  invitationFooter: "由 OpenEnterpriseAI 提供企业 AI 能力"
};

const BrandContext = React.createContext<{
  brand: BrandSettings;
  reload: () => Promise<void>;
}>({
  brand: DEFAULT_BRAND,
  reload: async () => undefined
});

export function BrandProvider(props: {
  children: React.ReactNode;
}) {
  const [brand, setBrand] =
    React.useState<BrandSettings>(DEFAULT_BRAND);

  const apply = React.useCallback(
    (next: Partial<BrandSettings>) => {
      setBrand((current) => {
        const merged = {
          ...current,
          ...next
        };
        applyBrandToDocument(merged);
        return merged;
      });
    },
    []
  );

  const reload = React.useCallback(async () => {
    try {
      const response = await apiFetch(
        `${API}/api/brand/settings`
      );
      const result = await response.json();

      if (response.ok && result.ok && result.settings) {
        apply(result.settings);
      }
    } catch {
      applyBrandToDocument(DEFAULT_BRAND);
    }
  }, [apply]);

  React.useEffect(() => {
    applyBrandToDocument(DEFAULT_BRAND);
    void reload();

    const onUpdated = (event: Event) => {
      const custom = event as CustomEvent<
        Partial<BrandSettings>
      >;
      if (custom.detail) {
        apply(custom.detail);
      } else {
        void reload();
      }
    };

    const onAuthChanged = () => {
      void reload();
    };

    window.addEventListener(
      "oeap-brand-updated",
      onUpdated
    );
    window.addEventListener(
      "oeap-auth-changed",
      onAuthChanged
    );

    return () => {
      window.removeEventListener(
        "oeap-brand-updated",
        onUpdated
      );
      window.removeEventListener(
        "oeap-auth-changed",
        onAuthChanged
      );
    };
  }, [apply, reload]);

  return (
    <BrandContext.Provider
      value={{ brand, reload }}
    >
      {props.children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return React.useContext(BrandContext);
}

export function BrandMark(props: {
  className?: string;
  fallback?: string;
}) {
  const { brand } = useBrand();
  const fallback =
    props.fallback ||
    brand.shortName?.trim()?.[0] ||
    brand.organizationName?.trim()?.[0] ||
    "O";

  return (
    <div className={props.className ?? "logo"}>
      {brand.logoUrl ? (
        <img
          src={brand.logoUrl}
          alt={brand.shortName || brand.organizationName}
        />
      ) : (
        fallback.toUpperCase()
      )}
    </div>
  );
}

function applyBrandToDocument(
  brand: BrandSettings
): void {
  if (typeof document === "undefined") {
    return;
  }

  const primary = normalizeColor(
    brand.primaryColor
  ) || "#2563EB";

  const root = document.documentElement;
  root.style.setProperty(
    "--oeap-primary",
    primary
  );
  root.style.setProperty(
    "--oeap-primary-soft",
    mixWithWhite(primary, 0.9)
  );
  root.style.setProperty(
    "--oeap-primary-soft-2",
    mixWithWhite(primary, 0.82)
  );
  root.style.setProperty(
    "--oeap-primary-dark",
    mixWithBlack(primary, 0.28)
  );

  document.title = `${
    brand.shortName || brand.organizationName || "OEAP"
  } · OEAP`;
}

function normalizeColor(
  value?: string
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized)
    ? normalized.toUpperCase()
    : undefined;
}

function mixWithWhite(
  color: string,
  ratio: number
): string {
  return mix(color, "#FFFFFF", ratio);
}

function mixWithBlack(
  color: string,
  ratio: number
): string {
  return mix(color, "#000000", ratio);
}

function mix(
  left: string,
  right: string,
  rightRatio: number
): string {
  const a = parseHex(left);
  const b = parseHex(right);
  const r = Math.max(0, Math.min(1, rightRatio));

  const values = [0, 1, 2].map((index) =>
    Math.round(a[index] * (1 - r) + b[index] * r)
  );

  return `#${values
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function parseHex(value: string): [number, number, number] {
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16)
  ];
}
