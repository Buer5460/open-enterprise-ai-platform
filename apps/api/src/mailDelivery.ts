import { createConnection as createNetConnection } from "node:net";
import { connect as connectTls } from "node:tls";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

export type MailProviderId =
  | "manual"
  | "resend"
  | "webhook"
  | "smtp";

export interface MailRuntimeConfig {
  provider: MailProviderId;
  from?: string;
  resendApiKey?: string;
  webhookUrl?: string;
  webhookToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  smtpRejectUnauthorized?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  smtpHelo?: string;
  smtpTimeoutMs?: number;
}

export interface MailProviderStatus {
  id: MailProviderId;
  name: string;
  configured: boolean;
  active: boolean;
  description: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailDeliveryResult {
  ok: boolean;
  provider: MailProviderId;
  status: "sent" | "manual" | "failed";
  messageId?: string;
  error?: string;
}

type SocketLike = Socket | TLSSocket;

export class MailDeliveryService {
  private readonly config: MailRuntimeConfig;

  constructor(config?: MailRuntimeConfig) {
    this.config = config ?? environmentConfig();
  }

  status(): {
    activeProvider: MailProviderId;
    providers: MailProviderStatus[];
  } {
    const activeProvider = this.resolveProvider();

    return {
      activeProvider,
      providers: [
        {
          id: "manual",
          name: "Manual Link",
          configured: true,
          active: activeProvider === "manual",
          description:
            "No outbound mail. Administrators copy the invitation link manually."
        },
        {
          id: "resend",
          name: "Resend",
          configured: Boolean(
            this.config.resendApiKey &&
            this.config.from
          ),
          active: activeProvider === "resend",
          description:
            "HTTPS email delivery through Resend."
        },
        {
          id: "webhook",
          name: "Enterprise Mail Webhook",
          configured: Boolean(
            this.config.webhookUrl
          ),
          active: activeProvider === "webhook",
          description:
            "POST invitation messages to an enterprise mail gateway or automation webhook."
        },
        {
          id: "smtp",
          name: "SMTP",
          configured: Boolean(
            this.config.smtpHost &&
            this.config.smtpFrom
          ),
          active: activeProvider === "smtp",
          description:
            "Direct SMTP delivery with optional STARTTLS or implicit TLS."
        }
      ]
    };
  }

  async send(
    message: MailMessage
  ): Promise<MailDeliveryResult> {
    const provider = this.resolveProvider();

    try {
      if (provider === "manual") {
        return {
          ok: true,
          provider,
          status: "manual"
        };
      }

      if (provider === "resend") {
        return await this.sendResend(message);
      }

      if (provider === "webhook") {
        return await this.sendWebhook(message);
      }

      return await this.sendSmtp(message);
    } catch (error) {
      return {
        ok: false,
        provider,
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Mail delivery failed"
      };
    }
  }

  private resolveProvider(): MailProviderId {
    const preferred = this.config.provider;

    if (
      preferred === "resend" &&
      this.config.resendApiKey &&
      this.config.from
    ) {
      return "resend";
    }

    if (
      preferred === "webhook" &&
      this.config.webhookUrl
    ) {
      return "webhook";
    }

    if (
      preferred === "smtp" &&
      this.config.smtpHost &&
      this.config.smtpFrom
    ) {
      return "smtp";
    }

    if (preferred === "manual") {
      return "manual";
    }

    if (
      this.config.resendApiKey &&
      this.config.from
    ) {
      return "resend";
    }

    if (this.config.webhookUrl) {
      return "webhook";
    }

    if (
      this.config.smtpHost &&
      this.config.smtpFrom
    ) {
      return "smtp";
    }

    return "manual";
  }

