From the existing Data Source system, I want to extend the implementation so that users can enter their User and Password credentials and use them to authenticate API requests for retrieving real data from the actual Data Source / Database.

The existing PI Web API integration has already been implemented. Reuse the existing PI Web API implementation instead of creating a duplicate integration.

For SQL and RESTful API Data Sources, please implement the required backend API endpoints and supporting services so that the system can retrieve real data.

IMPORTANT:
Start in INSPECTION MODE first.
Do NOT modify any files or write code until you have inspected the existing architecture and provided an implementation plan.

---

# 1. Initial Inspection

Before making any code changes, read:

- CLAUDE.md
- docs/ARCHITECTURE.md
- docs/CODEBASE.md
- docs/DESIGN_SYSTEM.md
- PRODUCT.md
- DESIGN.md

Then inspect the existing implementation:

- apps/client
- apps/backend
- apps/python
- Existing PI Web API integration
- Existing Data Source flow
- Existing authentication flow
- Existing User / Password handling
- Existing Data Source configuration
- Existing Prisma schema
- Existing Dataset flow
- Existing Model Creation Flow

Specifically identify:

1. Current Data Source architecture.
2. Current PI Web API implementation.
3. Existing API endpoints related to Data Source.
4. Where PI credentials are currently handled.
5. How User and Password are currently passed to the backend.
6. How credentials are stored or managed.
7. How Data Source metadata is retrieved.
8. How data is fetched.
9. How the fetched data becomes a Dataset.
10. How the Dataset is consumed by the Model Creation Flow.

Do not assume the architecture.
Verify it from the actual codebase.

---

# 2. PI Web API

The PI Web API integration already exists.

Reuse the existing implementation.

Do NOT create a duplicate PI Web API integration unless the current implementation cannot support the required use case.

The desired flow is:

User
↓
Enter Data Source Credentials
↓
Frontend sends request to Backend
↓
Backend authenticates with PI Web API
↓
Backend fetches real PI data
↓
Backend returns safe data / metadata to Client
↓
User selects data
↓
Dataset is created
↓
Dataset can be used in Model Creation Flow

User credentials must be handled securely.

Requirements:

- User and Password must be processed server-side.
- Do not expose credentials to the browser unnecessarily.
- Do not return Password in API responses.
- Do not log Passwords.
- Do not log Authorization headers.
- Do not log API tokens.
- Do not store plaintext passwords.
- Reuse the existing authentication mechanism if one already exists.

---

# 3. SQL Data Source

Add backend API support for connecting to real SQL Databases.

The SQL Data Source should support, where appropriate:

- Database Type / Driver
- Host
- Port
- Database Name
- Username
- Password

The backend should support operations such as:

- Test Database Connection
- Retrieve Database Metadata
- List Tables
- Retrieve Table Columns
- Query Data
- Filter Data
- Filter by Time Range
- Select Columns
- Pagination / Limit
- Return data in a format suitable for Dataset creation

Suggested API structure:

- POST /api/v1/authorized/data-sources/sql/test-connection
- POST /api/v1/authorized/data-sources/sql/tables
- POST /api/v1/authorized/data-sources/sql/columns
- POST /api/v1/authorized/data-sources/sql/query

These routes are only proposals.

Before implementing them:

- Inspect existing API conventions.
- Follow the existing route structure.
- Follow the project's versioning conventions.
- Reuse existing DTO and validation patterns.
- Use the appropriate authorization guards.

Security requirements:

- Do not use Mock Data.
- Connect to the real Database.
- Prevent SQL Injection.
- Do not execute arbitrary raw SQL received directly from the Client without proper validation and restrictions.
- Use parameterized queries or a safe query builder.
- Prefer read-only Database credentials if write access is not required.
- Apply least-privilege access.
- Do not expose database credentials to the Client.
- Do not expose database passwords in API responses.
- Do not log database passwords.
- Do not leak sensitive connection information through error responses.

---

# 4. RESTful API Data Source

Add backend API support for external RESTful APIs.

The REST Data Source should support, where appropriate:

- Base URL
- Endpoint
- HTTP Method
- Username / Password Authentication
- Bearer Token
- API Key
- Query Parameters
- Request Headers
- Pagination
- Response Mapping
- JSON Data Extraction

The backend should support operations such as:

- Test API Connection
- Fetch Data
- Validate Response
- Map JSON Response into a Dataset-compatible structure
- Handle External API Errors
- Timeout Handling
- Retry Handling where appropriate

