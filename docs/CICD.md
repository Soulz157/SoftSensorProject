# DS-LAKE CI/CD — structure and operating guide

## 1. File layout

```
.github/
├── actions/
│   ├── setup-node/action.yml        # composite: pnpm → Node → cache → frozen install
│   └── setup-python/action.yml      # composite: Python → uv → cache → sync
├── workflows/
│   ├── ci.yml                       # PR / merge-queue gates. Never deploys.
│   ├── release.yml                  # main-branch orchestrator: ci → build → dev → staging → prod
│   ├── _build-image.yml             # reusable: build + push + scan + sign ONE image
│   ├── _deploy.yml                  # reusable: migrate → deploy → smoke → rollback
│   └── security.yml                 # nightly CodeQL / Trivy / dependency audit
├── paths-filter.yml                 # shared change-detection filters
└── dependabot.yml
docs/CICD.md                         # this file
scripts/deploy/
├── current-digests.sh               # capture live digests (rollback target)
├── apply.sh                         # rolling / canary / blue-green rollout
└── rollback.sh                      # restore previous digests
contracts/
├── api.json                         # committed OpenAPI snapshot (NestJS)
└── connector.json                   # committed OpenAPI snapshot (FastAPI)
```

**Naming convention:** workflows prefixed `_` are reusable-only (`workflow_call`)
and are never triggered directly. This makes the entry points obvious: `ci.yml`,
`release.yml`, `security.yml`.

## 2. Why this shape

| Decision | Reason |
| --- | --- |
| Composite actions for setup | Setup logic appears in 8 jobs. One copy, one place to fix the pnpm-before-setup-node ordering trap. |
| `ci.yml` has `workflow_call` | `release.yml` reuses the *exact same* gates instead of a divergent copy. No "it passed on the PR but main is different". |
| Reusable `_build-image.yml` per image | Same hardening (scan, SBOM, provenance, signature) for all three services, parameterised only by Dockerfile. |
| Reusable `_deploy.yml` per environment | dev/staging/prod differ only by inputs, so staging genuinely rehearses production. |
| `ci-gate` aggregation job | One required status check. Adding a new job never requires editing branch protection, and skipped jobs don't block merges. |
| Digests, not tags, flow into deploy | *Build once, deploy many.* Production runs the bytes that were tested. |

## 3. Job graph

```
ci.yml (PR / merge_group / called)
  changes ──┬─ lint-node ────────────┐
            ├─ typecheck-node ───┬───┤
            ├─ lint-python ──────┼───┤
            ├─ test-node ────────┼───┼──> ci-gate  (required check)
            ├─ test-python ──────┼───┤
            ├─ contract ─────────┼───┤
            └─ build ◄───────────┘   │
  guards ────────────────────────────┘

release.yml (push main)
  ci ──> image-api ─────┐
     ──> image-client ──┼──> dev ──> staging ──> production ──> record
     ──> image-connector┘        (each: migrate → deploy → smoke → rollback?)
```

## 4. Required GitHub configuration

These files are only half the system. The other half lives in repo settings.

### Branch protection — `main` and `develop`

- Require a pull request, 1+ approval, dismiss stale approvals
- Required status check: **`ci-gate`** only
- Require branches to be up to date / enable the merge queue
- Require signed commits
- Restrict force pushes and deletions

### Environments (Settings → Environments)

| Environment | Reviewers | Wait timer | Branch rule |
| --- | --- | --- | --- |
| `development` | none | 0 | `main` |
| `staging` | none | 0 | `main` |
| `production` | 1–2 required | 10 min | `main` only |

### Variables vs. secrets

| Name | Type | Note |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **variable** | Inlined into the client bundle — not a secret |
| `DATADOG_EVENT_URL` | variable | |
| `DATABASE_URL` | **environment secret** | Per environment. *Never* used by the CI test job. |
| `AZURE_CLIENT_ID` / `TENANT_ID` / `SUBSCRIPTION_ID` | environment secret | OIDC federation, no client secret |
| `GITLEAKS_LICENSE` | repo secret | Required for org repos |

