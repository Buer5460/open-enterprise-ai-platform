import type { OEAPPackageManifest } from "@oeap/package-spec";

export type RequestOptions = {
  token?: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type OEAPClientOptions = {
  baseUrl: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
};

export type OEAPApp = OEAPPackageManifest & {
  status?: string;
  localDirectory?: string;
};

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export class OEAPClient {
  readonly baseUrl: string;
  private token?: string;
  private readonly requestFetch: typeof globalThis.fetch;

  constructor(options: OEAPClientOptions) {
    this.baseUrl = stripTrailingSlash(options.baseUrl);
    this.token = options.token;
    this.requestFetch = options.fetch ?? globalThis.fetch;

    if (!this.requestFetch) {
      throw new Error("A Fetch API implementation is required");
    }
  }

  setToken(token?: string): void {
    this.token = token;
  }

  async health(): Promise<Record<string, unknown>> {
    return this.request("/health", { auth: false });
  }

  async session() {
    return this.request("/api/auth/session");
  }

  async listApps(): Promise<OEAPApp[]> {
    const result = await this.request<{ apps?: OEAPApp[] }>("/api/apps");
    return result.apps ?? [];
  }

  async generateApp(input: { description: string; nameHint?: string }) {
    return this.request("/api/apps/generate", {
      method: "POST",
      body: input
    });
  }

  async reviseApp(appId: string, instruction: string) {
    return this.request(`/api/apps/${encodeURIComponent(appId)}/revise`, {
      method: "POST",
      body: { instruction }
    });
  }

  async listEntityRows<T = Record<string, unknown>>(
    appId: string,
    entity: string,
    input: { q?: string; page?: number; pageSize?: number } = {}
  ): Promise<{
    rows: T[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.page) params.set("page", String(input.page));
    if (input.pageSize) params.set("pageSize", String(input.pageSize));
    const suffix = params.size ? `?${params.toString()}` : "";
    const result = await this.request<any>(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}${suffix}`
    );
    return {
      rows: result.rows ?? [],
      total: Number(result.total ?? 0),
      page: Number(result.page ?? 1),
      pageSize: Number(result.pageSize ?? input.pageSize ?? 10)
    };
  }

  async createEntityRow<T = Record<string, unknown>>(
    appId: string,
    entity: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const result = await this.request<any>(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}`,
      { method: "POST", body: data }
    );
    return result.row as T;
  }

  async updateEntityRow<T = Record<string, unknown>>(
    appId: string,
    entity: string,
    id: string | number,
    data: Record<string, unknown>
  ): Promise<T> {
    const result = await this.request<any>(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(String(id))}`,
      { method: "PUT", body: data }
    );
    return result.row as T;
  }

  async deleteEntityRow(
    appId: string,
    entity: string,
    id: string | number
  ): Promise<void> {
    await this.request(
      `/api/apps/${encodeURIComponent(appId)}/data/${encodeURIComponent(entity)}/${encodeURIComponent(String(id))}`,
      { method: "DELETE" }
    );
  }

  async listPackages(): Promise<OEAPPackageManifest[]> {
    const result = await this.request<any>("/api/platform/packages");
    return result.packages ?? [];
  }

  async operationsSummary(days = 30) {
    return this.request(`/api/operations/summary?days=${Math.max(1, Math.floor(days))}`);
  }

  async listApprovals(status?: ApprovalStatus) {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return this.request(`/api/operations/approvals${suffix}`);
  }

  async createApproval(input: {
    title: string;
    description?: string;
    actionType: string;
    payload?: unknown;
  }) {
    return this.request("/api/operations/approvals", {
      method: "POST",
      body: input
    });
  }

  async decideApproval(
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string
  ) {
    return this.request(
      `/api/operations/approvals/${encodeURIComponent(approvalId)}/decision`,
      { method: "POST", body: { decision, note } }
    );
  }

  async listFiles(appId?: string) {
    const suffix = appId ? `?appId=${encodeURIComponent(appId)}` : "";
    return this.request(`/api/files${suffix}`);
  }

  async uploadFile(input: {
    name: string;
    mimeType?: string;
    contentBase64: string;
    appId?: string;
  }) {
    return this.request("/api/files", { method: "POST", body: input });
  }

  async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      auth?: boolean;
      headers?: HeadersInit;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    const useAuth = options.auth !== false;

    if (useAuth && this.token) {
      headers.set("Authorization", `Bearer ${this.token}`);
    }

    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    const response = await this.requestFetch(
      `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
      {
        method: options.method ?? "GET",
        headers,
        body,
        signal: options.signal
      }
    );

    const text = await response.text();
    let result: any = undefined;

    if (text) {
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }
    }

    if (!response.ok) {
      const message =
        result && typeof result === "object" && "error" in result
          ? String(result.error)
          : `OEAP request failed with HTTP ${response.status}`;
      throw new OEAPRequestError(message, response.status, result);
    }

    return result as T;
  }
}

export class OEAPRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly response?: unknown
  ) {
    super(message);
    this.name = "OEAPRequestError";
  }
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
