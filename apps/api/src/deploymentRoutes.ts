import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  BrandSettingsStore
} from "./brandSettingsStore.js";
import {
  MailDeliveryService
} from "./mailDelivery.js";
import type {
  MailSettingsStore
} from "./mailSettingsStore.js";
import {
  TenancyStore
} from "./tenancyStore.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import { runtimePath } from "./runtimePaths.js";

export interface DeploymentRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  mailSettingsStore: MailSettingsStore;
  brandSettingsStore: BrandSettingsStore;
}

type CheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "info";

type DeploymentCheck = {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  action?: string;
};

export function registerDeploymentRoutes(
  options: DeploymentRoutesOptions
) {
  const tenancy = new TenancyStore(
    runtimePath(
      options.repoRoot,
      "tenancy",
      "tenancy.sqlite"
    )
  );

  options.app.get(
    "/api/deployment/status",
    async (request, reply) => {
      const identity = requireOrganizationMember(
        tenancy,
        request,
        reply
      );
      if (!identity) return;

      const mode = deploymentMode();
      const production = mode === "production";
      const mail = new MailDeliveryService(
        options.mailSettingsStore.get(
          identity.organizationId
        )
      ).status();
      const brand =
        options.brandSettingsStore.get(
          identity.organizationId
        );
      const publicWeb = process.env.OEAP_PUBLIC_WEB_URL;
      const publicApi = process.env.OEAP_PUBLIC_API_URL;

      const providers = authProviderState();
      const checks: DeploymentCheck[] = [
        {
          id: "deployment-mode",
          title: "部署模式",
          status: production ? "pass" : "info",
          summary: production
            ? "当前已启用 production 部署模式。"
            : "当前处于 development 模式，适合本机开发与功能验证。",
          action: production
            ? undefined
            : "正式部署前设置 OEAP_DEPLOYMENT_MODE=production。"
        },
        localAuthCheck(production),
        externalAuthCheck(production, providers),
        publicUrlCheck(
          "public-web-url",
          "公开 Web 地址",
          publicWeb,
          production,
          "OEAP_PUBLIC_WEB_URL"
        ),
        publicUrlCheck(
          "public-api-url",
          "公开 API 地址",
          publicApi,
          production,
          "OEAP_PUBLIC_API_URL"
        ),
        corsCheck(production, publicWeb, publicApi),
        mailCheck(production, mail.activeProvider),
        brandCheck(brand),
        settingsKeyCheck(
          options.repoRoot,
          production
        ),
        nodeEnvironmentCheck(production),
        dataDirectoryCheck(production)
      ];

      const counts = {
        pass: checks.filter(
          (item) => item.status === "pass"
        ).length,
        warning: checks.filter(
          (item) => item.status === "warning"
        ).length,
        fail: checks.filter(
          (item) => item.status === "fail"
        ).length,
        info: checks.filter(
          (item) => item.status === "info"
        ).length
      };

      const scored = checks.filter(
        (item) => item.status !== "info"
      );
      const score = scored.length === 0
        ? 100
        : Math.round(
            scored.reduce((total, item) => {
              if (item.status === "pass") return total + 1;
              if (item.status === "warning") return total + 0.5;
              return total;
            }, 0) /
              scored.length *
              100
          );

      return {
        ok: true,
        mode,
        production,
        organizationId:
          identity.organizationId,
        score,
        counts,
        checks,
        authProviders: providers,
        mailProvider: mail.activeProvider,
        generatedAt: new Date().toISOString()
      };
    }
  );
}

