import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = findChrome();
if (!chrome) {
  if (process.env.OEAP_REQUIRE_BROWSER_E2E === "1") {
    throw new Error("Chrome/Chromium is required for browser E2E");
  }
  console.log("⏭ BROWSER E2E SKIPPED: Chrome/Chromium not found");
  process.exit(0);
}

const apiPort = 8787;
const webPort = 5173;
const debugPort = 19222 + Math.floor(Math.random() * 1000);
const dataDir = await mkdtemp(join(tmpdir(), "oeap-browser-data-"));
const browserProfile = await mkdtemp(join(tmpdir(), "oeap-browser-profile-"));
const processes = [];
let logs = "";
let client;

try {
  const api = trackedSpawn(
    process.execPath,
    ["apps/api/dist/index.js"],
    {
      ...process.env,
      OEAP_API_HOST: "127.0.0.1",
      OEAP_API_PORT: String(apiPort),
      OEAP_DEPLOYMENT_MODE: "development",
      OEAP_LOCAL_AUTH: "enabled",
      OEAP_DATA_DIR: dataDir
    }
  );
  processes.push(api);

  const web = trackedSpawn(
    "corepack",
    [
      "pnpm",
      "--filter",
      "@oeap/web",
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort"
    ],
    process.env
  );
  processes.push(web);

  await waitForHttp(`http://127.0.0.1:${apiPort}/health`);
  await waitForHttp(`http://127.0.0.1:${webPort}/`);

  const browser = trackedSpawn(
    chrome,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      "about:blank"
    ],
    process.env
  );
  processes.push(browser);

  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`);

  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(
      `http://127.0.0.1:${webPort}/`
    )}`,
    { method: "PUT" }
  );
  assert.equal(targetResponse.ok, true, "Chrome target creation failed");
  const target = await targetResponse.json();
  assert.equal(
    typeof target.webSocketDebuggerUrl,
    "string",
    "Chrome did not provide a DevTools WebSocket"
  );

  client = await createCdpClient(target.webSocketDebuggerUrl);
  const browserErrors = [];
  client.onEvent((message) => {
    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(
        message.params?.exceptionDetails?.text ||
        "Uncaught browser exception"
      );
    }
  });

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false
  });

  await waitForText(client, "AI 工作台");
  await waitForText(client, "开始使用 OEAP");
  await waitForText(client, "客户经营 CRM");

  let text = await bodyText(client);
  assert.match(text, /企业与权限/);
  assert.match(text, /Marketplace/);
  assert.match(text, /企业知识库/);
  assert.match(text, /运营与审批/);
  assert.match(text, /Developer/);
  assert.match(text, /AI 未连接/);
  assert.doesNotMatch(
    text,
    /Online\s*DeepSeek Harness/,
    "Workbench must not fake an online AI runtime"
  );

  await clickButton(client, "一键创建");
  await waitForText(client, "打开应用");
  text = await bodyText(client);
  assert.match(text, /客户经营 CRM/);
  assert.match(text, /1\s*已安装应用/);

  await clickButton(client, "打开应用");
  await waitForText(client, "应用概览");
  await clickButton(client, "客户管理");
  await waitForText(client, "新增数据");
  text = await bodyText(client);
  assert.match(text, /Customer/);
  assert.match(text, /客户名称/);
  assert.match(text, /客户状态/);

  await clickButton(client, "返回工作台");
  await waitForText(client, "AI 工作台");

  await clickButton(client, "企业与权限");
  await waitForText(client, "成员与应用权限");
  text = await bodyText(client);
  assert.match(text, /企业与权限/);
  assert.match(text, /Local OEAP Organization/);
  assert.match(text, /添加成员/);
  assert.match(text, /角色与权限/);

  await clickButton(client, "企业知识库");
  await waitForText(client, "企业知识库");

  assert.deepEqual(
    browserErrors,
    [],
    `Browser emitted runtime exceptions: ${browserErrors.join(" | ")}`
  );

  console.log("✅ REAL BROWSER + DAY-ONE TEMPLATE E2E TEST PASSED");
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  client?.close();
  for (const child of processes.reverse()) {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of processes) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await Promise.all([
    rm(dataDir, { recursive: true, force: true }),
    rm(browserProfile, { recursive: true, force: true })
  ]);
}

function trackedSpawn(command, args, env) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => {
    logs += `[${command}] ${chunk.toString()}`;
  });
  child.stderr.on("data", (chunk) => {
    logs += `[${command}] ${chunk.toString()}`;
  });
  return child;
}

function findChrome() {
  if (
    process.env.CHROME_PATH &&
    existsSync(process.env.CHROME_PATH)
  ) {
    return process.env.CHROME_PATH;
  }

  const commands = [
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser"
  ];
  for (const command of commands) {
    const result = spawnSync("which", [command], {
      encoding: "utf8"
    });
    const value = result.stdout?.trim();
    if (result.status === 0 && value) return value;
  }

  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(mac) ? mac : undefined;
}

async function waitForHttp(url) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function createCdpClient(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let sequence = 0;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Chrome DevTools WebSocket failed to open")),
      { once: true }
    );
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || "CDP command failed"));
      } else {
        resolve(message.result);
      }
      return;
    }
    for (const listener of listeners) listener(message);
  });

  return {
    send(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    onEvent(listener) {
      listeners.add(listener);
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text || "Browser evaluation failed"
    );
  }
  return result.result?.value;
}

async function bodyText(client) {
  return String(
    await evaluate(
      client,
      "document.body ? document.body.innerText : ''"
    ) || ""
  );
}

async function waitForText(client, expected) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const text = await bodyText(client);
    if (text.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Browser did not render expected text: ${expected}`);
}

async function clickButton(client, label) {
  const expression = `(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => (item.textContent || '').includes(${JSON.stringify(label)}));
    if (!button) return false;
    button.click();
    return true;
  })()`;
  const clicked = await evaluate(client, expression);
  assert.equal(clicked, true, `Button not found: ${label}`);
}