  private async sendResend(
    message: MailMessage
  ): Promise<MailDeliveryResult> {
    const apiKey = this.config.resendApiKey!;
    const from = this.config.from!;

    const response = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html
        })
      }
    );

    const body = await response
      .json()
      .catch(() => ({})) as any;

    if (!response.ok) {
      throw new Error(
        body?.message ||
        `Resend returned HTTP ${response.status}`
      );
    }

    return {
      ok: true,
      provider: "resend",
      status: "sent",
      messageId: body?.id
    };
  }

  private async sendWebhook(
    message: MailMessage
  ): Promise<MailDeliveryResult> {
    const url = this.config.webhookUrl!;
    const token = this.config.webhookToken;

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "oeap.email",
        to: message.to,
        from:
          this.config.from ||
          "OEAP",
        subject: message.subject,
        text: message.text,
        html: message.html
      })
    });

    if (!response.ok) {
      throw new Error(
        `Mail webhook returned HTTP ${response.status}`
      );
    }

    return {
      ok: true,
      provider: "webhook",
      status: "sent",
      messageId:
        response.headers.get("x-message-id") ||
        undefined
    };
  }

  private async sendSmtp(
    message: MailMessage
  ): Promise<MailDeliveryResult> {
    const host = this.config.smtpHost!;
    const port = Number(
      this.config.smtpPort ?? 587
    );
    const secure =
      this.config.smtpSecure === true ||
      port === 465;
    const useStartTls =
      !secure &&
      this.config.smtpStartTls !== false;
    const rejectUnauthorized =
      this.config.smtpRejectUnauthorized !== false;
    const username = this.config.smtpUser;
    const password = this.config.smtpPassword;
    const from = this.config.smtpFrom!;

    let socket: SocketLike = secure
      ? await openTlsSocket(
          host,
          port,
          rejectUnauthorized
        )
      : await openNetSocket(host, port);

    await expectReply(
      socket,
      [220],
      this.timeoutMs()
    );
    await sendCommand(
      socket,
      `EHLO ${this.config.smtpHelo || "oeap.local"}`,
      [250],
      this.timeoutMs()
    );

    if (useStartTls) {
      await sendCommand(
        socket,
        "STARTTLS",
        [220],
        this.timeoutMs()
      );

      socket = await upgradeTls(
        socket as Socket,
        host,
        rejectUnauthorized
      );

      await sendCommand(
        socket,
        `EHLO ${this.config.smtpHelo || "oeap.local"}`,
        [250],
        this.timeoutMs()
      );
    }

    if (username && password) {
      await sendCommand(
        socket,
        "AUTH LOGIN",
        [334],
        this.timeoutMs()
      );
      await sendCommand(
        socket,
        Buffer.from(username).toString("base64"),
        [334],
        this.timeoutMs()
      );
      await sendCommand(
        socket,
        Buffer.from(password).toString("base64"),
        [235],
        this.timeoutMs()
      );
    }

    await sendCommand(
      socket,
      `MAIL FROM:<${extractAddress(from)}>`,
      [250],
      this.timeoutMs()
    );
    await sendCommand(
      socket,
      `RCPT TO:<${extractAddress(message.to)}>`,
      [250, 251],
      this.timeoutMs()
    );
    await sendCommand(
      socket,
      "DATA",
      [354],
      this.timeoutMs()
    );

    socket.write(
      formatMimeMessage(
        from,
        message
      ) + "\r\n.\r\n"
    );

    await expectReply(
      socket,
      [250],
      this.timeoutMs()
    );

    try {
      await sendCommand(
        socket,
        "QUIT",
        [221],
        this.timeoutMs()
      );
    } catch {
      // Message was already accepted; a QUIT failure should not flip delivery status.
    }

    socket.end();

    return {
      ok: true,
      provider: "smtp",
      status: "sent"
    };
  }

  private timeoutMs(): number {
    return Number(
      this.config.smtpTimeoutMs ?? 15000
    );
  }
}

