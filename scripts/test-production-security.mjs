import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const api = spawn(
  process.execPath,
  ["apps/api/dist/index.js"],
  {
    env: {
      ...process.env,
      OEAP_DEPLOYMENT_MODE: "production",
      NODE_ENV: "production",
      OEAP_LOCAL_AUTH: "disabled",
      OEAP_CORS_ORIGINS: "http://127.0.0.1:5173"
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);

let stdout = "";
let stderr = "";
api.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
api.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  await waitForHealth();

  const spoofed = await fetch(
    "http://127.0.0.1:8787/api/tenancy/context",
    {
      headers: {
        "x-oeap-org": "org_local",
        "x-oeap-member": "member_local_owner"
      }
    }
  );

  assert(
    spoofed.status === 401,
    `spoofed protected request must be rejected with 401, got ${spoofed.status}`
  );

  const localLogin = await fetch(
    "http://127.0.0.1:8787/api/auth/local",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        organizationId: "org_local",
        memberId: "member_local_owner"
      })
    }
  );

  assert(
    localLogin.status === 403,
    `production local login must be disabled, got ${localLogin.status}`
  );

  const publicInvitation = await fetch(
    "http://127.0.0.1:8787/api/invitations/public/not-a-real-token"
  );

  assert(
    publicInvitation.status === 404,
    `public invitation route must remain reachable without a session, got ${publicInvitation.status}`
  );

  const providers = await fetch(
    "http://127.0.0.1:8787/api/auth/providers"
  );
  const providerBody = await providers.json();

  assert(providers.status === 200, "provider discovery must be public");
  assert(
    providerBody.deploymentMode === "production",
    "provider discovery must report production mode"
  );
  assert(
    providerBody.localDevelopmentMode === false,
    "local development mode must be false in production"
  );

  console.log("✅ PRODUCTION SECURITY TEST PASSED");
} finally {
  api.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => api.once("exit", resolve)),
    sleep(1500)
  ]);
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (api.exitCode !== null) {
      throw new Error(
        `API exited before health check.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
      );
    }

    try {
      const response = await fetch(
        "http://127.0.0.1:8787/health"
      );
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }

    await sleep(100);
  }

  throw new Error(
    `API did not become healthy.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
