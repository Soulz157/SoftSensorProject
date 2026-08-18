CLAUDE.md

This file provides project-level guidance for Claude Code (claude.ai/code) when working with code in this repository.

The project uses dedicated Rule Books for architecture, codebase conventions, design, product, and visual decisions.

Claude MUST read and follow the applicable Rule Books before making changes.
⸻

1. Rule Books

These files are authoritative project Rule Books.

Architecture Rule Book

Read:

docs/ARCHITECTURE.md

Defines:

- System architecture
- Layer boundaries
- Authentication flow
- Architectural decisions
- Service boundaries
- Data flow
- Integration patterns

For architecture-related decisions, follow this file.
⸻
Codebase Rule Book

Read:

docs/CODEBASE.md

Defines:

- Repository structure
- File organization
- Component APIs
- Prisma patterns
- Coding conventions
- Existing implementation patterns
- Domain-specific code structure

Before changing existing code, verify the relevant implementation patterns here.
⸻
Design System Rule Book

Read:

docs/DESIGN_SYSTEM.md

Defines:

- Design tokens
- Color conventions
- Status colors
- Component patterns
- UI rules
- Interaction patterns
- Accessibility and UX conventions

For UI and design system decisions, follow this file.
⸻
Product Rule Book

Read:

PRODUCT.md

Defines:

- Product context
- Product strategy
- Users
- Brand personality
- Product principles
- Anti-references
- Product voice

For product and strategic decisions, follow this file.
⸻
Visual Design Rule Book

Read:

DESIGN.md

Defines:

- Color tokens
- Typography
- Spacing
- Elevation
- Component specifications
- Visual do's and don'ts

For visual decisions, follow this file.
⸻
Security Rule Book

Read when working on authentication, authorization, secrets, API security, database security, or other security-sensitive areas:

docs/SECURITY.md

⸻
Rule Book Priority

When multiple Rule Books apply:

1. Explicit user request
2. Security requirements
3. CLAUDE.md
4. docs/ARCHITECTURE.md
5. docs/CODEBASE.md
6. docs/DESIGN_SYSTEM.md
7. PRODUCT.md
8. DESIGN.md

If a conflict exists between existing code and a Rule Book:

- Do not silently ignore the conflict.
- Inspect the current implementation.
- Identify the conflict.
- Explain the impact.
- Follow the explicit user request when one exists.
- Otherwise, prefer the Rule Book and make the smallest safe change.
  ⸻

1. Before Every Task

Before starting work:

1. Read the applicable Rule Books.
2. Inspect the existing implementation.
3. Understand the current behavior.
4. Identify dependencies and affected areas.
5. Avoid assumptions when the repository can provide evidence.

At minimum, always read:

docs/ARCHITECTURE.md
docs/CODEBASE.md

For frontend or UI work, also read:

docs/DESIGN_SYSTEM.md
PRODUCT.md
DESIGN.md

For security-sensitive work, read:

docs/SECURITY.md

For a major feature or architectural change:

- Inspect the current architecture first.
- Identify affected modules.
- Identify API contracts.
- Identify database changes.
- Identify frontend state changes.
- Identify background processing requirements.
- Identify persistence boundaries.

Do not start implementation based only on assumptions.
⸻ 3. General Engineering Principles

Minimal Changes

- Prefer small, targeted changes.
- Do not perform unrelated refactors.
- Reuse existing architecture and libraries where possible.
- Do not introduce new frameworks or infrastructure without justification.
- Preserve existing behavior unless the user explicitly requests a behavior change.

Architecture

Follow:

Client
↓
API
↓
Service
↓
Database / External Service

Controllers and route handlers should remain thin.

Business logic belongs in services or appropriate domain modules.

Do not duplicate business logic across controllers, hooks, and components.

Type Safety

- Do not use any.
- Do not use @ts-ignore.
- Do not bypass type safety to make code compile.
- Prefer explicit domain types.
- Use proper type narrowing.

Frontend

- Default to Server Components.
- Use "use client" only when hooks, browser APIs, or event handlers require it.
- Do not put "use client" on layouts unless necessary.
- Use existing services and hooks.
- Keep page components as composition shells.
- Put data fetching in hooks/services.
- Put pure derivations in lib/.

UI Components

Generated shadcn/ui components under:

components/ui/\*\*

are immutable.

Never manually modify generated shadcn/ui components.

Use the existing shadcn configuration when adding components.

Environment Variables

Frontend backend base URL:

NEXT_PUBLIC_API_URL

Never use:

NEXT_PUBLIC_BACKEND_URL

Server-only secrets MUST NOT use the NEXT*PUBLIC* prefix.

Never commit .env files.
⸻ 4. Project Architecture

This repository is a Turborepo + pnpm monorepo.

apps/backend
NestJS 11 + Fastify
Port 4000

apps/client
Next.js 16 App Router
Port 3000

apps/python
FastAPI
Port 8000
Data Processing + PI Web API connector