export function environmentConfig(): MailRuntimeConfig {
  const provider = normalizeProvider(
    process.env.OEAP_MAIL_PROVIDER
  );

  return {
    provider,
    from: process.env.OEAP_MAIL_FROM,
    resendApiKey: process.env.RESEND_API_KEY,
    webhookUrl:
      process.env.OEAP_MAIL_WEBHOOK_URL,
    webhookToken:
      process.env.OEAP_MAIL_WEBHOOK_TOKEN,
    smtpHost: process.env.OEAP_SMTP_HOST,
    smtpPort: Number(
      process.env.OEAP_SMTP_PORT || 587
    ),
    smtpSecure:
      process.env.OEAP_SMTP_SECURE === "true",
    smtpStartTls:
      process.env.OEAP_SMTP_STARTTLS !== "false",
    smtpRejectUnauthorized:
      process.env.OEAP_SMTP_REJECT_UNAUTHORIZED !==
      "false",
    smtpUser: process.env.OEAP_SMTP_USER,
    smtpPassword: process.env.OEAP_SMTP_PASS,
    smtpFrom: process.env.OEAP_SMTP_FROM,
    smtpHelo: process.env.OEAP_SMTP_HELO,
    smtpTimeoutMs: Number(
      process.env.OEAP_SMTP_TIMEOUT_MS || 15000
    )
  };
}

function normalizeProvider(
  value: string | undefined
): MailProviderId {
  const normalized = value
    ?.trim()
    .toLowerCase();

  if (
    normalized === "resend" ||
    normalized === "webhook" ||
    normalized === "smtp"
  ) {
    return normalized;
  }

  return "manual";
}

function openNetSocket(
  host: string,
  port: number
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createNetConnection({
      host,
      port
    });

    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function openTlsSocket(
  host: string,
  port: number,
  rejectUnauthorized: boolean
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const socket = connectTls({
      host,
      port,
      servername: host,
      rejectUnauthorized
    });

    socket.once(
      "secureConnect",
      () => resolve(socket)
    );
    socket.once("error", reject);
  });
}

function upgradeTls(
  socket: Socket,
  host: string,
  rejectUnauthorized: boolean
): Promise<TLSSocket> {
  return new Promise((resolve, reject) => {
    const secureSocket = connectTls({
      socket,
      servername: host,
      rejectUnauthorized
    });

    secureSocket.once(
      "secureConnect",
      () => resolve(secureSocket)
    );
    secureSocket.once("error", reject);
  });
}

async function sendCommand(
  socket: SocketLike,
  command: string,
  expectedCodes: number[],
  timeoutMs: number
): Promise<string> {
  socket.write(command + "\r\n");
  return expectReply(
    socket,
    expectedCodes,
    timeoutMs
  );
}

function expectReply(
  socket: SocketLike,
  expectedCodes: number[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    const finish = (
      error?: Error,
      value?: string
    ) => {
      cleanup();
      if (error) reject(error);
      else resolve(value || buffer);
    };

    const onError = (error: Error) => finish(error);
    const onClose = () =>
      finish(
        new Error(
          "SMTP connection closed unexpectedly"
        )
      );

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer
        .split(/\r?\n/)
        .filter(Boolean);
      const last = lines[lines.length - 1];

      if (!last || !/^\d{3} /.test(last)) {
        return;
      }

      const code = Number(last.slice(0, 3));
      if (!expectedCodes.includes(code)) {
        finish(
          new Error(
            `SMTP returned ${code}: ${buffer.trim()}`
          )
        );
        return;
      }

      finish(undefined, buffer);
    };

    const timer = setTimeout(() => {
      finish(new Error("SMTP response timeout"));
    }, timeoutMs);

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function extractAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function formatMimeMessage(
  from: string,
  message: MailMessage
): string {
  const boundary =
    `oeap-${Date.now().toString(36)}`;
  const safeSubject = encodeHeader(message.subject);
  const text = dotEscape(normalizeLines(message.text));
  const html = dotEscape(normalizeLines(message.html));

  return [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`
  ].join("\r\n");
}

function normalizeLines(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r\n");
}

function dotEscape(value: string): string {
  return value
    .split("\r\n")
    .map((line) =>
      line.startsWith(".")
        ? `.${line}`
        : line
    )
    .join("\r\n");
}

function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }

  return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}
