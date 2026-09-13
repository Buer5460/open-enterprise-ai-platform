import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type {
  AppBlueprint
} from "@oeap/app-builder";
import {
  appPackageBuilder
} from "@oeap/app-package-builder";
import {
  DeepSeekHarnessAdapter
} from "@oeap/harness-adapter";

import {
  dshHome,
  harnessRoot,
  runtimePath
} from "./runtimePaths.js";
import {
  memberFrom,
  organizationFrom
} from "./tenancyRoutes.js";
import {
  TenancyStore
} from "./tenancyStore.js";

export interface UsabilityRoutesOptions {
  app: FastifyInstance;
  repoRoot: string;
  openEnterpriseRoot: string;
  loadApps: (organizationId?: string) => Promise<any[]>;
}

type TemplateDefinition = {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  blueprint: AppBlueprint;
};

type RuntimeStatus = {
  provider: "deepseek-harness";
  available: boolean;
  state: "online" | "offline";
  message: string;
  checkedAt: string;
};

const templates: TemplateDefinition[] = [
  {
    id: "crm-basic",
    name: "客户经营 CRM",
    description: "客户、跟进、销售机会和成交阶段管理，适合销售团队快速开始。",
    category: "销售 / CRM",
    icon: "CRM",
    blueprint: {
      appName: "客户经营 CRM",
      summary: "用于管理客户资料、跟进记录、销售机会和成交过程的企业 CRM。",
      roles: [
        {
          name: "销售经理",
          description: "管理客户、机会和团队跟进",
          permissions: ["customer.manage", "opportunity.manage"]
        },
        {
          name: "销售顾问",
          description: "维护客户并记录跟进",
          permissions: ["customer.read", "customer.write", "followup.write"]
        }
      ],
      entities: [
        {
          name: "Customer",
          description: "客户主档",
          fields: [
            { name: "name", label: "客户名称", type: "string", required: true },
            { name: "contactName", label: "联系人", type: "string" },
            { name: "phone", label: "电话", type: "phone" },
            { name: "email", label: "邮箱", type: "email" },
            { name: "source", label: "来源", type: "enum", options: ["转介绍", "线上获客", "线下拜访", "渠道", "其他"] },
            { name: "status", label: "客户状态", type: "enum", required: true, options: ["潜在", "跟进中", "已成交", "暂缓", "流失"] },
            { name: "owner", label: "负责人", type: "string" },
            { name: "notes", label: "备注", type: "richtext" }
          ]
        },
        {
          name: "FollowUp",
          description: "客户跟进记录",
          fields: [
            { name: "customerId", label: "客户", type: "relation", required: true, relationEntity: "Customer", relationDisplayField: "name" },
            { name: "followedAt", label: "跟进时间", type: "datetime", required: true },
            { name: "method", label: "跟进方式", type: "enum", options: ["电话", "微信", "邮件", "面谈", "其他"] },
            { name: "content", label: "跟进内容", type: "richtext", required: true },
            { name: "nextActionAt", label: "下次跟进", type: "datetime" }
          ]
        },
        {
          name: "Opportunity",
          description: "销售机会",
          fields: [
            { name: "customerId", label: "客户", type: "relation", required: true, relationEntity: "Customer", relationDisplayField: "name" },
            { name: "title", label: "机会名称", type: "string", required: true },
            { name: "amount", label: "预计金额", type: "currency" },
            { name: "stage", label: "阶段", type: "enum", options: ["需求确认", "方案报价", "商务谈判", "赢单", "输单"] },
            { name: "expectedCloseDate", label: "预计成交日期", type: "date" }
          ]
        }
      ],
      pages: [
        { id: "customers", label: "客户管理", purpose: "维护客户主档" },
        { id: "followups", label: "销售跟进", purpose: "记录客户沟通与下一步行动" },
        { id: "opportunities", label: "销售机会", purpose: "管理销售漏斗和预计金额" }
      ],
      workflows: [
        {
          name: "客户跟进闭环",
          description: "从潜客到成交的标准跟进流程",
          steps: ["录入客户", "首次联系", "持续跟进", "创建销售机会", "成交或关闭"]
        }
      ],
      recommendedPackages: { skills: [], agents: [], connectors: [] }
    }
  },
  {
    id: "travel-agency",
    name: "旅行社经营管理",
    description: "客户、旅游产品、订单和收付款管理，适合旅行社及地接业务。",
    category: "旅游",
    icon: "TRV",
    blueprint: {
      appName: "旅行社经营管理系统",
      summary: "旅行社客户、产品、订单、游客和收付款一体化经营管理。",
      roles: [
        { name: "负责人", description: "查看和管理全部经营数据", permissions: ["*"] },
        { name: "销售", description: "客户、产品与订单操作", permissions: ["customer.write", "booking.write"] },
        { name: "财务", description: "收付款与订单财务核对", permissions: ["payment.write", "booking.read"] }
      ],
      entities: [
        {
          name: "Customer",
          description: "游客或企业客户",
          fields: [
            { name: "name", label: "客户名称", type: "string", required: true },
            { name: "phone", label: "联系电话", type: "phone" },
            { name: "country", label: "国家/地区", type: "string" },
            { name: "passportOrId", label: "证件号", type: "string" },
            { name: "source", label: "获客来源", type: "enum", options: ["WhatsApp", "微信", "渠道", "门店", "转介绍", "其他"] }
          ]
        },
        {
          name: "TourProduct",
          description: "旅游线路和标准产品",
          fields: [
            { name: "name", label: "产品名称", type: "string", required: true },
            { name: "destination", label: "目的地", type: "string", required: true },
            { name: "days", label: "天数", type: "integer" },
            { name: "salePrice", label: "销售价", type: "currency" },
            { name: "status", label: "状态", type: "enum", options: ["在售", "停售", "草稿"] },
            { name: "itinerary", label: "行程说明", type: "richtext" },
            { name: "attachment", label: "产品附件", type: "attachment" }
          ]
        },
        {
          name: "Booking",
          description: "旅游订单",
          fields: [
            { name: "customerId", label: "客户", type: "relation", required: true, relationEntity: "Customer", relationDisplayField: "name" },
            { name: "productId", label: "旅游产品", type: "relation", required: true, relationEntity: "TourProduct", relationDisplayField: "name" },
            { name: "departureDate", label: "出发日期", type: "date" },
            { name: "peopleCount", label: "人数", type: "integer" },
            { name: "totalAmount", label: "订单金额", type: "currency" },
            { name: "status", label: "订单状态", type: "enum", options: ["询价", "待确认", "已确认", "出行中", "已完成", "已取消"] }
          ]
        },
        {
          name: "Payment",
          description: "订单收付款记录",
          fields: [
            { name: "bookingId", label: "订单", type: "relation", required: true, relationEntity: "Booking", relationDisplayField: "id" },
            { name: "type", label: "类型", type: "enum", options: ["收款", "退款", "成本付款"] },
            { name: "amount", label: "金额", type: "currency", required: true },
            { name: "paidAt", label: "时间", type: "datetime" },
            { name: "method", label: "方式", type: "enum", options: ["微信", "支付宝", "银行卡", "信用卡", "现金", "其他"] }
          ]
        }
      ],
      pages: [
        { id: "customers", label: "客户管理", purpose: "管理游客及企业客户" },
        { id: "products", label: "旅游产品", purpose: "维护线路与标准产品" },
        { id: "bookings", label: "订单管理", purpose: "管理预订与出行状态" },
        { id: "payments", label: "收付款", purpose: "管理订单收入、退款和成本" }
      ],
      workflows: [
        { name: "旅游订单履约", description: "从客户询价到行程结束", steps: ["客户询价", "产品报价", "确认订单", "收款", "出行", "完成"] }
      ],
      recommendedPackages: { skills: [], agents: [], connectors: [] }
    }
  },
  {
    id: "payment-service-erp",
    name: "支付服务商 ERP",
    description: "商户、终端、交易、物料和结算管理，适合支付服务商日常经营。",
    category: "支付",
    icon: "PAY",
    blueprint: {
      appName: "支付服务商 ERP",
      summary: "面向聚合支付服务商的商户、设备、交易流水、物料投入和结算经营管理系统。",
      roles: [
        { name: "管理员", description: "平台经营管理", permissions: ["*"] },
        { name: "渠道经理", description: "维护商户和物料", permissions: ["merchant.write", "asset.write", "transaction.read"] },
        { name: "财务", description: "查看交易和结算", permissions: ["transaction.read", "settlement.write"] }
      ],
      entities: [
        {
          name: "Merchant",
          description: "自有商户主档，一个营业执照可映射多个实际商家",
          fields: [
            { name: "merchantName", label: "商家名称", type: "string", required: true },
            { name: "merchantCode", label: "自有商户 ID", type: "string", required: true },
            { name: "licenseNo", label: "营业执照号", type: "string" },
            { name: "channelManager", label: "渠道经理", type: "string" },
            { name: "provider", label: "支付通道", type: "enum", options: ["拉卡拉", "易宝", "易生", "银盛", "其他"] },
            { name: "providerMerchantNo", label: "通道商户号", type: "string" },
            { name: "status", label: "状态", type: "enum", options: ["进件中", "正常", "暂停", "关闭"] }
          ]
        },
        {
          name: "Terminal",
          description: "POS、码牌、路由器等设备物料",
          fields: [
            { name: "merchantId", label: "商户", type: "relation", required: true, relationEntity: "Merchant", relationDisplayField: "merchantName" },
            { name: "assetType", label: "物料类型", type: "enum", options: ["POS", "收款码牌", "路由器", "打印机", "其他"] },
            { name: "serialNo", label: "设备序列号", type: "string" },
            { name: "cost", label: "投入成本", type: "currency" },
            { name: "borneBy", label: "承担方", type: "enum", options: ["公司", "商户", "渠道经理"] },
            { name: "deployedAt", label: "投放日期", type: "date" }
          ]
        },
        {
          name: "Transaction",
          description: "交易汇总或流水",
          fields: [
            { name: "merchantId", label: "商户", type: "relation", required: true, relationEntity: "Merchant", relationDisplayField: "merchantName" },
            { name: "tradeDate", label: "交易日期", type: "date", required: true },
            { name: "amount", label: "交易金额", type: "currency", required: true },
            { name: "feeIncome", label: "分润收入", type: "currency" },
            { name: "channel", label: "支付方式", type: "enum", options: ["微信", "支付宝", "银行卡", "数字人民币", "其他"] }
          ]
        },
        {
          name: "Settlement",
          description: "商户或渠道结算记录",
          fields: [
            { name: "merchantId", label: "商户", type: "relation", relationEntity: "Merchant", relationDisplayField: "merchantName" },
            { name: "period", label: "结算周期", type: "string" },
            { name: "amount", label: "结算金额", type: "currency", required: true },
            { name: "status", label: "状态", type: "enum", options: ["待核对", "待支付", "已结算"] },
            { name: "settledAt", label: "结算时间", type: "datetime" }
          ]
        }
      ],
      pages: [
        { id: "merchants", label: "商户管理", purpose: "按真实商家管理进件和通道映射" },
        { id: "terminals", label: "终端物料", purpose: "管理设备和投入成本" },
        { id: "transactions", label: "交易流水", purpose: "统计交易额与分润收入" },
        { id: "settlements", label: "结算管理", purpose: "管理商户和渠道结算" }
      ],
      workflows: [
        { name: "商户经营生命周期", description: "进件、物料、交易、结算的闭环", steps: ["建立商户", "支付通道进件", "物料投放", "交易运营", "分润核算", "结算"] }
      ],
      recommendedPackages: { skills: [], agents: [], connectors: [] }
    }
  },
  {
    id: "project-ops",
    name: "项目任务协同",
    description: "项目、任务、里程碑和负责人协同，适合软件项目及内部执行管理。",
    category: "项目管理",
    icon: "PRJ",
    blueprint: {
      appName: "项目任务协同系统",
      summary: "企业项目、任务、负责人、里程碑和交付状态管理。",
      roles: [
        { name: "项目经理", description: "管理项目和任务", permissions: ["project.write", "task.write"] },
        { name: "项目成员", description: "执行和更新任务", permissions: ["project.read", "task.write"] },
        { name: "观察者", description: "查看项目进度", permissions: ["project.read", "task.read"] }
      ],
      entities: [
        {
          name: "Project",
          description: "项目主档",
          fields: [
            { name: "name", label: "项目名称", type: "string", required: true },
            { name: "customer", label: "客户/业务部门", type: "string" },
            { name: "owner", label: "项目负责人", type: "string" },
            { name: "startDate", label: "开始日期", type: "date" },
            { name: "dueDate", label: "计划完成", type: "date" },
            { name: "status", label: "项目状态", type: "enum", options: ["规划中", "进行中", "待验收", "已完成", "暂停"] },
            { name: "budget", label: "预算", type: "currency" },
            { name: "description", label: "项目说明", type: "richtext" }
          ]
        },
        {
          name: "Task",
          description: "项目任务",
          fields: [
            { name: "projectId", label: "项目", type: "relation", required: true, relationEntity: "Project", relationDisplayField: "name" },
            { name: "title", label: "任务", type: "string", required: true },
            { name: "assignee", label: "负责人", type: "string" },
            { name: "priority", label: "优先级", type: "enum", options: ["低", "中", "高", "紧急"] },
            { name: "status", label: "任务状态", type: "enum", options: ["待处理", "进行中", "阻塞", "待验收", "已完成"] },
            { name: "dueDate", label: "截止日期", type: "date" },
            { name: "attachment", label: "附件", type: "attachment" }
          ]
        },
        {
          name: "Milestone",
          description: "项目里程碑",
          fields: [
            { name: "projectId", label: "项目", type: "relation", required: true, relationEntity: "Project", relationDisplayField: "name" },
            { name: "name", label: "里程碑", type: "string", required: true },
            { name: "dueDate", label: "目标日期", type: "date" },
            { name: "status", label: "状态", type: "enum", options: ["未开始", "进行中", "已完成", "延期"] }
          ]
        }
      ],
      pages: [
        { id: "projects", label: "项目管理", purpose: "维护项目和整体进度" },
        { id: "tasks", label: "任务管理", purpose: "分解和跟踪执行任务" },
        { id: "milestones", label: "里程碑", purpose: "跟踪关键交付节点" }
      ],
      workflows: [
        { name: "项目执行", description: "从立项到验收", steps: ["项目立项", "任务分解", "执行跟踪", "里程碑检查", "验收关闭"] }
      ],
      recommendedPackages: { skills: [], agents: [], connectors: [] }
    }
  }
];