Suggested API structure:

- POST /api/v1/authorized/data-sources/rest/test-connection
- POST /api/v1/authorized/data-sources/rest/fetch

These routes are only proposals.

Inspect the existing API conventions before implementing them.

Security requirements:

- Credentials must be handled server-side.
- Do not expose secrets to the Client.
- Do not log passwords.
- Do not log API keys.
- Do not log Bearer Tokens.
- Validate external URLs to prevent SSRF.
- Restrict HTTP methods where appropriate.
- Implement reasonable request timeouts.
- Handle external API failures safely.
- Do not expose sensitive upstream error details to the Client.

---

# 5. Data Source Architecture

The desired high-level architecture is:

Client
↓
NestJS Backend API
↓
Data Source Service / Adapter
↓
┌───────────────────┬───────────────────┬───────────────────┐
│ │ │
PI Web API SQL Database RESTful API
│ │ │
└───────────────────┴───────────────────┴───────────────────┘
↓
Dataset

The Client must NOT connect directly to:

- PI Web API
- SQL Database
- External RESTful APIs

All external Data Source access must go through the Backend or the appropriate server-side service.

---

# 6. Data Source Adapter Design

Inspect the existing architecture first.

If appropriate, introduce a common Data Source abstraction such as:

DataSourceAdapter

Potential interface:

- testConnection()
- getMetadata()
- fetchData()

Possible implementations:

- PIDataSourceAdapter
- SQLDataSourceAdapter
- RestDataSourceAdapter

However:

Do NOT force a new abstraction if the existing codebase already has a suitable architecture.

Prefer the smallest architecture change that is consistent with the existing project structure.

The goal is to avoid duplicating:

- Authentication logic
- Connection handling
- Error handling
- Data normalization
- Dataset transformation

---

# 7. Frontend Data Source Flow

Update the Data Source UI where necessary to support at least:

- PI Web API
- SQL Database
- RESTful API

Expected conceptual flow:

Select Data Source
↓
Configure Connection
↓
Enter Credentials
↓
Test Connection
↓
Connection Successful
↓
Browse / Select Data
↓
Preview Data
↓
Create / Use Dataset

The UI should provide appropriate states such as:

- Connecting
- Connected
- Connection Failed
- Fetching
- Fetch Successful
- Fetch Failed

Follow the existing Design System and Product Rule Books.

Do not redesign unrelated UI.

---

# 8. Backend Layering

Follow the existing project architecture.

Preferred structure:

Controller
↓
DTO / Validation
↓
Service
↓
Data Source Adapter / Integration
↓
External Data Source

Controllers should remain thin.

Business logic belongs in Services.

External Data Source communication should be isolated from Controllers.

Follow existing NestJS module and folder conventions.

---

# 9. Prisma / Database Changes

Before modifying Prisma:

1. Inspect the existing Prisma schema.
2. Identify existing Data Source models.
3. Identify existing Credential-related models.
4. Identify existing Dataset models.
5. Identify existing Model-related models.
6. Determine whether new models are actually necessary.

Do not create duplicate models.

If schema changes are required:

- Update schema.prisma.
- Create a Prisma migration.
- Regenerate Prisma Client.
- Never edit generated Prisma Client files directly.
- Do not skip migrations.

---

# 10. Credential Security

User Passwords and Data Source credentials are sensitive information.

NEVER:

- Return Passwords in API responses.
- Store Passwords as plaintext.
- Log Passwords.
- Log Authorization headers.
- Log API Keys.
- Log Bearer Tokens.
- Expose database credentials to the browser.
- Expose secrets using NEXT*PUBLIC* environment variables.

If credentials must be persisted:

- Use encryption at rest.
- Separate secrets from regular Data Source metadata.
- Restrict access to server-side services.
- Follow the existing security architecture.
- Prefer an appropriate secret-management mechanism where available.

Inspect the existing architecture before deciding where credentials should be stored.

---

# 11. No Mock Data

This task is specifically intended to connect the Data Source system to real external systems.

Do NOT:

- Create fake datasets.
- Create mock Data Source APIs.
- Hardcode datasets.
- Hardcode usernames.
- Hardcode passwords.
- Hardcode database credentials.
- Replace real integrations with mock implementations.

Use real Data Source integrations.

If an external dependency is unavailable during development, clearly report the limitation instead of silently replacing it with mock data.

---

# 12. Model Creation Flow