function requireOrganizationMember(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply
): {
  organizationId: string;
  memberId: string;
} | undefined {
  const organizationId =
    organizationFrom(request);
  const memberId = memberFrom(request);

  try {
    if (!tenancy.authorize({
      organizationId,
      memberId,
      permission: "org.read"
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }

  return {
    organizationId,
    memberId
  };
}

function deploymentMode():
  | "development"
  | "production" {
  return process.env.OEAP_DEPLOYMENT_MODE
    ?.trim()
    .toLowerCase() === "production"
    ? "production"
    : "development";
}

function localAuthCheck(
  production: boolean
): DeploymentCheck {
  const configured =
    process.env.OEAP_LOCAL_AUTH
      ?.trim()
      .toLowerCase();
  const enabled = production
    ? configured === "enabled"
    : configured !== "disabled";

  if (production) {
    return !enabled
      ? {
          id: "local-auth",
          title: "本地开发登录",
          status: "pass",
          summary:
            "生产环境已关闭 Local Development 登录。"
        }
      : {
          id: "local-auth",
          title: "本地开发登录",
          status: "fail",
          summary:
            "生产环境显式启用了 Local Development 登录。",
          action:
            "移除 OEAP_LOCAL_AUTH=enabled 或设置 OEAP_LOCAL_AUTH=disabled，并启用企业 OAuth / OIDC。"
        };
  }

  return {
    id: "local-auth",
    title: "本地开发登录",
    status: "info",
    summary:
      enabled
        ? "本地开发登录已启用，便于当前自托管开发。"
        : "本地开发登录已关闭。"
  };
}

function externalAuthCheck(
  production: boolean,
  providers: ReturnType<typeof authProviderState>
): DeploymentCheck {
  const configured = providers.filter(
    (item) => item.configured
  );

  if (configured.length > 0) {
    return {
      id: "external-auth",
      title: "企业身份 Provider",
      status: "pass",
      summary:
        `已配置 ${configured.map((item) => item.name).join("、")}。`
    };
  }

  return {
    id: "external-auth",
    title: "企业身份 Provider",
    status: production ? "fail" : "warning",
    summary:
      "尚未配置 GitHub、Google、Microsoft 或企业 OIDC。",
    action:
      "生产部署至少配置一个外部身份 Provider。"
  };
}

function publicUrlCheck(
  id: string,
  title: string,
  value: string | undefined,
  production: boolean,
  variable: string
): DeploymentCheck {
  const trimmed = value?.trim();

  if (!trimmed) {
    return {
      id,
      title,
      status: production ? "fail" : "info",
      summary:
        production
          ? "生产环境缺少公开访问地址。"
          : "本地开发暂不需要公开访问地址。",
      action:
        production
          ? `设置 ${variable}。`
          : undefined
    };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      id,
      title,
      status: production ? "fail" : "warning",
      summary: "公开访问地址格式无效。",
      action: `修正 ${variable}。`
    };
  }

  if (production && url.protocol !== "https:") {
    return {
      id,
      title,
      status: "fail",
      summary: "生产公开访问地址必须使用 HTTPS。",
      action: `将 ${variable} 设置为 HTTPS 地址。`
    };
  }

  return {
    id,
    title,
    status: "pass",
    summary:
      production
        ? "已配置 HTTPS 公开访问地址。"
        : "已配置公开访问地址。"
  };
}

function corsCheck(
  production: boolean,
  publicWeb?: string,
  publicApi?: string
): DeploymentCheck {
  const origins =
    process.env.OEAP_CORS_ORIGINS
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];

  if (!production) {
    return {
      id: "cors",
      title: "CORS 白名单",
      status: origins.length > 0 ? "pass" : "warning",
      summary:
        origins.length > 0
          ? "已配置允许访问 API 的 Web Origin。"
          : "开发模式未限制 CORS Origin。"
    };
  }

  const webOrigin = originOf(publicWeb);
  const apiOrigin = originOf(publicApi);

  if (webOrigin && apiOrigin && webOrigin === apiOrigin) {
    if (origins.includes("*")) {
      return {
        id: "cors",
        title: "CORS 白名单",
        status: "fail",
        summary: "生产环境禁止使用 CORS 通配符 *。",
        action: "删除通配符；同源部署无需配置 OEAP_CORS_ORIGINS。"
      };
    }

    return {
      id: "cors",
      title: "CORS 白名单",
      status: "pass",
      summary:
        origins.length === 0
          ? "Web 与 API 同源，CORS 已按 fail-closed 方式关闭。"
          : "Web 与 API 同源，并配置了显式 CORS Origin。"
    };
  }

  if (origins.length === 0) {
    return {
      id: "cors",
      title: "CORS 白名单",
      status: "fail",
      summary:
        "Web 与 API 非同源，但没有配置 CORS Origin 白名单。",
      action:
        "设置 OEAP_CORS_ORIGINS 为实际 Web HTTPS Origin。"
    };
  }

  if (origins.includes("*")) {
    return {
      id: "cors",
      title: "CORS 白名单",
      status: "fail",
      summary: "生产环境禁止使用 CORS 通配符 *。",
      action: "只保留可信的 Web HTTPS Origin。"
    };
  }

  const invalid = origins.find((origin) => {
    const parsed = originOf(origin);
    return !parsed || !parsed.startsWith("https://");
  });

  if (invalid) {
    return {
      id: "cors",
      title: "CORS 白名单",
      status: "fail",
      summary: `CORS Origin 无效或不是 HTTPS：${invalid}`,
      action: "修正 OEAP_CORS_ORIGINS。"
    };
  }

  if (webOrigin && !origins.includes(webOrigin)) {
    return {
      id: "cors",
      title: "CORS 白名单",
      status: "fail",
      summary: "CORS 白名单未包含当前公开 Web Origin。",
      action: `将 ${webOrigin} 加入 OEAP_CORS_ORIGINS。`
    };
  }

  return {
    id: "cors",
    title: "CORS 白名单",
    status: "pass",
    summary: "已配置受限的 HTTPS CORS Origin 白名单。"
  };
}

function originOf(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).origin;
  } catch {
    return undefined;
  }
}