packages/prisma
Shared PrismaService / PrismaModule

packages/eslint-config
Shared ESLint configuration

packages/typescript-config
Shared TypeScript configurations

High-level architecture:

Next.js Client
↓
NestJS Backend API
↓
Prisma
↓
Database

Next.js / NestJS
↓
FastAPI
↓
PI Web API

Follow the detailed architecture defined in:

docs/ARCHITECTURE.md

⸻ 5. Backend Rules

Backend:

apps/backend

Uses:

- NestJS
- Fastify
- Prisma
- JWT authentication
- RBAC

Follow:

Controller
↓
Service
↓
Prisma / External Service

Rules:

- No business logic in controllers.
- Use existing API versioning.
- Follow existing module structure.
- Follow existing DTO validation patterns.
- Use AppException from @softsensor/common for application errors.
- Do not throw NestJS built-in HTTP exceptions directly.
- Use transactions for atomic multi-step writes.
- Avoid blocking HTTP requests with long-running operations.

For detailed backend conventions, read:

docs/ARCHITECTURE.md
docs/CODEBASE.md

⸻ 6. Database Rules

Prisma schema:

packages/prisma/prisma/schema.prisma

Rules:

- Never manually modify generated Prisma client files.
- Never modify the database schema without a migration.
- Never skip migrations.
- Use Prisma transactions for atomic multi-step writes.
- Keep database responsibilities aligned with the architecture Rule Book.

After schema changes:

pnpm db:migrate:dev

Use:

pnpm db:generate

only when client regeneration is required without a schema migration.
⸻ 7. Model Creation Flow

The Model Creation Flow is a core product workflow.

The existing user-facing flow MUST remain conceptually unchanged.

Step 1
Model Setup
↓
Step 2
Training Configuration + Training
↓
Step 3
Evaluation
↓
Step 4
Save Model

Step 1 — Model Setup

User actions:

- Set Model Name
- Select Model Location
- Select Dataset

Step 2 — Training Configuration

User actions:

- Select Algorithm
- Select Target
- Configure Train/Test Split
- Start Training

Step 3 — Evaluation

User can view:

- Evaluation Metrics
- Actual vs Predict Chart
- Residual Chart

Step 4 — Save Model

User explicitly clicks:

Save Model

This is the final persistence boundary.

The UI flow should remain as close as possible to the existing implementation.

Do not redesign the four-step workflow unless explicitly requested.
⸻ 8. Model Persistence Boundary

The most important Model Creation business rule is:

Training and experimentation MUST NOT create the final persistent Model record.

The lifecycle is:

Model Setup
↓
Model Draft / Workspace
↓
Training
↓
Training Result
↓
Evaluation
↓
Background Fine-Tuning
↓
Final Model Artifact
↓
Ready to Save
↓
User clicks Save Model
↓
Final Database Commit
↓
Persistent Model

The system should conceptually separate:

Model Draft
Training Run
Evaluation Result
Fine-Tuning Job
Model Artifact
Persistent Model

Do not automatically use the final persistent Model entity as temporary training state.

The exact implementation must follow the existing architecture and should use the smallest safe solution.
⸻ 9. Training Rules

Training MUST:

- Run without creating the final persistent Model record.
- Operate on a temporary Model Draft, Training Run, or equivalent state.
- Produce training results.
- Produce or reference a model artifact.
- Allow the Evaluation step to consume the training result.

Training MUST NOT:

- Create the final persistent Model record.
- Commit the final model to the database.
- Require a final persistent Model ID unless explicitly justified by the architecture.

Expected lifecycle:

Training Request
↓
Training Run
↓
Training Result
↓
Model Artifact
↓
Evaluation

⸻ 10. Evaluation Rules

Evaluation MUST:

- Operate on the current Model Draft / Training Run.
- Use the trained model artifact.
- Produce evaluation metrics and visualization data.
- Support the existing Evaluation UI.

Evaluation MUST NOT:

- Create the final persistent Model record.
- Commit the final Model to the database.
  ⸻

1. Fine-Tuning Rules

Fine-Tuning MUST:

- Run as a background process.
- Not block the HTTP request lifecycle.
- Operate independently from the final Model persistence lifecycle.
- Expose job status and progress when required by the UI.
- Produce a final or improved Model Artifact.
- Preserve the user's ability to explicitly Save the Model later.

Fine-Tuning MUST NOT:

- Create the final persistent Model record.
- Commit the final Model to the database.
- Treat background job completion as an automatic Save Model operation.

If an existing queue or background-job infrastructure exists:

Reuse it.

If no suitable infrastructure exists:

Inspect the architecture first.

Do not introduce BullMQ, Redis, Celery, or another queue system without evaluating the existing architecture and requirements.
⸻ 12. Model Configuration and Artifact Storage

Model configuration and model artifacts should be separated from the final Model database commit.

Conceptually:

Training Configuration
↓
Model Draft / Training Run
↓
Model Artifact
↓
Fine-Tuning
↓
Final Artifact
↓
Save Model
↓
Persistent Model

