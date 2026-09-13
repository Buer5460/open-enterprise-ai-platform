import React from "react";
import {
  apiFetch,
  apiUrl
} from "./apiClient";
import "./GettingStarted.css";

export type UsabilityStatus = {
  ok: boolean;
  firstRun: boolean;
  installedApps: number;
  templates: number;
  ai: {
    provider: string;
    available: boolean;
    state: "online" | "offline";
    message: string;
    checkedAt: string;
  };
};

type TemplateItem = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  entities: number;
  pages: number;
  workflows: number;
};

export function GettingStarted(props: {
  status: UsabilityStatus | null;
  onChanged: () => Promise<void> | void;
}) {
  const [templates, setTemplates] =
    React.useState<TemplateItem[]>([]);
  const [canManage, setCanManage] =
    React.useState(false);
  const [permissionReady, setPermissionReady] =
    React.useState(false);
  const [installing, setInstalling] =
    React.useState<string | null>(null);
  const [testingAI, setTestingAI] =
    React.useState(false);
  const [message, setMessage] =
    React.useState("");

  React.useEffect(() => {
    void loadSetup();
  }, []);

  async function loadSetup() {
    try {
      const [templateResponse, permissionResponse] =
        await Promise.all([
          apiFetch(apiUrl("/api/usability/templates")),
          apiFetch(
            apiUrl("/api/tenancy/authorize?permission=apps.manage")
          )
        ]);
      const [templateResult, permissionResult] =
        await Promise.all([
          templateResponse.json().catch(() => ({})),
          permissionResponse.json().catch(() => ({}))
        ]);

      if (templateResponse.ok && templateResult.ok) {
        setTemplates(templateResult.templates ?? []);
      }

      setCanManage(
        Boolean(
          permissionResponse.ok &&
          permissionResult.ok &&
          permissionResult.allowed
        )
      );
    } catch {
      setCanManage(false);
      // The workbench remains usable when template discovery fails.
    } finally {
      setPermissionReady(true);
    }
  }

  async function install(template: TemplateItem) {
    if (!canManage) {
      setMessage("当前账号只有使用权限；Owner / Admin 才能创建新的企业应用。");
      return;
    }

    setInstalling(template.id);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl(
          `/api/usability/templates/${encodeURIComponent(template.id)}/install`
        ),
        { method: "POST" }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "模板应用创建失败"
        );
      }

      setMessage(
        `「${result.app?.displayName ?? template.name}」已创建，可以直接录入业务数据。`
      );
      await props.onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "模板应用创建失败"
      );
    } finally {
      setInstalling(null);
    }
  }

  async function testAI() {
    if (!canManage) {
      setMessage("当前账号无应用管理权限，AI Runtime 测试由 Owner / Admin 执行。");
      return;
    }

    setTestingAI(true);
    setMessage("");

    try {
      const response = await apiFetch(
        apiUrl("/api/usability/ai/test"),
        { method: "POST" }
      );
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(
          result.error ?? "AI Runtime 测试失败"
        );
      }

      setMessage(
        `AI Runtime 正常，响应 ${result.latencyMs ?? "-"} ms。`
      );
      await props.onChanged();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "AI Runtime 当前不可用"
      );
    } finally {
      setTestingAI(false);
    }
  }

  const firstRun =
    props.status?.firstRun ?? false;
  const aiAvailable =
    props.status?.ai.available ?? false;

  return (
    <section className={
      firstRun
        ? "gettingStarted gettingStartedFirstRun"
        : "gettingStarted"
    }>
      <div className="gettingStartedHeading">
        <div>
          <span>DAY-1 BUSINESS APPS</span>
          <h3>
            {firstRun
              ? "开始使用 OEAP"
              : "从业务模板创建应用"}
          </h3>
          <p>
            {!permissionReady
              ? "正在确认当前账号的应用管理权限…"
              : canManage
                ? "不需要先配置 AI。选择一个模板即可生成真实可用的业务应用；AI Runtime 就绪后，再用自然语言继续修改。"
                : "你可以查看企业模板和 Runtime 状态；新建应用由 Owner / Admin 完成，已有应用仍按你的权限正常使用。"}
          </p>
        </div>

        <div className={
          aiAvailable
            ? "aiRuntimeState online"
            : "aiRuntimeState offline"
        }>
          <strong>
            {aiAvailable
              ? "● AI 已就绪"
              : "○ AI 未连接"}
          </strong>
          <small>
            {props.status?.ai.message ??
              "正在检查 DeepSeek Harness Runtime…"}
          </small>
          <button
            disabled={testingAI || !permissionReady || !canManage}
            onClick={() => void testAI()}
          >
            {!permissionReady
              ? "检查权限中…"
              : !canManage
                ? "仅管理员可测试"
                : testingAI
                  ? "测试中…"
                  : "测试 AI"}
          </button>
        </div>
      </div>

      {message && (
        <div className="gettingStartedMessage">
          {message}
        </div>
      )}

      <div className="templateGrid">
        {templates.map((template) => (
          <article
            className="templateCard"
            key={template.id}
          >
            <div className="templateCardTop">
              <div className="templateIcon">
                {template.icon}
              </div>
              <span>{template.category}</span>
            </div>

            <h4>{template.name}</h4>
            <p>{template.description}</p>

            <div className="templateMeta">
              <span>{template.entities} 数据实体</span>
              <span>{template.pages} 页面</span>
              <span>{template.workflows} 流程</span>
            </div>

            <button
              disabled={Boolean(installing) || !permissionReady || !canManage}
              onClick={() => void install(template)}
            >
              {!permissionReady
                ? "检查权限中…"
                : !canManage
                  ? "仅管理员可创建"
                  : installing === template.id
                    ? "正在创建…"
                    : "一键创建 →"}
            </button>
          </article>
        ))}
      </div>

      {!aiAvailable && (
        <div className="runtimeHint">
          AI Runtime 未连接不会影响模板应用、数据录入、文件、知识库、成员权限和运营审批等功能。
        </div>
      )}
    </section>
  );
}