function mailCheck(
  production: boolean,
  provider: string
): DeploymentCheck {
  if (provider !== "manual") {
    return {
      id: "mail",
      title: "企业邮件服务",
      status: "pass",
      summary: `当前使用 ${provider} 邮件通道。`
    };
  }

  return {
    id: "mail",
    title: "企业邮件服务",
    status: production ? "warning" : "info",
    summary:
      "当前为手动邀请链接模式，没有自动邮件发送。",
    action:
      production
        ? "建议配置 SMTP、Resend 或企业邮件 Webhook。"
        : undefined
  };
}

function brandCheck(
  brand: {
    organizationName?: string;
    shortName?: string;
    primaryColor?: string;
  }
): DeploymentCheck {
  const configured = Boolean(
    brand.organizationName?.trim() &&
    brand.shortName?.trim() &&
    brand.primaryColor?.trim()
  );

  return configured
    ? {
        id: "brand",
        title: "企业品牌",
        status: "pass",
        summary:
          "企业名称、简称和主题主色已配置。"
      }
    : {
        id: "brand",
        title: "企业品牌",
        status: "warning",
        summary:
          "仍在使用部分 OEAP 默认品牌配置。",
        action:
          "在企业与权限页面完善企业品牌。"
      };
}

function settingsKeyCheck(
  repoRoot: string,
  production: boolean
): DeploymentCheck {
  const settingsDir = runtimePath(
    repoRoot,
    "settings"
  );
  const keys = [
    "mail-settings.key",
    "brand-settings.key"
  ];
  const present = keys.every(
    (name) => existsSync(join(settingsDir, name))
  );

  return present
    ? {
        id: "settings-keys",
        title: "本地敏感配置加密",
        status: "pass",
        summary:
          "邮件与品牌配置的本地加密密钥已创建，并位于运行数据目录。"
      }
    : {
        id: "settings-keys",
        title: "本地敏感配置加密",
        status: production ? "fail" : "warning",
        summary:
          "部分本地配置加密密钥尚未创建。",
        action:
          "启动并保存一次企业配置后，确认运行数据目录中的 settings 已持久化且不进入 Git。"
      };
}

function nodeEnvironmentCheck(
  production: boolean
): DeploymentCheck {
  const nodeProduction =
    process.env.NODE_ENV === "production";

  if (!production) {
    return {
      id: "node-env",
      title: "Node 运行模式",
      status: "info",
      summary:
        `NODE_ENV=${process.env.NODE_ENV || "未设置"}。`
    };
  }

  return nodeProduction
    ? {
        id: "node-env",
        title: "Node 运行模式",
        status: "pass",
        summary: "NODE_ENV=production。"
      }
    : {
        id: "node-env",
        title: "Node 运行模式",
        status: "warning",
        summary:
          "OEAP 已设为 production，但 NODE_ENV 不是 production。",
        action:
          "设置 NODE_ENV=production。"
      };
}

function dataDirectoryCheck(
  production: boolean
): DeploymentCheck {
  const configured = Boolean(
    process.env.OEAP_DATA_DIR?.trim()
  );

  if (configured) {
    return {
      id: "data-dir",
      title: "持久化数据目录",
      status: "pass",
      summary:
        "已声明 OEAP_DATA_DIR，可用于部署卷持久化规划。"
    };
  }

  return {
    id: "data-dir",
    title: "持久化数据目录",
    status: production ? "warning" : "info",
    summary:
      "当前运行数据仍位于仓库 .tmp 目录。",
    action:
      production
        ? "生产部署建议设置并挂载持久化 OEAP_DATA_DIR。"
        : undefined
  };
}

function authProviderState() {
  return [
    {
      id: "github",
      name: "GitHub",
      configured: Boolean(
        process.env.OEAP_GITHUB_CLIENT_ID &&
        process.env.OEAP_GITHUB_CLIENT_SECRET
      )
    },
    {
      id: "google",
      name: "Google Workspace",
      configured: Boolean(
        process.env.OEAP_GOOGLE_CLIENT_ID &&
        process.env.OEAP_GOOGLE_CLIENT_SECRET
      )
    },
    {
      id: "microsoft",
      name: "Microsoft Entra ID",
      configured: Boolean(
        process.env.OEAP_MICROSOFT_CLIENT_ID &&
        process.env.OEAP_MICROSOFT_CLIENT_SECRET
      )
    },
    {
      id: "oidc",
      name: "Enterprise OIDC",
      configured: Boolean(
        process.env.OEAP_OIDC_ISSUER &&
        process.env.OEAP_OIDC_CLIENT_ID &&
        process.env.OEAP_OIDC_CLIENT_SECRET
      )
    }
  ];
}

function forbidden(
  reply: FastifyReply
) {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}
