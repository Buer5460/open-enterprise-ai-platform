import { createConnection as createNetConnection } from "node:net";
import { connect as connectTls } from "node:tls";
import type { Socket } from "node:net";
import type { TLSSocket } from "node:tls";

export type MailProviderId =
  | "manual"
  | "resend"
  | "webhook"
  | "smtp";

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
            process.env.RESEND_API_KEY &&
            process.env.OEAP_MAIL_FROM
          ),
          active: activeProvider === "resend",
          description:
            "HTTPS email delivery through Resend."
        },
        {
          id: "webhook",
          name: "Enterprise Mail Webhook",
          configured: Boolean(
            process.env.OEAP_MAIL_WEBHOOK_URL
          ),
          active: activeProvider === "webhook",
          description:
            "POST invitation messages to an enterprise mail gateway or automation webhook."
        },
        {
          id: "smtp",
          name: "SMTP",
          configured: Boolean(
            process.env.OEAP_SMTP_HOST &&
            process.env.OEAP_SMTP_FROM
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
    const preferred =
      process.env.OEAP_MAIL_PROVIDER
        ?.trim()
        .toLowerCase();

    if (
      preferred === "resend" &&
      process.env.RESEND_API_KEY &&
      process.env.OEAP_MAIL_FROM
    ) {
      return "resend";
    }

    if (
      preferred === "webhook" &&
      process.env.OEAP_MAIL_WEBHOOK_URL
    ) {
      return "webhook";
    }

    if (
      preferred === "smtp" &&
      process.env.OEAP_SMTP_HOST &&
      process.env.OEAP_SMTP_FROM
    ) {
      return "smtp";
    }

    if (
      process.env.RESEND_API_KEY &&
      process.env.OEAP_MAIL_FROM
    ) {
      return "resend";
    }

    if (process.env.OEAP_MAIL_WEBHOOK_URL) {
      return "webhook";
    }

    if (
      process.env.OEAP_SMTP_HOST &&
      process.env.OEAP_SMTP_FROM
    ) {
      return "smtp";
    }

    return "manual";
  }

  private async sendResend(
    message: MailMessage
  ): Promise<MailDeliveryResult> {
    const apiKey = process.env.RESEND_API_KEY!;
    const from = process.env.OEAP_MAIL_FROM!;

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
    const url =
      process.env.OEAP_MAIL_WEBHOOK_URL!;
    const token =
      process.env.OEAP_MAIL_WEBHOOK_TOKEN;

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
          process.env.OEAP_MAIL_FROM ||
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
    const host = process.env.OEAP_SMTP_HOST!;
    const port = Number(
      process.env.OEAP_SMTP_PORT || 587
    );
    const secure =
      process.env.OEAP_SMTP_SECURE === "true" ||
      port === 465;
    const useStartTls =
      !secure &&
      process.env.OEAP_SMTP_STARTTLS !== "false";
    const rejectUnauthorized =
      process.env.OEAP_SMTP_REJECT_UNAUTHORIZED !==
      "false";
    const username = process.env.OEAP_SMTP_USER;
    const password = process.env.OEAP_SMTP_PASS;
    const from = process.env.OEAP_SMTP_FROM!;

    let socket: SocketLike = secure
      ? await openTlsSocket(
          host,
          port,
          rejectUnauthorized
        )
      : await openNetSocket(host, port);

    await expectReply(socket, [220]);
    await sendCommand(
      socket,
      `EHLO ${process.env.OEAP_SMTP_HELO || "oeap.local"}`,
      [250]
    );

    if (useStartTls) {
      await sendCommand(
        socket,
        "STARTTLS",
        [220]
      );

      socket = await upgradeTls(
        socket as Socket,
        host,
        rejectUnauthorized
      );

      await sendCommand(
        socket,
        `EHLO ${process.env.OEAP_SMTP_HELO || "oeap.local"}`,
        [250]
      );
    }

    if (username && password) {
      await sendCommand(socket, "AUTH LOGIN", [334]);
      await sendCommand(
        socket,
        Buffer.from(username).toString("base64"),
        [334]
      );
      await sendCommand(
        socket,
        Buffer.from(password).toString("base64"),
        [235]
      );
    }

    await sendCommand(
      socket,
      `MAIL FROM:<${extractAddress(from)}>`,
      [250]
    );
    await sendCommand(
      socket,
      `RCPT TO:<${extractAddress(message.to)}>`,
      [250, 251]
    );
    await sendCommand(socket, "DATA", [354]);

    socket.write(
      formatMimeMessage(
        from,
        message
      ) + "\r\n.\r\n"
    );

    await expectReply(socket, [250]);

    try {
      await sendCommand(socket, "QUIT", [221]);
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
  expectedCodes: number[]
): Promise<string> {
  socket.write(command + "\r\n");
  return expectReply(socket, expectedCodes);
}

function expectReply(
  socket: SocketLike,
  expectedCodes: number[]
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
    }, Number(process.env.OEAP_SMTP_TIMEOUT_MS || 15000));

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