Configuration should be stored in a location appropriate to its lifecycle.

Possible locations include:

- Model Draft state
- Training Run metadata
- Artifact metadata
- Temporary storage
- Object/file storage
- Database records designed specifically for draft/job state

Do not store temporary training state directly as the final persistent Model unless explicitly required.

Before deciding where configuration belongs:

1. Inspect existing storage architecture.
2. Inspect existing model-related Prisma models.
3. Inspect current artifact storage.
4. Inspect existing API contracts.
5. Choose the smallest solution consistent with the architecture.
   ⸻
6. Save Model Rules

Save Model is the ONLY operation allowed to create the final persistent Model record.

Save Model MUST:

1. Validate the Model Draft / Training Run.
2. Validate required Model Configuration.
3. Validate the final Model Artifact.
4. Validate Evaluation state when required.
5. Persist the final Model.
6. Persist required configuration.
7. Persist artifact references.
8. Use an atomic transaction where multiple database writes must succeed together.

If Save Model fails:

- Do not leave a partially created final Model record.
- Do not silently create a duplicate Model.
- Do not mark the Model as successfully saved.

The invariant MUST always remain:

Training
→ NO final Model DB commit

Evaluation
→ NO final Model DB commit

Fine-Tuning
→ Background Process
→ NO final Model DB commit

Save Model
→ ONLY final Model DB commit

⸻ 14. Model Creation Refactor Workflow

When modifying the Model Creation Flow, follow this order:

1. Audit Existing Flow
   ↓
2. Identify Current DB Commit Points
   ↓
3. Identify Model Artifact Storage
   ↓
4. Identify Model Configuration Storage
   ↓
5. Separate Training from Final Persistence
   ↓
6. Introduce Draft / Training Run Lifecycle
   ↓
7. Refactor Training
   ↓
8. Refactor Evaluation
   ↓
9. Add Background Fine-Tuning
   ↓
10. Define Artifact + Config Persistence
    ↓
11. Move Final Commit to Save Model
    ↓
12. End-to-End Verification

Do not redesign the user-facing four-step flow unless explicitly requested.
⸻ 15. Feature-driven Development

When a feature_list.json exists for a feature or refactor:

1. Read feature_list.json before implementation.
2. Identify the first incomplete feature whose dependencies are completed.
3. Set the feature status to in_progress.
4. Inspect relevant code before editing.
5. Implement only the selected feature.
6. Run relevant tests.
7. Verify acceptance criteria.
8. Verify verification items.
9. Update task statuses.
10. Update progress.
11. Mark the feature completed only when implementation and verification are complete.
12. Stop after completing the current feature.

Do not automatically implement unrelated features.
⸻ 16. Feature Status

Valid feature statuses:

pending
in_progress
blocked
completed

Valid task statuses:

pending
in_progress
blocked
completed

Progress must represent actual implementation progress.

Never mark a feature as completed if:

- Code is incomplete.
- Tests are failing.
- Acceptance criteria are not satisfied.
- Verification has not been performed.
- Known blocking issues remain.
  ⸻

1. Blocked Feature Handling

If a feature is blocked by:

- Missing information
- Unknown architecture
- Missing infrastructure
- Database migration issues
- Existing unrelated bugs
- Unclear API contracts

Do not guess.

Set:

{
"status": "blocked"
}

Document:

- What is blocking the work.
- What was investigated.
- What information is required.
- What decision is needed to continue.
  ⸻

1. Initial Inspection Mode

Before implementing a major Model Creation Flow refactor:

DO NOT modify code during the initial inspection.

Inspect and report:

1. Current architecture.
2. Current Model Creation Flow.
3. Current Training Flow.
4. Current Database Commit Points.
5. Current Model Artifact Storage.
6. Current Model Configuration Storage.
7. Current Background Job / Queue Architecture.
8. Current API contracts.
9. Current frontend state management.
10. Proposed minimal architecture changes.
11. Feature dependency execution plan.

The inspection MUST identify exactly where the final persistent Model is currently created or updated.

After the inspection, implementation may proceed feature-by-feature according to feature_list.json.
⸻ 19. Working with feature_list.json

feature_list.json is the source of truth for implementation progress for the related feature or refactor.

It should contain:

- Project name
- Version
- Feature identifiers
- Feature descriptions
- Dependencies
- Tasks
- Acceptance criteria
- Verification items
- Status
- Progress

Example:

{
"project": "Model Creation Flow Refactor",
"version": "1.0.0"
}

Rules:

- CLAUDE.md defines how Claude must work.
- feature_list.json defines what needs to be implemented and current progress.
- Rule Books define architecture, codebase, product, and design constraints.

Do not duplicate the entire feature list inside CLAUDE.md.
⸻ 20. Commands

Development

pnpm dev

Build

pnpm build

Lint

pnpm lint

Type Check

pnpm check-types

Format

pnpm format

Test