### Actions settings

- Allow only actions from selected orgs; require SHA-pinned third-party actions
- `GITHUB_TOKEN` default permissions: **read-only**
- Enable Dependabot alerts, security updates, and secret scanning with push protection

## 5. Database migrations — expand/contract

The pipeline rolls application code back automatically; it does **not** roll
migrations back. So every migration must be safe for the previous app version.

```
Release N   : add nullable column / new table          (expand)
Release N   : app writes BOTH old and new shape
Release N+1 : backfill job
Release N+2 : app reads new shape only
Release N+3 : drop old column                          (contract)
```

Rules:

- Forward-only, idempotent, one logical change per file
- No `DROP` / `NOT NULL` / rename in the same release as the code change
- TimescaleDB: check continuous-aggregate refresh policies before altering a
  hypertable — an in-flight refresh can hold locks long enough to fail the job
- Test migrations in CI against a schema dump of production, not an empty DB

## 6. Contract testing — the field-name gate

The recurring silent-failure class in this codebase is snake_case/camelCase
drift between NestJS DTOs, the FastAPI connector, and the Next.js client. The
`contract` job turns that into a build failure:

1. Generate OpenAPI from both backends
2. `diff` against the committed snapshots in `contracts/`
3. Regenerate the typed client and fail if `git diff` is non-empty

When a change is intentional: `pnpm contracts:update && pnpm contracts:codegen`,
then commit. The diff in the PR becomes the review artefact for every API change.

## 7. Migration path from the current workflow

**Phase 1 — half a day, no new infra**

1. `pnpm install --frozen-lockfile`
2. Wire or delete the unused `detect-changes` output
3. `timeout-minutes` on every job
4. `NEXT_PUBLIC_API_URL` → `vars`
5. Workflow-level `permissions: contents: read`
6. `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`

**Phase 2 — close the real gaps**
7. Service containers replace `secrets.DATABASE_URL` in tests
8. Add the Python job (ruff / mypy / pytest)
9. Re-enable ESLint, `continue-on-error` at first
10. Split into parallel jobs + `ci-gate`

**Phase 3 — hardening**
11. `_build-image.yml`: Docker build, digest tags, GHA cache
12. Trivy, gitleaks, SBOM, SHA pinning, Dependabot
13. Branch protection with `ci-gate` as the required check
14. `contract` job

**Phase 4 — CD**
15. Environments, OIDC, `_deploy.yml`, smoke test, rollback scripts

## 8. Before first run — checklist

- [ ] Adjust `PYTHON_DIR` in `ci.yml` to the actual connector path
- [ ] Confirm the package filter names (`@dslake/api`) match `package.json`
- [ ] Add the referenced npm scripts: `test:unit`, `test:integration`,
      `migrate:deploy`, `openapi:generate`, `contracts:codegen`, `contracts:update`
- [ ] Commit `.env.ci` with non-secret CI defaults
- [ ] Create `scripts/deploy/{current-digests,apply,rollback}.sh`
- [ ] Replace `azure/login` with your actual cloud OIDC action
- [ ] Pin every `# TODO: pin to commit SHA` — e.g. `pinact run` or
      `frizbee actions .github/workflows`
- [ ] Validate locally: `actionlint` and `act -n` (dry run)

## 9. Health metrics to watch

| Metric | Target |
| --- | --- |
| PR feedback time (to `ci-gate`) | < 10 min |
| Flaky test rate | < 1% of runs |
| Rollback time | < 5 min, one command |
| Change failure rate | < 15% |
| Time from merge to production | < 1 day |

If `ci-gate` takes longer than 10 minutes, people start merging around it — at
which point the whole pipeline is decoration. Treat CI duration as a product
metric, not an implementation detail.