export function registerUsabilityRoutes(
  options: UsabilityRoutesOptions
) {
  const {
    app,
    repoRoot,
    openEnterpriseRoot,
    loadApps
  } = options;

  const tenancy = new TenancyStore(
    runtimePath(repoRoot, "tenancy", "tenancy.sqlite")
  );
  const adapter = new DeepSeekHarnessAdapter({
    harnessRoot: harnessRoot(openEnterpriseRoot),
    dshHome: dshHome(openEnterpriseRoot),
    workspaceRoot: repoRoot
  });

  let cachedRuntime:
    | { value: RuntimeStatus; expiresAt: number }
    | undefined;

  async function runtimeStatus(
    force = false
  ): Promise<RuntimeStatus> {
    if (
      !force &&
      cachedRuntime &&
      cachedRuntime.expiresAt > Date.now()
    ) {
      return cachedRuntime.value;
    }

    const checkedAt = new Date().toISOString();
    let status: RuntimeStatus;

    try {
      const result = await adapter.healthCheck();
      const message = result.ok
        ? "DeepSeek Harness Runtime 已就绪"
        : result.stderr.includes("timed out")
          ? "DeepSeek Harness 健康检查超时"
          : result.stderr.includes("CLI not built")
            ? "DeepSeek Harness CLI 尚未构建或未安装"
            : "DeepSeek Harness Runtime 当前不可用";

      status = {
        provider: "deepseek-harness",
        available: result.ok,
        state: result.ok ? "online" : "offline",
        message,
        checkedAt
      };
    } catch {
      status = {
        provider: "deepseek-harness",
        available: false,
        state: "offline",
        message: "DeepSeek Harness Runtime 当前不可用",
        checkedAt
      };
    }

    cachedRuntime = {
      value: status,
      expiresAt: Date.now() + 10_000
    };
    return status;
  }

  app.get(
    "/api/usability/status",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read"
      );
      if (!identity) return;

      const apps = (await loadApps(identity.organizationId))
        .filter((item) => can(
          tenancy,
          identity,
          "apps.read",
          item.id
        ));

      return {
        ok: true,
        organizationId: identity.organizationId,
        firstRun: apps.length === 0,
        installedApps: apps.length,
        templates: templates.length,
        ai: await runtimeStatus()
      };
    }
  );

  app.get(
    "/api/usability/templates",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.read"
      );
      if (!identity) return;

      return {
        ok: true,
        templates: templates.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          icon: item.icon,
          entities: item.blueprint.entities.length,
          pages: item.blueprint.pages.length,
          workflows: item.blueprint.workflows.length
        }))
      };
    }
  );

  app.post<{
    Params: { templateId: string };
  }>(
    "/api/usability/templates/:templateId/install",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage"
      );
      if (!identity) return;

      const template = templates.find(
        (item) => item.id === request.params.templateId
      );
      if (!template) {
        return reply.code(404).send({
          ok: false,
          error: "Template not found"
        });
      }

      const suffix = Date.now();
      const packageId =
        `local.template.${safeIdentifier(identity.organizationId)}.${safeIdentifier(template.id)}.${suffix}`;
      const directoryName =
        `template-${safeIdentifier(template.id)}-${suffix}`;

      const built = await appPackageBuilder.build({
        blueprint: cloneBlueprint(template.blueprint),
        packageId,
        publisher: "oeap-template",
        version: "1.0.0",
        outputDir: generatedAppsRoot(
          repoRoot,
          identity.organizationId
        ),
        directoryName
      });

      try {
        tenancy.grantMemberAppAccess(
          identity.memberId,
          built.manifest.id,
          identity.memberId
        );
      } catch {
        // Wildcard owners already have access to every application.
      }

      return {
        ok: true,
        templateId: template.id,
        app: built.manifest
      };
    }
  );

  app.post(
    "/api/usability/ai/test",
    async (request, reply) => {
      const identity = requirePermission(
        tenancy,
        request,
        reply,
        "apps.manage"
      );
      if (!identity) return;

      const startedAt = Date.now();
      const health = await runtimeStatus(true);
      if (!health.available) {
        return reply.code(503).send({
          ok: false,
          code: "AI_RUNTIME_UNAVAILABLE",
          ai: health,
          error: health.message
        });
      }

      const result = await adapter.runHeadless(
        "只回复 OEAP_AI_RUNTIME_OK，不要解释。"
      );
      if (!result.ok) {
        return reply.code(503).send({
          ok: false,
          code: result.exitCode === 124
            ? "AI_RUNTIME_TIMEOUT"
            : "AI_RUNTIME_EXECUTION_FAILED",
          error: result.exitCode === 124
            ? "AI Runtime 调用超时"
            : "AI Runtime 调用失败",
          latencyMs: Date.now() - startedAt
        });
      }

      return {
        ok: true,
        provider: "deepseek-harness",
        latencyMs: Date.now() - startedAt,
        response: result.stdout.trim().slice(0, 200)
      };
    }
  );
}