Do NOT redesign or modify the existing Model Creation Flow unless it is required to integrate the real Dataset.

The existing Model Creation Flow should remain:

Step 1
Model Setup

- Set Model Name
- Select Model Location
- Select Dataset

Step 2
Training Configuration

- Select Algorithm
- Select Target
- Configure Train/Test Split
- Training

Step 3
Evaluation

- Evaluation Metrics
- Actual vs Predict Chart
- Residual Chart

Step 4
Save Model

The Data Source implementation should provide real Datasets that can be selected and consumed by the existing Model Creation Flow.

Data Source and Model Creation are separate concerns.

Do not couple Data Source retrieval directly to Final Model persistence.

The flow should conceptually be:

Data Source
↓
Fetch Real Data
↓
Dataset
↓
Model Creation
↓
Training
↓
Evaluation
↓
Save Model

---

# 13. Implementation Workflow

Follow this process:

## Phase 1 — Inspection

Do not modify code.

Inspect:

1. Current Data Source Flow
2. Current PI Web API implementation
3. Current Authentication Flow
4. Current Data Source Models
5. Current Prisma Schema
6. Current Backend APIs
7. Current Python APIs
8. Current Frontend Data Source UI
9. Current Dataset Flow
10. Current Credential Handling

## Phase 2 — Architecture Proposal

Provide a concise report containing:

- Current Architecture
- Existing PI Web API implementation
- Existing APIs that can be reused
- Components that need modification
- New components required
- SQL API proposal
- REST API proposal
- Credential handling strategy
- Database changes
- Security considerations
- Dataset integration strategy
- Implementation Plan

## Phase 3 — Implementation

After the inspection and architecture proposal:

- Implement the required backend APIs.
- Reuse the existing PI Web API implementation.
- Add SQL Data Source support.
- Add RESTful API Data Source support.
- Update frontend Data Source flow where required.
- Connect the resulting Dataset to the existing Model Creation Flow.
- Do not modify unrelated features.

---

# 14. API Contract Expectations

Before implementing new APIs, define the request and response contracts.

For each endpoint document:

- HTTP Method
- Route
- Authentication
- Request DTO
- Response DTO
- Validation Rules
- Error Cases
- Security Considerations

Ensure the API contract follows the existing project's conventions.

---

# 15. Validation

After implementation, verify:

## PI Web API

- Real credentials can authenticate successfully.
- Real PI data can be retrieved.
- Existing PI integration is reused.
- Credentials are not leaked.

## SQL

- Real SQL Database connection works.
- Connection errors are handled correctly.
- SQL Injection is prevented.
- Query limits are enforced.
- Time-range filtering works where applicable.
- Data can be converted into a Dataset.

## RESTful API

- Real REST API connection works.
- Authentication works.
- Query parameters work.
- Headers are handled securely.
- JSON responses can be mapped into Dataset-compatible data.
- Timeout handling works.
- External API failures are handled correctly.

## Security

- Passwords are not returned in API responses.
- Passwords are not logged.
- API Keys are not logged.
- Bearer Tokens are not logged.
- Database credentials are not exposed to the Client.
- No secrets use NEXT*PUBLIC* environment variables.
- SSRF risks are considered for RESTful API URLs.
- SQL Injection risks are addressed.

## Dataset Integration

Verify:

Data Source
↓
Real Data
↓
Dataset
↓
Model Creation Step 1
↓
Training Step 2
↓
Evaluation Step 3
↓
Save Model Step 4

The Data Source integration must not automatically create or commit a final Model.

---

# 16. Final Validation Commands

Run the appropriate tests for the changed scope.

Then run:

pnpm format

pnpm build

If tests exist for the affected modules, run them as well.

Do not report the task as complete if required validation fails.

---

# 17. Final Report

After implementation, report:

Summary

- What was changed.

Existing PI Integration

- What was reused.
- What was modified.

SQL Data Source

- New APIs.
- New services.
- Database changes.

RESTful Data Source

- New APIs.
- New services.
- Authentication handling.

Frontend

- Data Source UI changes.

Dataset Integration

- How real Data Source data reaches Model Creation.

Security

- Credential handling.
- SQL Injection prevention.
- SSRF protection.
- Secret handling.

Files Changed

- Important files.

Database Impact

- Schema and migrations.

API Impact

- New or changed API contracts.

Validation

- Tests run.
- pnpm format result.
- pnpm build result.

Known Issues

- Remaining limitations or external dependencies.
