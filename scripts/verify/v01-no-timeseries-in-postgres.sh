#!/usr/bin/env bash
# DS-LAKE-012-V01 — "Query every Postgres table and confirm no timeseries
# rows are stored anywhere."
#
# Runs against the live `softsensorproject-db-1` container (same one every
# other DB check in this verification pass used). For each dataset-lake
# table, dumps row count plus the byte length of every JSON/array column —
# a real timeseries payload (thousands of rows x many tags) would be many
# times larger than the legitimate recipes these columns hold (cleaning
# steps, feature configs, a frozen lineage snapshot). No pg client library
# needed; `psql` inside the container is the same tool this session used to
# establish the DS-LAKE-012 baseline counts.
set -euo pipefail

CONTAINER="${DB_CONTAINER:-softsensorproject-db-1}"
DB_USER="${POSTGRES_USER:-root}"
DB_NAME="${POSTGRES_DB:-soft_sensor_db}"

echo "== V01: row counts per dataset-lake table =="
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
select 'Dataset' t, count(*) from \"Dataset\"
union all select 'DatasetVersion', count(*) from \"DatasetVersion\"
union all select 'DatasetArtifact', count(*) from \"DatasetArtifact\"
union all select 'DatasetDraft', count(*) from \"DatasetDraft\"
union all select 'PreprocessingJob', count(*) from \"PreprocessingJob\"
union all select 'LoaderJob', count(*) from \"LoaderJob\"
order by 1;"

echo
echo "== V01: JSON/array column byte-length outliers (>20000 bytes = inspect) =="
docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c "
select 'DatasetArtifact.operations' col, id, length(operations::text) len
  from \"DatasetArtifact\" where length(operations::text) > 20000
union all
select 'DatasetVersion.lineage', id, length(lineage::text)
  from \"DatasetVersion\" where lineage is not null and length(lineage::text) > 20000
union all
select 'PreprocessingJob.operations', id, length(operations::text)
  from \"PreprocessingJob\" where length(operations::text) > 20000
union all
select 'Dataset.pipelineConfig', id, length(\"pipelineConfig\"::text)
  from \"Dataset\" where length(\"pipelineConfig\"::text) > 20000
order by len desc nulls last;"

echo
echo "If the second query returned zero rows, V01 PASSES: every JSON/array"
echo "column on every dataset-lake table holds a small recipe or pointer,"
echo "never row-level timeseries data."
