# DS-LAKE-005B-C Benchmark Report

Decision record for "Parquet-native query path and layout benchmark." This
file accumulates real measurements as each benchmarking task lands — it is
not an API and nothing depends on it being any particular shape.

Methodology: real `ObjectStore` against real MinIO (not synthetic/mocked),
one synthetic artifact generated and uploaded per tag width, one representative
read window measured per method, artifact deleted before the next width. Row
count held at 1,000 across all widths — this run is about **tag-width** cost,
not row-count scale (see DS-LAKE-007's own V03 for a 2,000,000-row measurement
at fixed width).

---

## T03 — 1,000 / 4,000 / 8,000 / 16,000 tags, columnCount stated

Run date: 2026-08-13. `columnCount` is **measured** (`len(df.columns)`), not
derived from `tags` — it counts the quality-status sibling column per tag
(`{tag}` + `{tag}__status`) plus the one `timestamp` column, i.e.
`columnCount = 2 × tags + 1`. **Quality siblings ARE counted** in every number
below; a result quoted only in `tags` would understate the true artifact
width by roughly half.

Read window measured: `offset=0, limit=200` via
`ObjectStore.get_frame_slice` (existing, pandas: full download → full decode
→ pandas slice) and `ObjectStore.get_frame_slice_duckdb` (DS-LAKE-005B-C-T01,
DuckDB `read_parquet` via a staged temp file).

|   tags | columnCount |  rows | artifact size | pandas read (s) | duckdb read (s) | duckdb / pandas |
| -----: | ----------: | ----: | ------------: | --------------: | --------------: | --------------: |
|  1,000 |       2,001 | 1,000 |       10.5 MB |          0.1139 |          0.2883 |    2.53× slower |
|  4,000 |       8,001 | 1,000 |       42.0 MB |          0.2447 |          1.5230 |    6.22× slower |
|  8,000 |      16,001 | 1,000 |       84.1 MB |          0.5029 |          4.7184 |    9.38× slower |
| 16,000 |      32,001 | 1,000 |      168.1 MB |          1.0826 |         17.6744 |   16.32× slower |

### Finding, stated plainly