function generatedAppsRoot(
  repoRoot: string,
  organizationId: string
): string {
  return organizationId === "org_local"
    ? runtimePath(repoRoot, "generated-apps")
    : runtimePath(
        repoRoot,
        "organizations",
        safeIdentifier(organizationId),
        "generated-apps"
      );
}

function cloneBlueprint(
  blueprint: AppBlueprint
): AppBlueprint {
  return JSON.parse(
    JSON.stringify(blueprint)
  ) as AppBlueprint;
}

type Identity = {
  organizationId: string;
  memberId: string;
};

function requirePermission(
  tenancy: TenancyStore,
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string
): Identity | undefined {
  const identity = {
    organizationId: organizationFrom(request),
    memberId: memberFrom(request)
  };

  try {
    if (!tenancy.authorize({
      ...identity,
      permission
    })) {
      return forbidden(reply);
    }
  } catch {
    return forbidden(reply);
  }

  return identity;
}

function can(
  tenancy: TenancyStore,
  identity: Identity,
  permission: string,
  appId?: string
): boolean {
  try {
    return tenancy.authorize({
      organizationId: identity.organizationId,
      memberId: identity.memberId,
      permission,
      appId
    });
  } catch {
    return false;
  }
}

function forbidden(
  reply: FastifyReply
): undefined {
  reply.code(403).send({
    ok: false,
    error: "Forbidden"
  });
  return undefined;
}

function safeIdentifier(
  value: unknown
): string {
  return String(value).replace(
    /[^A-Za-z0-9_.-]/g,
    "_"
  );
}
