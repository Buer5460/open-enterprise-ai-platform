# OEAP 5 分钟首次使用

这份文档面向第一次使用 Open Enterprise AI Platform（OEAP）的人。目标不是先理解全部架构，而是在最短时间内完成：

1. 启动平台；
2. 创建第一个真实业务应用；
3. 录入或导入业务数据；
4. 可选连接 AI；
5. 邀请同事并开始日常使用。

> AI 不是启动 OEAP 的前置条件。没有 DeepSeek Harness 或模型 API 时，模板应用、数据 CRUD、文件、知识库、成员权限、审批和 Marketplace 等核心能力仍可使用。

## 1. 本地启动

环境要求：

- Node.js 24+
- Corepack
- pnpm 由仓库 `packageManager` 字段管理
- macOS / Linux；Windows 推荐使用 WSL2 或 Docker

首次安装：

```bash
git clone https://github.com/Buer5460/open-enterprise-ai-platform.git
cd open-enterprise-ai-platform
corepack enable
corepack pnpm install --frozen-lockfile
./scripts/start-local.sh
```

后续启动：

```bash
cd open-enterprise-ai-platform
git pull
./scripts/start-local.sh
```

浏览器打开：

```text
http://127.0.0.1:5173/
```

本地 Development 模式会自动使用 Local Owner 身份，不需要先配置企业 SSO。

## 2. 先创建一个能工作的应用

进入 **工作台** 后，不需要先配置 AI。

可以直接从 Day-1 模板创建：

- 客户经营 CRM
- 旅行社经营管理
- 支付服务商 ERP
- 项目任务协同

点击 **一键创建** 后，OEAP 会生成真实 App Package、业务页面和 SQLite 数据表。

创建成功后进入应用业务页面，即可新增、修改、搜索和删除真实业务数据。

## 3. 把现有 Excel / CSV 数据迁进来

工作台会显示 **数据迁移** 区域。

推荐流程：

1. 选择应用；
2. 选择数据实体；
3. 上传 CSV 或 JSON；
4. 先执行 **预检**；
5. 修正必填字段、枚举或类型问题；
6. 确认后执行正式导入。

OEAP 批量导入使用事务：整批数据全部通过校验后才写入数据库；中途失败不会留下半批数据。

支持：

- 英文字段名
- 中文字段标签
- 必填校验
- 枚举校验
- 数字 / 整数 / 布尔 / JSON / 关联字段转换
- 未知列拒绝
- CSV 公式注入防护
- CSV / JSON 导出

## 4. 可选：连接 AI Runtime

进入左侧 **AI Runtime**。

OEAP 支持：

### 方案 A：DeepSeek Harness

适合本地开发、Agent / Skills / MCP 深度工作流。

常用环境变量：

```bash
OEAP_HARNESS_ROOT=/path/to/deepseek-harness
OEAP_DSH_HOME=/path/to/.dsh-dev
```

### 方案 B：OpenAI-Compatible API

适合直接接：

- DeepSeek API
- OpenAI API
- newAPI
- 企业内部兼容网关
- 其他兼容 `/chat/completions` 的服务

管理员可以直接在 **AI Runtime** 页面配置：

- Provider 模式：Auto / DeepSeek Harness / OpenAI-Compatible
- Base URL
- Model
- API Key
- Timeout

API Key 使用企业级 Connector Vault 加密保存，保存后不会回显到浏览器。

服务器环境变量也支持：

```bash
OEAP_AI_PROVIDER=auto
OEAP_OPENAI_BASE_URL=https://api.example.com/v1
OEAP_OPENAI_API_KEY=...
OEAP_OPENAI_MODEL=...
OEAP_OPENAI_TIMEOUT_MS=120000
```

配置后点击 **执行真实 AI 测试**。

通过后，工作台就可以使用自然语言创建应用，已有应用也可以通过 AI Revision 持续修改。

## 5. 日常工作台

“我的应用”支持：

- 搜索应用和业务实体
- 收藏常用应用
- 最近使用排序
- 收藏/最近状态按企业成员保存在服务端
- 应用归档与恢复

归档应用不会删除业务数据库；恢复后继续使用原有数据。

## 6. 邀请同事

进入 **企业与权限**。

建议：

1. Owner / Admin 创建或选择角色；
2. 创建邀请链接；
3. 分配可以访问的应用；
4. 新成员接受邀请；
5. Production 环境使用企业 OAuth / OIDC 登录。

系统角色：

- Owner
- Admin
- Manager
- Member
- Viewer

也可以创建自定义角色。

## 7. 企业知识和文件

进入：

- **文件中心**：保存企业附件和业务文件；
- **企业知识库**：保存 SOP、制度、产品资料、项目背景等。

AI App Builder 和 Agent Runtime 可以自动检索当前企业的相关知识片段作为上下文。

## 8. Marketplace

进入 **Marketplace** 可以浏览可安装的 Agent / Skill / Workflow / Connector 等 Package。

当前 1.1 开发线已经支持：

- Marketplace Registry
- 官方 Listing
- 搜索与详情
- 免费 Package 获取
- 订单 / Entitlement 基础模型
- 企业组织隔离的购买/授权状态

第三方付费支付网关仍应在部署时通过受控 Connector 接入，不应把支付密钥写进前端或源码。

## 9. 正式服务器上线前

准备生产 `.env` 后执行：

```bash
corepack pnpm preflight:production -- --env-file .env
```

部署完成后再执行：

```bash
corepack pnpm preflight:production -- --env-file .env --live
```

Preflight 会检查：

- Production 模式
- Local Auth 是否关闭
- OAuth / OIDC
- HTTPS Web / API URL
- CORS
- Session TTL
- 持久化数据目录
- 邮件
- DeepSeek Harness / OpenAI-Compatible AI Provider
- 线上 `/health` / `/ready`
- Web 安全响应头

正式上线还应完成：

- DNS / TLS
- 真实 OAuth/OIDC Client ID / Secret
- 备份恢复演练
- 邮件 Provider（如果需要自动邀请）
- 独立安全评审

## 10. 最短可用路径

如果你只想最快开始：

```text
启动 OEAP
→ 工作台一键创建业务模板
→ 录入/导入真实数据
→ 收藏常用应用
→ 邀请同事
→ 有需要时再连接 AI
```

这就是 OEAP 的 Day-1 使用路径：**先让业务跑起来，再逐步增加 AI、自动化和企业集成。**