**The DuckDB path, as implemented in T01, is slower than the existing pandas
path at every measured width — and the gap widens sharply with tag count**,
from ~2.5× slower at 1,000 tags to ~16× slower at 16,000 tags. This
contradicts the assumption T01's own doc comment made ("true row pushdown...
unlike `get_frame_slice`'s documented gap"). The assumption was reasonable
but unproven; this is exactly the kind of result the feature's own
description ("decide the physical layout from numbers rather than from
taste") exists to catch before it becomes a silent regression.

**Working hypothesis, not confirmed** (confirming it is new investigative
work, out of this task's scope): `get_frame_slice_duckdb` downloads the
object and stages it to a **fresh temp file on every call**
(`tempfile.NamedTemporaryFile` + `os.unlink` per invocation,
`intergrations/object_store.py`). At 16,000 tags that is a ~168 MB disk
write, on top of the same network download `get_frame_slice` also pays —
`get_frame_slice` never touches disk (BytesIO straight into pyarrow). With
only 1,000 rows, the whole artifact almost certainly sits in a single Parquet
row group, so DuckDB gets no row-group-skipping benefit to offset that extra
disk I/O and its own per-query planning overhead. The scenario where row
pushdown should actually win — many row groups, a narrow OFFSET/LIMIT window
against a MUCH larger total row count — was not what this run measured.

**Consequence for later tasks, recorded not acted on**: DS-LAKE-005B-C-T04
(writer settings — row-group sizing is exactly the lever that would let a
future run test the row-pushdown hypothesis properly) and any eventual
adoption decision (AC0) must reckon with this number as it stands today, not
with the docstring's original assumption. Nothing in T01/T02's own scope
changes as a result — the existing reader remains the correct live path
(AC4), which this benchmark is independent confirmation for, not just a
process requirement.

---

## T04 — footer decode cost + writer-setting sweep, widest case (16,000 tags)

Run date: 2026-08-13. Methodology: **local pyarrow only, no MinIO round
trip** — deliberately isolates file-FORMAT effects (statistics, row-group
count, codec) from network variance, which T03 already characterized and
does not vary with these settings. Same 16,000-tag / 1,000-row synthetic
frame as T03. `footer_decode` times `pq.ParquetFile(buf)` construction plus
one schema access, touching NO data page. `first_open` times a full read
(footer + every data page) as a stand-in for "ready to serve any query."
**Single run per variant** — the row-group effect below is large enough to
be a real signal on one run; the statistics-on/off and codec deltas are
small enough that they should be read as noisy, not re-run to chase
precision within this task's scope.

| variant                              | write_statistics | row groups |     size | footer decode (s) | first open (s) |
| ------------------------------------ | ---------------- | ---------: | -------: | ----------------: | -------------: |
| baseline (snappy, default row group) | on               |          1 | 168.1 MB |            0.0870 |         0.7174 |
| statistics off                       | off              |          1 | 165.7 MB |            0.1082 |         0.7345 |
| row_group_size=100                   | on               |         10 | 221.0 MB |            0.2167 |         1.2274 |
| row_group_size=100 + statistics off  | off              |         10 | 197.1 MB |            0.2221 |         1.2288 |
| codec=none                           | on               |          1 | 167.9 MB |            0.1483 |         0.7828 |
| codec=zstd                           | on               |          1 | 158.9 MB |            0.1197 |         0.7846 |

### Findings, stated plainly

**Row-group size is the dominant lever, and smaller is worse here, not
better.** Requesting `row_group_size=100` (10 row groups instead of the
default single group) made footer decode **2.5× slower**, first-open
**1.7× slower**, AND the file **32% larger**, all at once. More row groups
means more per-row-group statistics/metadata entries in the footer and
worse compression locality on this width of table — the footer cost this
task exists to isolate scales with row-group COUNT, not just column count.
This is a real, useful correction to T03's own stated hypothesis
("more row groups might let DuckDB's pushdown win") — it may still be true
for DuckDB's read path specifically, but the footer-cost side of that
trade is now known to move against it, not for it, at this width. Not
re-tested against `get_frame_slice_duckdb` this pass — that would be a
fifth benchmark (row-group count × engine), out of T04's own scope.

**Statistics on/off made no measurable difference to footer decode time**
at either row-group setting (0.087 vs 0.108 at 1 group; 0.217 vs 0.222 at
10 groups — the second pair is a wash, the first pair if anything went the
"wrong" way). It DID shrink the file modestly (1.4% at 1 group, 11% at 10
groups — statistics cost scales with row-group count too, consistent with
the row-group finding above). Turning statistics off is a real but small
storage lever here, not a footer-latency one — worth stating since the
opposite would have been the intuitive guess.

**Codec choice moved file size a little (zstd 5.5% smaller than the
snappy baseline on this poorly-compressible random-gaussian synthetic
data) but the timing deltas across codec_none/codec_zstd/baseline are all
within what a single run can distinguish from noise** — no claim made
about codec's real effect on latency from this run; a repeated-run sweep
would be needed to say more, and wasn't done here (scope discipline, not
an oversight).

**Consequence for T05 (partition strategy) and future writer defaults**:
this run argues AGAINST shrinking row groups as a way to improve read
latency on wide artifacts, at least at this tag width and row count — the
opposite of what might have seemed like the obvious lever. `put_frame`'s
current defaults (pyarrow's own: snappy, statistics on, one row group at
this scale) are not shown to be wrong by this data; no writer-setting
change is recommended off the back of this run.

---

## T05 — partition strategy, chosen from measurements

Run date: 2026-08-13. **Decision record only — no production code changed.**
`put_frame`/`get_frame`/`get_frame_slice*` still write and read one file per
artifact, exactly as before this task. This section records which strategy
the numbers favor, for a future implementation task to act on.

Methodology: same 16,000-tag/1,000-row widest case. Query pattern: read a
NARROW tag subset (50 of 16,000 tags, chosen from the middle of the range so
a real shard lookup is exercised, not shard 0 by coincidence) — the
practically relevant shape (viewing/analyzing a handful of tags at a time),
and the shape most likely to show a partition strategy's real benefit, unlike
T03/T04's full-width reads.

| candidate                                        | mechanism                            | read 50 tags (s) |       vs current |
| ------------------------------------------------ | ------------------------------------ | ---------------: | ---------------: |
| **A. current** (single wide file)                | column projection only               |           0.2241 |         baseline |
| **B. column-group sharded**                      | 16 shards × 1,000 tags, open 1 shard |           0.0123 | **18.2× faster** |
| **C. long/pivot** `(ts, tag_id, value, quality)` | filter + pivot on read               |           0.0196 |     11.4× faster |

C's write-time cost (not part of the read number above): 0.244s to build the
16,000,000-row long frame + 0.482s to write it — a one-time cost per
artifact, not paid per read.

### Decision: column-group sharding

**Chosen candidate: column-group sharding (B)**, at a shard width to be
tuned later (this run used 1,000 tags/shard as a first measurement, not a
tuned optimum) — not full one-file-per-tag (see below).

Rationale, from the numbers:

- **B is the fastest measured candidate** (18.2× over current) and beats C
  (long/pivot) too, without C's per-artifact write-time tax or its
  per-read pivot CPU cost.
- **B is a pure subset of the CURRENT format** — each shard is still a wide
  `{tag}`/`{tag}__status` file, just narrower. Every existing consumer
  (`frame_service`, `cleaning_service`, `feature_service`,
  `validation_service`, the whole preview/rows/metadata endpoint family)
  already assumes this exact wide shape; adopting B changes WHICH FILE(S)
  hold which tag-columns, not the frame contract itself. C's long/pivot
  shape would require every one of those consumers to either pivot on
  every read or be rewritten around a narrow-table contract — a much
  larger, riskier change for a smaller measured win.
- The mechanism is intuitive and matches T04's own finding: the current
  single file pays a ~32,001-column footer decode for every query
  regardless of how few columns are actually requested; a 1,000-tag shard
  only ever pays a ~2,001-column footer, and only ONE shard is opened when
  the requested tags happen to live in one shard (the common case for a
  "look at a few tags" query).

**One-file-per-tag was NOT measured directly this run** — reasoned from
T04's own result instead of paying to generate 16,000 individual files:
T04 already showed footer/metadata overhead scales badly with FILE/GROUP
COUNT (10 row groups cost 2.5× a single group's footer decode). Going from
1 file to 16 shards already captures the bulk of the narrow-query win (B's
number above); going from 16 shards to 16,000 individual files trades a
small further per-query saving (if any — B already isolates the target
tags to one small file) against per-file MinIO round-trip overhead
(network + auth per tiny object) multiplied by 16,000. The feature's own
guidance ("continue to avoid one-file-per-tag unless the numbers justify
it") is upheld by this reasoning — this run's numbers do not justify it,
sharding at a coarser width already gets the win.

**Date partitioning was NOT evaluated this run** — it is orthogonal to the
tag-subset question tested here (a time/row-scale lever, not a
column-width one) and would need its own dedicated benchmark varying row
count/date range, not tag count. Left as a genuinely open sub-question,
not silently assumed away — a future task should test it against a
representative ROW-scale query (e.g. "give me the last week of one tag out
of a multi-year artifact") before any conclusion is drawn either way.

**Shard width (1,000 tags) is a first measurement, not a tuned choice** —
this run does not claim 1,000 is optimal, only that sharding beats not
sharding at this one width. Tuning the width (trading shard count against
per-shard footer size) is future work, not blocking this decision.

---

## T06 — quality/status width strategy, 8,000 tags, realistically sparse

Run date: 2026-08-13. **Evaluation, not a commitment** — T06's own wording is
"evaluate," unlike T05's "choose." No production code changed.

Methodology: 8,000 tags × 1,000 rows, **~1% non-Good cells** (realistically
sparse — 0.75% Bad, 0.25% Questionable, a plausible real fault mix, not
uniform noise). Value storage (the `{tag}` float64 columns) is IDENTICAL
across all three candidates and deliberately excluded — this isolates the
STATUS/QUALITY portion only. Read cost: reconstruct full-window status for
the same 50-tag target subset T05 used.

| candidate                       | mechanism                                      |    size |        vs sibling | read 50 tags (s) |       vs sibling |
| ------------------------------- | ---------------------------------------------- | ------: | ----------------: | ---------------: | ---------------: |
| **1. sibling column** (current) | `{tag}__status` int8, one per row              | 5.24 MB |          baseline |           0.0639 |         baseline |
| **2. bitmask packed**           | 2 bits/cell, 4/byte, sidecar table (1 row/tag) | 0.37 MB | **14.2× smaller** |           0.0042 | **15.2× faster** |
| **3. sparse exception table**   | `(tag_id, row_index, status)`, Good implicit   | 0.20 MB | **26.8× smaller** |           0.0059 | **10.8× faster** |

(80,000 exception rows total for candidate 3, at the ~1% fault rate over
8,000 × 1,000 cells.)

### Findings, stated plainly

**Both alternatives dramatically beat the current sibling-column approach**
on realistically sparse data, in storage AND read cost, by an order of
magnitude or more. The mechanism: snappy's general-purpose, block-based
compression does not exploit a 99%-constant-value column nearly as well as
either explicit bit-packing or storing only the sparse exceptions — this is
the single largest effect measured anywhere in this benchmark report.

**Between the two alternatives, neither strictly dominates**: bitmask packed
is faster to read (no predicate filter, no per-exception reconstruction
loop) but larger to store than the sparse exception table; the exception
table is smaller (scales with actual fault COUNT, not tag×row product) but
its read path here uses an unoptimized row-by-row Python reconstruction
loop — a vectorized version would likely narrow or close that read-speed
gap, and wasn't built for this measurement (scope discipline: this is an
evaluation, not an implementation).

**Context on the whole-artifact picture**: at the CURRENT sibling-column
encoding, status is only ~6% of the 8,000-tag artifact's total size (5.24 MB
of ~84.1 MB, per T03's own number for this width) — value storage still
dominates total artifact size regardless of which status strategy is
chosen. The win here is concentrated in status-specific costs (validation
checks, "which cells are bad" queries), not overall artifact size or
value-read latency, which this change does not touch either way.

**Adoption is NOT a drop-in the way T05's sharding was** — this is the
important asymmetry to record. `intergrations/object_store.py`'s own module
docstring states status "travels alongside the values because the cleaning
operations depend on it": `assert_frame_shape`, `check_missing_values`,
`cleaning_service`'s Good/Bad branching, and `frame_service` are all built
around reading `{tag}__status` as a same-length sibling array. Adopting
EITHER alternative would mean rewriting that convention across every one of
those consumers, not just changing how one file is written — a materially
larger and riskier change than T05's, and a separate implementation
decision this evaluation does not make on its own.

**Leaning, not a commitment**: if forced to pick one to prototype first,
the sparse exception table's semantics already match how validation/
cleaning code treats status today (Good is the assumed default; the code
paths that matter branch on non-Good cells specifically) — but this is a
leaning based on semantic fit, not a benchmark-backed decision the way
T05's was, since the read-cost gap versus bitmask is confounded by an
unoptimized reconstruction loop as noted above. A real adoption decision
needs a prototype against actual consumer code, not this isolated
storage/read-cost measurement alone.

---

## T07

Run date: 2026-08-17. **Server-side slice only** (API latency, bytes read,
Python memory/CPU, backend memory) — browser-side (browser memory, first
render, scroll performance, filter latency) explicitly deferred, user
decision (cost-scoped, this session). Unlike T03-T06, this is STANDING LOG
INSTRUMENTATION added to production code, not a one-off script — every
number below comes from a real run of that code against real data, not a
synthetic emitter, but this is NOT yet "the full app under real user load"
that V05's own wording ultimately points at (that needs the browser-side
half too). V05 stays `pending` for that reason, not marked closed here.

**API latency + Python CPU + Python memory**: `routers/preprocess.py`'s
`_run` — the one choke point every handler in the router funnels through —
now logs `elapsed_ms` (wall time), `cpu_ms` (process CPU time consumed by
the request, via `resource.getrusage` before/after delta), and
`peak_rss_kb` (whole-process peak RSS) on every request, success or
failure (`finally` block). `ru_maxrss` is a documented POSIX quirk — KB on
Linux, BYTES on macOS — normalised to KB (`_peak_rss_kb()`) so dev and
prod logs are directly comparable.

**Bytes read**: `intergrations/object_store.py`'s `get_frame` — the real
read choke point `get_frame_slice` also funnels through — now logs
`bytes_read` (the actual MinIO GET payload size) and its own `elapsed_ms`,
separate from `_run`'s whole-request figure (this isolates the storage hop
from pandas/pyarrow decode time).

**Backend memory + backend-side API latency + bytes**: `apps/backend/src/lib/python-client.ts`'s
`fetchOk` — the one choke point every `postToPython`/`postBinaryToPython`/
`postMultipartToPython` call funnels through — now logs `elapsed_ms`,
`status`, `bytes` (response `content-length`), and `rss_mb`
(`process.memoryUsage().rss`) for every response, plus a shorter line on
a network failure/timeout (no `res` available yet at that point).

**Live-verified against real data**, not just unit-tested: direct
invocation of `get_frame`/`_run` against the real MinIO object this
session's own live formula-job check used
(`drafts/4283b2c3-.../artifacts/2ea15930-.../data.parquet`) produced real
log lines: `object_store_read key=... bytes_read=45101 elapsed_ms=19.7`
and `preprocess_request handler=... elapsed_ms=0.1 cpu_ms=0.1
peak_rss_kb=188960` — `peak_rss_kb` in the expected KB range confirms the
macOS/Linux normalisation branch actually fired, not just compiled. The
backend-side (`fetchOk`) instrumentation is TypeScript-clean and covered
by the full Jest suite's zero-regression run, but was not independently
fired against a live request this pass (would need a backend rebuild +
restart, already asked of the user once this session).

Verified: full python suite 608 passed / 66 skipped / 1 pre-existing
unrelated failure (unchanged). Backend `tsc --noEmit` clean on every file
touched. Jest 201 passed / 11 pre-existing failing suites (unchanged).

**Not done, named not silently absorbed**: browser memory, first render,
scroll performance, filter latency — all genuinely unbuilt, need new
client-side instrumentation (`performance.memory`/`PerformanceObserver`)
plus an actual live browser session under load to populate them, matching
the same "no URL deep-link into an existing draft" complication found
during DS-LAKE-005B-D's own click-through attempt this session. A
dashboard was considered and rejected — no APM/metrics infra exists
anywhere in this repo (checked directly: no Prometheus/OpenTelemetry/
Sentry/pino), and standing up one would be new-framework territory this
task's own "log fields... not a synthetic emitter" wording does not
require.
