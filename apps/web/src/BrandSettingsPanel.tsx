import React from "react";
import { apiFetch } from "./apiClient";
import "./BrandSettingsPanel.css";

const API = "http://127.0.0.1:8787";

type BrandSettings = {
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

export function BrandSettingsPanel() {
  const [settings, setSettings] =
    React.useState<BrandSettings | null>(null);
  const [canManage, setCanManage] =
    React.useState(false);
  const [saving, setSaving] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");

  const load = React.useCallback(async () => {
    const response = await apiFetch(
      `${API}/api/brand/settings`
    );
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(
        result.error ?? "企业品牌配置加载失败"
      );
    }

    setSettings(result.settings);
    setCanManage(Boolean(result.canManage));
  }, []);

  React.useEffect(() => {
    void load().catch((error) => {
      setMessage(
        error instanceof Error
          ? error.message
          : "企业品牌配置加载失败"
      );
    });
  }, [load]);

  function setField<K extends keyof BrandSettings>(
    key: K,
    value: BrandSettings[K]
  ) {
    setSettings((current) =>
      current
        ? { ...current, [key]: value }
        : current
    );
  }

  async function save() {
    if (!settings || !canManage) return;

    setSaving(true);
    setMessage("");

    try {
      const response = await apiFetch(
        `${API}/api/brand/settings`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(settings)
        }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "保存企业品牌失败"
        );
      }

      await load();
      setMessage("企业品牌配置已保存。");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "保存企业品牌失败"
      );
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <article className="brandSettingsPanel">
        <div className="brandSettingsHeader">
          <div>
            <span>ENTERPRISE BRANDING</span>
            <h3>企业品牌</h3>
          </div>
        </div>
        <div className="brandSettingsNotice">
          {message || "正在加载企业品牌配置…"}
        </div>
      </article>
    );
  }

  return (
    <article className="brandSettingsPanel">
      <div className="brandSettingsHeader">
        <div>
          <span>ENTERPRISE BRANDING</span>
          <h3>企业品牌</h3>
          <p>
            配置企业名称、Logo、主色、登录文案和邀请邮件品牌信息。普通成员可查看，Owner / Admin 才能修改。
          </p>
        </div>
        <div className="brandPermissionState">
          {canManage ? "可编辑" : "仅管理员可配置"}
        </div>
      </div>

      <div
        className="brandPreview"
        style={{
          borderColor: settings.primaryColor || "#2563EB"
        }}
      >
        <div
          className="brandPreviewLogo"
          style={{
            background: settings.primaryColor || "#2563EB"
          }}
        >
          {settings.logoUrl ? (
            <img
              src={settings.logoUrl}
              alt="企业 Logo"
            />
          ) : (
            <strong>
              {(settings.shortName || settings.organizationName || "O")
                .slice(0, 1)
                .toUpperCase()}
            </strong>
          )}
        </div>
        <div>
          <strong>
            {settings.organizationName || "企业名称"}
          </strong>
          <span>
            {settings.loginTitle || "OpenEnterpriseAI"}
          </span>
          <small>
            {settings.loginSubtitle || "AI 原生企业应用平台"}
          </small>
        </div>
      </div>

      <div className="brandFieldGrid">
        <Field
          label="企业名称"
          value={settings.organizationName}
          disabled={!canManage}
          onChange={(value) => setField("organizationName", value)}
        />
        <Field
          label="简称"
          value={settings.shortName}
          disabled={!canManage}
          onChange={(value) => setField("shortName", value)}
        />
        <Field
          label="Logo URL"
          value={settings.logoUrl}
          disabled={!canManage}
          placeholder="https://..."
          onChange={(value) => setField("logoUrl", value)}
        />
        <label className="brandField">
          <span>主色</span>
          <div className="brandColorField">
            <input
              type="color"
              disabled={!canManage}
              value={settings.primaryColor || "#2563EB"}
              onChange={(event) =>
                setField("primaryColor", event.target.value.toUpperCase())
              }
            />
            <input
              disabled={!canManage}
              value={settings.primaryColor}
              onChange={(event) =>
                setField("primaryColor", event.target.value)
              }
            />
          </div>
        </label>
        <Field
          label="登录页标题"
          value={settings.loginTitle}
          disabled={!canManage}
          onChange={(value) => setField("loginTitle", value)}
        />
        <Field
          label="登录页副标题"
          value={settings.loginSubtitle}
          disabled={!canManage}
          onChange={(value) => setField("loginSubtitle", value)}
        />
        <Field
          label="邮件签名"
          value={settings.emailSignature}
          disabled={!canManage}
          onChange={(value) => setField("emailSignature", value)}
        />
        <Field
          label="邀请邮件标题"
          value={settings.invitationSubject}
          disabled={!canManage}
          onChange={(value) => setField("invitationSubject", value)}
        />
        <Field
          label="邀请邮件页脚"
          value={settings.invitationFooter}
          disabled={!canManage}
          onChange={(value) => setField("invitationFooter", value)}
        />
      </div>

      {canManage && (
        <button
          className="brandSaveButton"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "保存中…" : "保存企业品牌"}
        </button>
      )}

      {!canManage && (
        <div className="brandSettingsNotice">
          当前账号没有 org.manage 权限。品牌配置可查看，但只能由 Owner / Admin 修改。
        </div>
      )}

      {message && (
        <div className="brandSettingsMessage">
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
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="brandField">
      <span>{props.label}</span>
      <input
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onChange={(event) =>
          props.onChange(event.target.value)
        }
      />
    </label>
  );
}
