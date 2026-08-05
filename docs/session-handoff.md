# Session Handoff

## Project

Dataset Lake Refactor

Current Sprint: Draft-first Dataset Architecture

Last Updated: 2026-08-05

---

# Current Goal

Implement a Draft-based Dataset Pipeline where no Dataset,
DatasetVersion or Model is committed until the user explicitly
clicks Save Dataset.

Dataset Creation should operate entirely on DatasetDraft.

---

# Current Architecture

Wizard

Step 1
Upload / Select Source

↓

Step 2
Fetch Raw Data
→ Save BRONZE Artifact (MinIO)
→ DatasetDraft only

↓

Step 3
Cleaning
→ Save SILVER Artifact
→ DatasetDraft only

↓

Step 4
Feature Engineering
→ Save GOLD Artifact
→ DatasetDraft only

↓

Step 5
Validation

↓

Save Dataset

↓

Create Dataset
Create DatasetVersion
Promote FINAL Artifact
Commit Database

---

# Engineering Decisions

✓ Save Dataset is the only persistence boundary.

✓ DatasetVersion must never exist before Save.

✓ DatasetDraft is the aggregate root.

✓ Artifacts belong to either DatasetDraft or Dataset.

✓ Original files remain immutable.

✓ Feature Preset Runtime JSON is stored in MinIO.

✓ Metadata is stored in Database.

---

# Feature Status

| Feature | Status |
| --------- | -------- |
| DS-LAKE-001 | ✅ Complete |
| DS-LAKE-002 | ✅ Complete |
| DS-LAKE-003 | ✅ Complete |
| DS-LAKE-004 | ✅ Complete |
| DS-LAKE-005 | ✅ Complete |
| DS-LAKE-006 | 🚧 In Progress |
| DS-LAKE-007 | ⏳ Pending |
| DS-LAKE-008 | ⏳ Pending |
| DS-LAKE-009 | ⏳ Pending |

---

# Important Constraints

- Never commit Dataset before Save.
- Never create DatasetVersion before Save.
- All processing writes Artifacts to MinIO.
- Database stores metadata only.
- Feature Preset Runtime JSON is loaded from MinIO.

---

# Remaining Work

1. Finish Draft API
2. Bronze Artifact pipeline
3. Silver pipeline
4. Feature Engineering pipeline
5. Validation
6. Final Save orchestration

---

# Known Decisions

Feature Preset

Upload Excel

↓

Original Excel → MinIO

↓

Parse

↓

Runtime preset.json

↓

MinIO

↓

Metadata

↓

Database

Dataset Wizard uses

- Features
- Equations
- Conditions
- Range

Model Wizard additionally reads

- Target (Y)

---

# Next Session

Primary Goal

Implement DS-LAKE-003

Expected Deliverables

- Draft Artifact API
- Bronze Artifact Writer
- MinIO Integration
- Progress Tracking

Do NOT

- Create DatasetVersion
- Save Dataset
- Commit Model

until Save Dataset is executed.
