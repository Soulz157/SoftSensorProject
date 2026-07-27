# Model Creation Flow — Persistence Audit (MODEL-FLOW-001)

Read-only audit of the current Model Creation Flow. Identifies every database commit point across
the four steps and pinpoints the persistence boundary that must move to Step 4 (Save Model).

Source of truth for the refactor: `docs/feature_list.json`.

## 1. The four-step user flow (to be preserved)

`apps/client/app/(default)/models/create/components/create-model-form.tsx`

Step labels: `['Select Dataset', 'Training Config', 'Evaluation', 'Save Model']`. Body renders by
`nav.currentStep`:

| Step | UI name         | Component                                              |
| ---- | --------------- | ------------------------------------------------------ |
| 1    | Select Dataset  | `phase-1-details.tsx` (`Phase1Details`)                |
| 2    | Training Config | `phase-2-training-config.tsx` (`Phase2TrainingConfig`) |
| 3    | Evaluation      | `phase-3-evaluation.tsx` (`Phase3Evaluation`)          |
| 4    | Save Model      | `phase-4-deploy.tsx` (`Phase4Deploy`)                  |

> Note: phase files are named `phase-1..4`, but some comments say "Phase-5 training" / "Phase-6
> Save". That is legacy numbering — the same four UI steps.

## 2. Database commit points (backend)

`apps/backend/src/api/v1/model/authorized/model.authorized.service.ts`

| Method               | Prisma op             | Line | Effect                                   |
| -------------------- | --------------------- | ---- | ---------------------------------------- |
| `createModelService` | `prisma.model.create` | 158  | **Only INSERT** of the final `Model` row |
| `updateModelService` | `prisma.model.update` | 245  | Updates existing `Model`                 |
| `appendLogService`   | `prisma.model.update` | 289  | Appends a deploy log entry               |
| `deleteModelService` | `prisma.model.delete` | 316  | Deletes a `Model`                        |

Schema: the only relevant entity is `Model` (`packages/prisma/prisma/schema.prisma:159`) —
`id, workspaceId, name, data Json?, nodesId, datasetId`. Wizard config is stored inside
`Model.data.config` (JSON round-trip, see `ModelData` type in the service). There are **no**
Draft / TrainingRun / FineTuningJob / Artifact entities, **no** queue/worker infrastructure, and
**no** python training/eval/fine-tune code (`apps/python` has none).

## 3. Persistence boundary VIOLATION — Model committed during Training (Step 2)

The final `Model` row is created when the user clicks **Start Training** (Step 2), not **Save
Model** (Step 4).

Trace:

1. Step 2 "Start Training" button → `training.start`
   (`phase-2-training-config.tsx:141`).
2. `useModelTraining.run()` → `await commit()` then a **mock** progress ramp
   (`hooks/model/use-model-training.ts:56`; ramp uses `STEP_MS` / `STEP_COUNT` — there is no backend
   training endpoint).
3. `useModelCommit` (`hooks/model/use-model-commit.ts`): in create mode with no `createdModelId` →
   `createModel(...)` (**:81**) = **DB INSERT**; the new id is stored in `mpCreatedModelIdAtom`.
4. Step 4 "Save Model" → `handleSave` → `commit()` again (`phase-4-deploy.tsx:42`). By now
   `createdModelId` is set, so `useModelCommit` takes the `updateModel(...)` path (**:92**) — **not**
   a create.

**Consequence:** the persistent `Model` exists after Step 2. Step 4 merely updates it. If the user
abandons the wizard after training, an orphaned persisted `Model` remains in the database.

This is the boundary that MODEL-FLOW-003 (training must not commit) and MODEL-FLOW-007 (Save Model is
the only commit) must fix.

## 4. Step 3 Evaluation — no database write (confirmed)

`phase-3-evaluation.tsx` computes all metrics and charts client-side: `computeFit` / `buildFitRows`
(`lib/model-metrics`) over `materializeDataset` / `toModelReady` (`lib/pipeline-config`,
`lib/preprocessing`). It reads jotai atoms plus `useAllModels()` (read-only, to populate the
"compare with…" dropdown). The compared model's series is deterministic mock (`seededNoise`).
**No persistence occurs in Step 3.**

## 5. Secondary create path (outside the wizard)

`hooks/model/use-model-form.ts:167` also calls `createModel` — this backs the quick upsert dialog
(`models/views/components/model-upsert-dialog.tsx`), independent of the four-step wizard. Recorded
here so the "all commit points" inventory is complete; it is not part of the wizard flow.

## 6. Summary — the boundary to move

| Step | Today                                  | Target (refactor)                   |
| ---- | -------------------------------------- | ----------------------------------- |
| 1    | No DB write                            | No DB write (Model Draft only)      |
| 2    | **`createModel` — final Model INSERT** | No DB write (train against Draft)   |
| 3    | No DB write (client compute)           | No DB write                         |
| 4    | `updateModel` (row already exists)     | **`createModel` — the only commit** |

Move the `createModel` commit from the Step-2 training path to the Step-4 Save Model action.
