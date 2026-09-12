import React from "react";
import { apiFetch } from "./apiClient";
import "./MailSettingsPanel.css";

const API = "http://127.0.0.1:8787";

type MailProvider =
  | "manual"
  | "resend"
  | "webhook"
  | "smtp";

type MailSettings = {
  provider: MailProvider;
  from?: string;
  webhookUrl?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpStartTls?: boolean;
  smtpRejectUnauthorized?: boolean;
  smtpUser?: string;
  smtpFrom?: string;
  smtpHelo?: string;
  hasResendApiKey: boolean;
  hasWebhookToken: boolean;
  hasSmtpPassword: boolean;
  updatedAt?: string;
};

type MailStatus = {
  activeProvider: MailProvider;
  providers: Array<{
    id: MailProvider;
    name: string;
    configured: boolean;
    active: boolean;
    description: string;
  }>;
};

export function MailSettingsPanel() {
  const [settings, setSettings] =
    React.useState<MailSettings | null>(null);
  const [status, setStatus] =
    React.useState<MailStatus | null>(null);
  const [forbidden, setForbidden] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");
  const [saving, setSaving] =
    React.useState(false);
  const [testing, setTesting] =
    React.useState(false);

  const [provider, setProvider] =
    React.useState<MailProvider>("manual");
  const [from, setFrom] = React.useState("");
  const [resendApiKey, setResendApiKey] =
    React.useState("");
  const [webhookUrl, setWebhookUrl] =
    React.useState("");
  const [webhookToken, setWebhookToken] =
    React.useState("");
  const [smtpHost, setSmtpHost] =
    React.useState("");
  const [smtpPort, setSmtpPort] =
    React.useState("587");
  const [smtpSecure, setSmtpSecure] =
    React.useState(false);
  const [smtpStartTls, setSmtpStartTls] =
    React.useState(true);
  const [smtpRejectUnauthorized, setSmtpRejectUnauthorized] =
    React.useState(true);
  const [smtpUser, setSmtpUser] =
    React.useState("");
  const [smtpPassword, setSmtpPassword] =
    React.useState("");
  const [smtpFrom, setSmtpFrom] =
    React.useState("");
  const [smtpHelo, setSmtpHelo] =
    React.useState("oeap.local");
  const [testEmail, setTestEmail] =
    React.useState("");

  const applySettings = React.useCallback(
    (next: MailSettings) => {
      setSettings(next);
      setProvider(next.provider);
      setFrom(next.from ?? "");
      setWebhookUrl(next.webhookUrl ?? "");
      setSmtpHost(next.smtpHost ?? "");
      setSmtpPort(String(next.smtpPort ?? 587));
      setSmtpSecure(Boolean(next.smtpSecure));
      setSmtpStartTls(next.smtpStartTls !== false);
      setSmtpRejectUnauthorized(
        next.smtpRejectUnauthorized !== false
      );
      setSmtpUser(next.smtpUser ?? "");
      setSmtpFrom(next.smtpFrom ?? "");
      setSmtpHelo(next.smtpHelo ?? "oeap.local");
      setResendApiKey("");
      setWebhookToken("");
      setSmtpPassword("");
    },
    []
  );

  const load = React.useCallback(async () => {
    const response = await apiFetch(
      `${API}/api/mail/settings`
    );

    if (response.status === 403) {
      setForbidden(true);
      return;
    }

    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error ?? "邮件配置加载失败"
      );
    }

    setForbidden(false);
    applySettings(result.settings);
    setStatus(result.status);
  }, [applySettings]);

  React.useEffect(() => {
    void load().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "邮件配置加载失败"
      );
    });
  }, [load]);

  async function save() {
    setSaving(true);
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/mail/settings`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            provider,
            from: from.trim() || undefined,
            resendApiKey:
              resendApiKey.trim() || undefined,
            webhookUrl:
              webhookUrl.trim() || undefined,
            webhookToken:
              webhookToken.trim() || undefined,
            smtpHost:
              smtpHost.trim() || undefined,
            smtpPort:
              Number(smtpPort) || 587,
            smtpSecure,
            smtpStartTls,
            smtpRejectUnauthorized,
            smtpUser:
              smtpUser.trim() || undefined,
            smtpPassword:
              smtpPassword || undefined,
            smtpFrom:
              smtpFrom.trim() || undefined,
            smtpHelo:
              smtpHelo.trim() || undefined
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "保存邮件配置失败"
        );
      }

      applySettings(result.settings);
      setStatus(result.status);
      setMessage("邮件配置已加密保存。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "保存邮件配置失败"
      );
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (!testEmail.trim()) {
      setMessage("请输入测试收件邮箱。");
      return;
    }

    setTesting(true);
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/mail/settings/test`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            to: testEmail.trim()
          })
        }
      );

      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.result?.error ??
          result.error ??
          "测试邮件发送失败"
        );
      }

      setStatus(result.status);
      setMessage(
        result.result?.status === "manual"
          ? "当前为手动链接模式，不会发送邮件。"
          : `测试邮件已通过 ${result.result?.provider ?? provider} 发送。`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "测试邮件发送失败"
      );
    } finally {
      setTesting(false);
    }
  }

  if (forbidden) {
    return (
      <article className="mailSettingsPanel">
        <div className="mailSettingsHeader">
          <div>
            <span>MAIL DELIVERY</span>
            <h3>企业邮件服务</h3>
            <p>
              当前账号可以使用企业邀请与登录能力，但邮件服务配置仅允许 Owner / Admin 管理。
            </p>
          </div>
          <div className="mailActiveState">
            <small>权限</small>
            <strong>仅管理员可配置</strong>
          </div>
        </div>
        <div className="mailManualNotice">
          <strong>无需处理</strong>
          <p>
            如果需要修改 SMTP、Resend 或企业邮件 Webhook，请联系企业 Owner / Admin。
          </p>
        </div>
      </article>
    );
  }

  return (
    <article className="mailSettingsPanel">
      <div className="mailSettingsHeader">
        <div>
          <span>MAIL DELIVERY</span>
          <h3>企业邮件服务</h3>
          <p>
            每个企业独立配置邮件发送通道。密钥只在本机运行数据目录加密保存，页面不会回显已保存密码。
          </p>
        </div>

        <div className="mailActiveState">
          <small>当前通道</small>
          <strong>
            {providerLabel(
              status?.activeProvider ??
              settings?.provider ??
              "manual"
            )}
          </strong>
        </div>
      </div>

      <div className="mailProviderTabs">
        {(
          [
            "manual",
            "resend",
            "webhook",
            "smtp"
          ] as MailProvider[]
        ).map((item) => (
          <button
            key={item}
            className={
              provider === item
                ? "active"
                : ""
            }
            onClick={() => setProvider(item)}
          >
            <strong>{providerLabel(item)}</strong>
            <span>
              {providerDescription(item)}
            </span>
          </button>
        ))}
      </div>

      <div className="mailSettingsBody">
        {provider === "manual" && (
          <div className="mailManualNotice">
            <strong>手动邀请链接模式</strong>
            <p>
              不连接任何外部邮件服务。管理员创建邀请后复制链接，通过微信、邮件或企业 IM 自行发送。
            </p>
          </div>
        )}

        {provider === "resend" && (
          <div className="mailFieldGrid">
            <Field
              label="发件人"
              value={from}
              onChange={setFrom}
              placeholder="OEAP <noreply@example.com>"
            />
            <SecretField
              label="Resend API Key"
              value={resendApiKey}
              onChange={setResendApiKey}
              configured={
                Boolean(settings?.hasResendApiKey)
              }
              placeholder="re_..."
            />
          </div>
        )}

        {provider === "webhook" && (
          <div className="mailFieldGrid">
            <Field
              label="Webhook URL"
              value={webhookUrl}
              onChange={setWebhookUrl}
              placeholder="https://mail-gateway.example.com/send"
            />
            <SecretField
              label="Webhook Token（可选）"
              value={webhookToken}
              onChange={setWebhookToken}
              configured={
                Boolean(settings?.hasWebhookToken)
              }
              placeholder="Bearer token"
            />
            <Field
              label="发件人显示"
              value={from}
              onChange={setFrom}
              placeholder="OEAP"
            />
          </div>
        )}

        {provider === "smtp" && (
          <>
            <div className="mailFieldGrid three">
              <Field
                label="SMTP Host"
                value={smtpHost}
                onChange={setSmtpHost}
                placeholder="smtp.example.com"
              />
              <Field
                label="端口"
                value={smtpPort}
                onChange={setSmtpPort}
                placeholder="587"
              />
              <Field
                label="HELO"
                value={smtpHelo}
                onChange={setSmtpHelo}
                placeholder="oeap.local"
              />
              <Field
                label="SMTP 用户名"
                value={smtpUser}
                onChange={setSmtpUser}
                placeholder="user@example.com"
              />
              <SecretField
                label="SMTP 密码"
                value={smtpPassword}
                onChange={setSmtpPassword}
                configured={
                  Boolean(settings?.hasSmtpPassword)
                }
                placeholder="留空则保持原密码"
              />
              <Field
                label="发件人"
                value={smtpFrom}
                onChange={setSmtpFrom}
                placeholder="OEAP <noreply@example.com>"
              />
            </div>

            <div className="mailSwitches">
              <Check
                label="SSL/TLS（通常 465）"
                checked={smtpSecure}
                onChange={setSmtpSecure}
              />
              <Check
                label="STARTTLS（通常 587）"
                checked={smtpStartTls}
                onChange={setSmtpStartTls}
              />
              <Check
                label="校验证书"
                checked={smtpRejectUnauthorized}
                onChange={setSmtpRejectUnauthorized}
              />
            </div>
          </>
        )}

        <div className="mailSettingsActions">
          <button
            className="mailSaveButton"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving
              ? "保存中…"
              : "保存邮件配置"}
          </button>

          <div className="mailTestBox">
            <input
              type="email"
              value={testEmail}
              onChange={(event) =>
                setTestEmail(event.target.value)
              }
              placeholder="测试收件邮箱"
            />
            <button
              disabled={testing}
              onClick={() => void sendTest()}
            >
              {testing
                ? "测试中…"
                : "发送测试邮件"}
            </button>
          </div>
        </div>
      </div>

      {message && (
        <div className="mailSettingsMessage">
          {message}
        </div>
      )}
    </article>
  );
}

function Field(props: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mailField">
      <span>{props.label}</span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) =>
          props.onChange(event.target.value)
        }
      />
    </label>
  );
}

function SecretField(props: {
  label: string;
  value: string;
  placeholder?: string;
  configured: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="mailField">
      <span>
        {props.label}
        {props.configured && (
          <em>已保存</em>
        )}
      </span>
      <input
        type="password"
        value={props.value}
        placeholder={
          props.configured
            ? "••••••••（留空保持原值）"
            : props.placeholder
        }
        onChange={(event) =>
          props.onChange(event.target.value)
        }
      />
    </label>
  );
}

function Check(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) =>
          props.onChange(event.target.checked)
        }
      />
      {props.label}
    </label>
  );
}

function providerLabel(
  provider: MailProvider
): string {
  if (provider === "resend") return "Resend";
  if (provider === "webhook") return "企业 Webhook";
  if (provider === "smtp") return "SMTP";
  return "手动链接";
}

function providerDescription(
  provider: MailProvider
): string {
  if (provider === "resend") {
    return "API 邮件发送";
  }
  if (provider === "webhook") {
    return "对接企业邮件网关";
  }
  if (provider === "smtp") {
    return "企业邮箱 / 自建邮箱";
  }
  return "无需外部服务";
}
