import {
  createHash,
  randomBytes
} from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AuthProviderId
} from "./authStore.js";

export type ExternalAuthProvider = Exclude<
  AuthProviderId,
  "local"
>;

export interface ExternalIdentity {
  provider: ExternalAuthProvider;
  subject: string;
  email: string;
  name: string;
}

type ProviderConfig = {
  provider: ExternalAuthProvider;
  clientId: string;
  clientSecret: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  scope: string;
  usePkce: boolean;
};

type StoredFlow = {
  state: string;
  provider: ExternalAuthProvider;
  verifier: string;
  redirectUri: string;
  createdAt: string;
  expiresAt: string;
};

class OAuthFlowStore {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), {
      recursive: true
    });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_flows (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        verifier TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    this.cleanup();
  }

  create(input: {
    provider: ExternalAuthProvider;
    redirectUri: string;
  }): StoredFlow {
    this.cleanup();

    const state = randomBase64Url(32);
    const verifier = randomBase64Url(48);
    const createdAt = new Date();
    const expiresAt = new Date(
      createdAt.getTime() + 10 * 60 * 1000
    );

    this.db.prepare(`
      INSERT INTO oauth_flows
        (state, provider, verifier, redirect_uri, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      state,
      input.provider,
      verifier,
      input.redirectUri,
      createdAt.toISOString(),
      expiresAt.toISOString()
    );

    return {
      state,
      provider: input.provider,
      verifier,
      redirectUri: input.redirectUri,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
  }

  consume(
    state: string,
    provider: ExternalAuthProvider
  ): StoredFlow {
    const row = this.db.prepare(`
      SELECT state, provider, verifier, redirect_uri, created_at, expires_at
      FROM oauth_flows
      WHERE state = ?
    `).get(state) as any;

    this.db
      .prepare("DELETE FROM oauth_flows WHERE state = ?")
      .run(state);

    if (!row) {
      throw new Error("OAuth state is invalid or already used");
    }

    if (row.provider !== provider) {
      throw new Error("OAuth provider does not match state");
    }

    if (
      new Date(row.expires_at).getTime() <=
      Date.now()
    ) {
      throw new Error("OAuth state has expired");
    }

    return {
      state: row.state,
      provider: row.provider,
      verifier: row.verifier,
      redirectUri: row.redirect_uri,
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  private cleanup(): void {
    this.db
      .prepare("DELETE FROM oauth_flows WHERE expires_at <= ?")
      .run(new Date().toISOString());
  }
}

export async function createAuthorizationRequest(input: {
  provider: ExternalAuthProvider;
  repoRoot: string;
  apiBase: string;
}): Promise<{
  authorizationUrl: string;
  redirectUri: string;
  expiresAt: string;
}> {
  const config = await resolveProviderConfig(
    input.provider
  );
  const redirectUri =
    `${stripTrailingSlash(input.apiBase)}/api/auth/${input.provider}/callback`;
  const store = createStore(input.repoRoot);
  const flow = store.create({
    provider: input.provider,
    redirectUri
  });

  const url = new URL(
    config.authorizationEndpoint
  );
  url.searchParams.set(
    "client_id",
    config.clientId
  );
  url.searchParams.set(
    "redirect_uri",
    redirectUri
  );
  url.searchParams.set(
    "response_type",
    "code"
  );
  url.searchParams.set(
    "scope",
    config.scope
  );
  url.searchParams.set(
    "state",
    flow.state
  );

  if (config.usePkce) {
    url.searchParams.set(
      "code_challenge",
      codeChallenge(flow.verifier)
    );
    url.searchParams.set(
      "code_challenge_method",
      "S256"
    );
  }

  if (
    input.provider === "google" ||
    input.provider === "microsoft"
  ) {
    url.searchParams.set(
      "prompt",
      "select_account"
    );
  }

  return {
    authorizationUrl: url.toString(),
    redirectUri,
    expiresAt: flow.expiresAt
  };
}

export async function completeAuthorization(input: {
  provider: ExternalAuthProvider;
  repoRoot: string;
  state: string;
  code: string;
}): Promise<ExternalIdentity> {
  const store = createStore(input.repoRoot);
  const flow = store.consume(
    input.state,
    input.provider
  );
  const config = await resolveProviderConfig(
    input.provider
  );

  const accessToken = await exchangeCode({
    config,
    code: input.code,
    redirectUri: flow.redirectUri,
    verifier: flow.verifier
  });

  if (input.provider === "github") {
    return fetchGitHubIdentity(accessToken);
  }

  return fetchOidcIdentity(
    input.provider,
    config.userinfoEndpoint,
    accessToken
  );
}

export function providerIsConfigured(
  provider: ExternalAuthProvider
): boolean {
  if (provider === "github") {
    return Boolean(
      process.env.OEAP_GITHUB_CLIENT_ID &&
      process.env.OEAP_GITHUB_CLIENT_SECRET
    );
  }

  if (provider === "google") {
    return Boolean(
      process.env.OEAP_GOOGLE_CLIENT_ID &&
      process.env.OEAP_GOOGLE_CLIENT_SECRET
    );
  }

  if (provider === "microsoft") {
    return Boolean(
      process.env.OEAP_MICROSOFT_CLIENT_ID &&
      process.env.OEAP_MICROSOFT_CLIENT_SECRET
    );
  }

  return Boolean(
    process.env.OEAP_OIDC_ISSUER &&
    process.env.OEAP_OIDC_CLIENT_ID &&
    process.env.OEAP_OIDC_CLIENT_SECRET
  );
}

async function resolveProviderConfig(
  provider: ExternalAuthProvider
): Promise<ProviderConfig> {
  if (provider === "github") {
    return {
      provider,
      clientId: requireEnv(
        "OEAP_GITHUB_CLIENT_ID"
      ),
      clientSecret: requireEnv(
        "OEAP_GITHUB_CLIENT_SECRET"
      ),
      authorizationEndpoint:
        "https://github.com/login/oauth/authorize",
      tokenEndpoint:
        "https://github.com/login/oauth/access_token",
      userinfoEndpoint:
        "https://api.github.com/user",
      scope: "read:user user:email",
      usePkce: false
    };
  }

  if (provider === "google") {
    return {
      provider,
      clientId: requireEnv(
        "OEAP_GOOGLE_CLIENT_ID"
      ),
      clientSecret: requireEnv(
        "OEAP_GOOGLE_CLIENT_SECRET"
      ),
      authorizationEndpoint:
        "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint:
        "https://oauth2.googleapis.com/token",
      userinfoEndpoint:
        "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
      usePkce: true
    };
  }

  if (provider === "microsoft") {
    const tenant = encodeURIComponent(
      process.env.OEAP_MICROSOFT_TENANT_ID ||
      "common"
    );

    return {
      provider,
      clientId: requireEnv(
        "OEAP_MICROSOFT_CLIENT_ID"
      ),
      clientSecret: requireEnv(
        "OEAP_MICROSOFT_CLIENT_SECRET"
      ),
      authorizationEndpoint:
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenEndpoint:
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      userinfoEndpoint:
        "https://graph.microsoft.com/oidc/userinfo",
      scope: "openid email profile User.Read",
      usePkce: true
    };
  }

  const issuer = stripTrailingSlash(
    requireEnv("OEAP_OIDC_ISSUER")
  );
  assertProviderUrl(issuer);

  const discoveryResponse = await fetch(
    `${issuer}/.well-known/openid-configuration`
  );

  if (!discoveryResponse.ok) {
    throw new Error(
      `OIDC discovery returned HTTP ${discoveryResponse.status}`
    );
  }

  const discovery = await discoveryResponse.json() as any;
  const authorizationEndpoint = String(
    discovery.authorization_endpoint || ""
  );
  const tokenEndpoint = String(
    discovery.token_endpoint || ""
  );
  const userinfoEndpoint = String(
    discovery.userinfo_endpoint || ""
  );

  assertProviderUrl(authorizationEndpoint);
  assertProviderUrl(tokenEndpoint);
  assertProviderUrl(userinfoEndpoint);

  return {
    provider,
    clientId: requireEnv(
      "OEAP_OIDC_CLIENT_ID"
    ),
    clientSecret: requireEnv(
      "OEAP_OIDC_CLIENT_SECRET"
    ),
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint,
    scope:
      process.env.OEAP_OIDC_SCOPE ||
      "openid email profile",
    usePkce: true
  };
}

async function exchangeCode(input: {
  config: ProviderConfig;
  code: string;
  redirectUri: string;
  verifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret
  });

  if (input.config.usePkce) {
    body.set(
      "code_verifier",
      input.verifier
    );
  }

  const response = await fetch(
    input.config.tokenEndpoint,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type":
          "application/x-www-form-urlencoded"
      },
      body
    }
  );

  const result = await response
    .json()
    .catch(() => ({})) as any;

  if (!response.ok || !result.access_token) {
    throw new Error(
      result.error_description ||
      result.error ||
      `OAuth token exchange returned HTTP ${response.status}`
    );
  }

  return String(result.access_token);
}

async function fetchGitHubIdentity(
  accessToken: string
): Promise<ExternalIdentity> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "OpenEnterpriseAI"
  };

  const profileResponse = await fetch(
    "https://api.github.com/user",
    { headers }
  );
  const profile = await profileResponse
    .json()
    .catch(() => ({})) as any;

  if (!profileResponse.ok || !profile.id) {
    throw new Error(
      `GitHub user lookup returned HTTP ${profileResponse.status}`
    );
  }

  let email =
    typeof profile.email === "string"
      ? profile.email
      : "";

  if (!email) {
    const emailsResponse = await fetch(
      "https://api.github.com/user/emails",
      { headers }
    );
    const emails = await emailsResponse
      .json()
      .catch(() => []) as any[];

    if (emailsResponse.ok) {
      const selected =
        emails.find(
          (item) => item.primary && item.verified
        ) ??
        emails.find((item) => item.verified);
      email = String(selected?.email || "");
    }
  }

  if (!email) {
    throw new Error(
      "GitHub account does not expose a verified email address"
    );
  }

  return {
    provider: "github",
    subject: String(profile.id),
    email: normalizeEmail(email),
    name:
      String(profile.name || profile.login || email)
  };
}

async function fetchOidcIdentity(
  provider: Exclude<ExternalAuthProvider, "github">,
  userinfoEndpoint: string,
  accessToken: string
): Promise<ExternalIdentity> {
  const response = await fetch(
    userinfoEndpoint,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json"
      }
    }
  );
  const profile = await response
    .json()
    .catch(() => ({})) as any;

  if (!response.ok) {
    throw new Error(
      `OIDC userinfo returned HTTP ${response.status}`
    );
  }

  const email = String(
    profile.email ||
    profile.preferred_username ||
    ""
  ).trim();
  const subject = String(
    profile.sub || profile.id || ""
  ).trim();

  if (!email || !subject) {
    throw new Error(
      "OIDC profile is missing email or subject"
    );
  }

  if (
    profile.email_verified === false &&
    provider !== "microsoft"
  ) {
    throw new Error(
      "OIDC provider returned an unverified email"
    );
  }

  return {
    provider,
    subject,
    email: normalizeEmail(email),
    name: String(
      profile.name ||
      profile.given_name ||
      email
    )
  };
}

function createStore(
  repoRoot: string
): OAuthFlowStore {
  return new OAuthFlowStore(
    join(
      repoRoot,
      ".tmp",
      "auth",
      "oauth-flows.sqlite"
    )
  );
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function assertProviderUrl(value: string): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("OIDC provider URL is invalid");
  }

  const localhost =
    url.hostname === "127.0.0.1" ||
    url.hostname === "localhost";

  if (url.protocol !== "https:" && !localhost) {
    throw new Error(
      "OIDC provider endpoints must use HTTPS"
    );
  }
}
