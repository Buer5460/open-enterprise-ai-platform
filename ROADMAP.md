# OEAP Roadmap

This roadmap is directional rather than a fixed release commitment. OEAP is still in an experimental stage and priorities may change as the package model and developer experience mature.

## Phase 0 — Runtime foundation

Status: substantially implemented in the current prototype.

- [x] Package specification
- [x] Capability registry
- [x] Connector runtime / MCP abstraction
- [x] Permission engine
- [x] Approval engine
- [x] Audit log
- [x] Action Gateway
- [x] Skill runtime
- [x] Agent runtime
- [x] Workflow runtime
- [x] Package manager
- [x] DeepSeek Harness adapter
- [x] Provider-independent `ai.generate`
- [x] AI-generated application blueprints
- [x] App Package generation
- [x] App installer prototype
- [x] Generated-app data runtime prototype

## Phase 1 — Usable application builder

- [ ] Full generated CRUD: create, edit, delete, detail, search and pagination
- [ ] Field widgets for enum, date, currency, relation, attachment and rich text
- [ ] Blueprint validation and deterministic schema generation
- [ ] Application version history
- [ ] AI-assisted application modification after creation
- [ ] Schema migration when an AI-generated app evolves
- [ ] Reusable page and dashboard templates
- [ ] Production-ready local start / development tooling

## Phase 2 — Enterprise workspace

- [ ] Organizations and Workspaces
- [ ] Authentication
- [ ] Role-based access control
- [ ] Per-app role and data-scope policies
- [ ] Enterprise knowledge base
- [ ] File and document access layer
- [ ] Persistent audit log
- [ ] Approval center
- [ ] Task and run history
- [ ] Usage and model-call accounting

## Phase 3 — Developer platform

- [ ] OEAP SDK
- [ ] OEAP CLI
- [ ] `oeap create skill`
- [ ] `oeap create agent`
- [ ] `oeap create connector`
- [ ] `oeap create app`
- [ ] Local package development mode
- [ ] Package validation and linting
- [ ] Contract tests
- [ ] Package signing and provenance
- [ ] Developer documentation site

## Phase 4 — Marketplace

- [ ] Package registry
- [ ] Public package pages
- [ ] Install from registry
- [ ] Version and dependency resolution
- [ ] Ratings and reviews
- [ ] Publisher identities
- [ ] Free / paid packages
- [ ] Subscription and metered pricing
- [ ] Security review and package scanning
- [ ] Revenue sharing

## Phase 5 — Official enterprise packages

The first official package families are expected to cover:

### Software development

- PRD Skill
- Architecture Skill
- Coding Skill
- Code Review Skill
- GitHub Connector
- Deployment Workflow

### Growth and sales

- Lead Generation Skill
- Lead Scoring Skill
- Social Discovery Skill
- First-touch Skill
- Outreach Skill
- CRM Skill
- Growth Agent

### Business analysis

- Company Research Skill
- Competitor Analysis Skill
- Business Analysis Skill
- Operating Metrics Skill
- Business Agent

### Investment research

- Company Research
- Financial Statement Analysis
- Valuation
- Risk Analysis
- Investment Memo
- Investment Agent

## Phase 6 — Industry application ecosystem

Potential community and official application families include:

- Payments and payment-service ERP
- Cross-border payments
- Travel and tourism
- Transportation
- Retail
- International trade
- Quantitative research
- Legal operations
- HR
- Customer service

These should remain installable packages rather than becoming hard-coded OEAP core modules.

## Long-term direction

OEAP aims to make enterprise application creation accessible to business experts while remaining open to professional developers.

The long-term architecture is intended to support three creation paths that produce the same underlying package model:

1. Natural-language AI App Builder
2. Visual application / workflow builder
3. Developer SDK and source code

The project should remain runtime-agnostic where practical, allowing DeepSeek Harness and future AI runtimes or model providers to coexist behind standard OEAP capabilities.
