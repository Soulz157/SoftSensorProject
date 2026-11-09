# Session 2026-10-19 — Feature engineering assist + Data Studio fixes

บันทึกงานของ session นี้ไว้กลับมาอ่าน รายละเอียดระดับ task อยู่ที่ `feature_list.preprocessing.json` → **DS-LAKE-040** (ถ้าขัดกัน ให้ยึด ledger)

- Commit หลัก: `e0e6013 feat(client): add auto generate feature engineering` (89 ไฟล์) — ครอบงานทั้งหมดในหน้านี้ ยกเว้นข้อ 0
- Commit ก่อนหน้า: `96719b3 feat(client): add compare dataset into Phase 2 Data Review` (ข้อ 0)
- หน้าอธิบายเหตุผลเชิง Data Science (artifact): https://claude.ai/artifact/4V3gu1GxZhr5HJ3KDLQ8tH (private — กด Share ก่อนส่งให้คนอื่น)

---

## สรุปสั้น

เริ่มจากคำถามว่าสูตร _"Feature engineering on an hourly grid: zeros treated as missing, short-gap imputation, physical clipping, lags, rolling mean/std, differences, pairwise differences, analyzer-loop aggregates and time-cycle features. Windows are capped at 24 hours."_ ใช้กับ Create Dataset แบบ auto ได้ไหม ผลคือทำได้ครบ แบ่งเป็น phase และระหว่างทางเจอ bug ที่กระทบข้อมูลที่ใช้เทรนจริงหลายตัว (fetch settings ไม่ถึง BRONZE, re-fetch กลายเป็นรายนาที, inference ดึงทุก 1 นาที, Correlation heatmap อ่าน BRONZE) แก้หมดแล้ว

| ข้อในสูตร                           | อยู่ที่ไหนในระบบ                                                     |
| ----------------------------------- | -------------------------------------------------------------------- |
| hourly grid                         | Step 2 · Interval (ค่าเริ่มต้น 1 ชม.) + Historical Fetch Settings    |
| zeros treated as missing            | Step 5 · คำแนะนำ "Treat zeros as missing"                            |
| short-gap imputation                | Step 5 · Interpolate → Max gap                                       |
| physical clipping                   | Step 1 ★ critical + Step 5 Preset Range (แนะนำ Clip/Exclude)         |
| lags, rolling mean/std, differences | Step 4 · Auto-generate                                               |
| pairwise differences                | Step 4 · Auto-generate (คู่ของ critical tag ≤ 10)                    |
| analyzer-loop aggregates            | Step 4 · Auto-generate (kind ใหม่ `group`)                           |
| time-cycle                          | Step 4 · Auto-generate + Extraction (sin/cos)                        |
| windows ≤ 24 h                      | Auto-generate แปลงชั่วโมงเป็นแถวตาม interval จริง, rolling ≤ 240 แถว |

---

## 0. Phase 2 Data Review: tabs + Compare Dataset (commit `96719b3`)

- Phase 2 (Model wizard) แยก **Training data / Validation data** เป็นแท็บ (Radix `forceMount` เพื่อไม่เสีย state ตอนสลับ)
- ปุ่ม **Compare Dataset** เปิด modal เทียบ Validation กับ Training หรือ **Raw (Bronze)**
- ฝั่ง Raw ตัดช่วง validation ออก เก็บทั้งก่อนและหลัง (validation อาจถูกตัดจากกลางข้อมูล) — เพิ่ม `exclude_start/exclude_end` ทุกชั้น python → backend → client (rows, histogram, boxplot, correlation)
- ขอบเขต holdout แปลงเป็นเวลา Bangkok ก่อนส่ง (`holdoutExcludeWindow`) กันเวลาเพี้ยน 7 ชม.
- ตรวจกับข้อมูลจริง: Bronze 5159 แถว = 4900 นอกช่วง + 259 ในช่วง

## 1. Phase 1.5 — Critical tag + คำแนะนำ Clip/Exclude

- Step 1 ตาราง tag มีปุ่ม ★ ข้างปุ่ม Target (`unified-tag-table.tsx`)
  - ติ๊กแล้ว tag ถูกเลือกเข้า dataset ด้วย, target เป็น critical ไม่ได้, rename ตามชื่อ, ลบแถวแล้วหายจากรายการ
- เก็บที่ `dwCriticalTagsAtom` → `pipelineConfig.criticalTags` → wizard snapshot (draft เก่าที่ไม่มี field นี้เปิดต่อได้)
- `lib/critical-tags.ts`: `suggestRangeAction` — critical → **Clip** (แถวยังอยู่), อื่น ๆ → **Exclude** (ค่าที่หลุดช่วงน่าจะผิด)
- Preset Range card: ป้าย "Suggested: …" + tooltip, ค่าเริ่มต้นตามคำแนะนำ (**เปลี่ยนจากเดิมที่ Clip ทุกแถว**), แถวที่เปิดแล้วไม่ถูกเขียนทับ

## 2. Phase 1 — Auto-generate features (Step 4)

- `lib/auto-features.ts` + `feature-engineering/auto-features-dialog.tsx`
- ใช้เฉพาะ kind ที่มีอยู่ (lag, rolling, delta, arith sub, datetime) → feature_spec / holdout replay / inference ไม่ต้องแก้
- กติกา:
  - ไม่ใช้ target เป็นแหล่ง (lag ของ Y ทำให้โมเดลต้องมีค่าแลบล่าสุดตอนใช้งาน)
  - ชั่วโมง → แถว ตาม interval ที่อ่านจากข้อมูลเอง (ค่ากลางของระยะห่าง timestamp) ถ้าอ่านไม่ได้ใช้ interval ตอน fetch
  - หน้าต่าง ≤ 24 ชม., rolling ≤ 240 แถว (วัดแล้ว rolling ฝั่ง python ~150 ns/ช่อง)
  - ไม่สร้างคอลัมน์ซ้ำ, id ขึ้นต้น `auto:` → ปุ่ม "Remove auto-generated (N)"
- Extraction panel แสดงทุก feature ที่ไม่ใช่ formula (ลบทีละตัวได้)
- Modal กว้าง `sm:max-w-3xl` (เดิมโดน `sm:max-w-sm` ของ shadcn ทับ)

## 3. Phase 2 — Cleaning

- **Interpolate max gap**: ช่องหายติดกันยาวเกิน N แถวไม่ถูกเติม (client `interpolateMaxGap` + python `_max_gap`, ใช้ `param` เดิม → สูตรเก่า replay เหมือนเดิม) parity fixture `interpolate_max_gap_*`
- **Zeros as missing**: `lib/zero-readings.ts` — tag ที่ค่า 0 ≥ 5% ของที่โหลดมาถูกแนะนำ, กดแล้วใส่ `exclude [0, 0]` เป็นขั้นแรก
- กล่องแนะนำ (`zero-readings-notice.tsx`) ย่อเหลือ 3 บรรทัด: เรียงจากเป็น 0 มากสุด, โชว์ 3 tag, ที่เหลือ "+N more"

## 4. Phase 3 — kind ใหม่

- **Cyclic time**: `DatetimePart` เพิ่ม `hourSin/hourCos/dayOfWeekSin/dayOfWeekCos` (ไม่ใช่ kind ใหม่)
- **`group` kind** (loop aggregates): `{name, tags, agg}`; agg = mean, min, max, spread, std
  - **Bad ถ้าสมาชิกตัวใดหาย** (ตัดสินใจโดย user)
  - `name` = ชื่อคอลัมน์เต็ม (เช่น `AI602__grp_mean`) เพราะ server ใช้ `name` เป็นชื่อคอลัมน์ใน feature_spec / replay / lookback
  - แก้ครบ: client, python `feature_service` + schema, backend Zod + `feature-sources`, `softsensor_scaling`
- `findLoopGroups`: จับกลุ่มจากชื่อ ISA — ตัวอักษร+เลข loop ตรงกัน, ท้ายต่างกันได้, attribute เดียวกัน (AI602A/B → AI602, FIC114A–D → FIC114; ไม่รวม TI202/TI203, FIC107/FY107, PV กับ SP)
- parity fixture `feature_datetime_cyclic`, `feature_group_aggregates`

## 5. Interval / Fetch settings (bug ข้อมูลจริง)

- ค่าเริ่มต้นดึงข้อมูล **1 ชม.** (`DEFAULT_FETCH_PERIOD`)
- **Bug A**: Historical Fetch Settings (Cal basis, Summary type, Batch size) ไม่ถึง BRONZE → เทรนด้วยค่า default ของ python แม้หน้าจอเลือก Maximum. แก้: `piSummaryParams` ส่งไปทุก raw fetch, backend `CreateRawVersionSchema` + `buildSourceBlock`
- **Bug B**: re-fetch dataset ที่บันทึกแล้ว (3 จุด: Re-fetch rows, Edit hydrate, Step 6 storeRows) ไม่ส่ง interval → python ใช้ `"1m"`. แก้: บันทึก `pipelineConfig.fetchConfig` + ส่งครบทุกจุด
- **Bug C**: inference schedule ใช้ `sourceFetchConfigs[id].intervalTime/calcBasis/calcType` ซึ่งค้างเป็น `1m / TimeWeighted / Average` เกือบทุก dataset. แก้: Step 6 เขียนค่าจริงลงไป (`withPiFetchSettings`)
- UI: Source Configuration (PI) เป็นข้อมูล connection แบบอ่านอย่างเดียว + ปุ่ม Edit, ลบ `pi-config-form.tsx`; "Fetch Period" → **Interval**; Summary Type เลือกได้ค่าเดียว (python ใช้แค่ตัวแรก); Summary Duration ย้ายไป Advanced

## 6. Bug / UI อื่น ๆ

- **Correlation Heatmap ใน Step 4 ไม่เห็น feature ใหม่**: การ์ดอ่าน `gold ?? draft` แต่ create-mode เขียนผล feature ลง `dwDraftFeatureArtifactIdAtom` → อ่าน BRONZE. แก้: prop `readFeatureArtifact` (เปิดเฉพาะ Step 4)
- **Line chart tooltip 100 tag ล้นจอ**: `chart/trend-tooltip.tsx` — ไม่เกิน 16 แถว, 2 คอลัมน์, tag ที่ focus ขึ้นก่อน, "+N more"
- **Popover list ยาวไม่ scroll** (`ScrollArea` + `max-h` อย่างเดียว scroll ไม่ได้): แก้ CleaningTagSelect, Compare Tags, Compare Months, Focus model select
- **Pairwise label ตกไปใต้ checkbox**: label ใน row ที่ `flex-wrap` ต้องมี `min-w-0 flex-1`
- **แกน X Line chart**: แสดง `9 Jan` เมื่อข้อมูลยาว > 36 ชม. (`spansMultipleDays`) เดิมเลือกรูปแบบจาก interval จึงเห็นแค่ชื่อวัน
- **"Applying strategies to N tags"**: > 12 tag พับเป็นบรรทัดเดียว + View tags
- **Validation advisory กับ tag เยอะ**: python detail เหลือแค่จำนวน (รายชื่ออยู่ใน `offenders`), การ์ด clamp 2 บรรทัด, banner โชว์ 8 tag + "+N more", `measured/threshold` แปลงตามหน่วยของแต่ละ check (`lib/validation-format.ts`)

---

## การตัดสินใจที่ควรจำ

- Critical tag เลือกที่ Step 1; ค่าเริ่มต้น Preset Range ตามคำแนะนำ (critical = Clip, อื่น = Exclude)
- Loop grouping อัตโนมัติจากชื่อ; group เป็น Bad ถ้าสมาชิกหาย; aggregates = mean, spread, min, max, std
- Zeros-as-missing และ auto features เป็น "คำแนะนำ/ปุ่ม" ไม่ทำเองเงียบ ๆ
- ไม่แก้ `components/ui/**` (shadcn) — ใช้ prop/wrapper แทน

## การตรวจสอบ (ตอนจบ session)

- Client: `tsc` สะอาด, full suite 25 failed ใน 9 ไฟล์ baseline เดิม / 3324 passed
- Backend: `tsc` สะอาด, spec ที่เกี่ยวข้องผ่าน
- Python: full suite 1132 passed / 100 skipped; serving 47 passed
- Parity fixture ใหม่ 4 ไฟล์ ผ่าน `test_matches_client_output`
- เทสที่ไม่เสถียรตอนเครื่องหนัก (ไม่เกี่ยวกับงานนี้): `raw-readings-table`, `retrain-validation-window` (timeout 5 วิ)

## ยังค้าง

- [ ] ลองใน wizard จริง (DS-LAKE-040-T05): ★ critical, Auto-generate กับข้อมูลรายชั่วโมงและรายนาที, loop บน Dataset-s611water (AI602A/B) และ dataset 6 เดือน (FIC114A–D), zeros-as-missing, max gap, Save แล้ว Re-fetch ต้องยังเป็นรายชั่วโมง
- [ ] **รีสตาร์ท python (:8000)** — ต้องใช้สำหรับ kind `group` และข้อความ validation แบบใหม่
- [ ] dataset / inference schedule ที่มีอยู่แล้วยังเก็บ `intervalTime = '1m'` — เลือก (ก) ให้ backend อ่าน `pipelineConfig.fetchConfig` / `timeRange` ก่อน หรือ (ข) script แก้ข้อมูลใน DB ครั้งเดียว
- [ ] Ledger: งานข้อ 5–6 ยังไม่มี entry (DS-LAKE-040 ครอบข้อ 1–4)
- [ ] `progress` รวมของ `feature_list.preprocessing.json` ยังไม่ได้คำนวณใหม่
- [ ] (เลือกได้) เพิ่ม timeout ให้เทส `raw-readings-table`

## ไฟล์หลักที่ควรรู้จัก

| ไฟล์                                                                                      | หน้าที่                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `apps/client/lib/critical-tags.ts`                                                        | critical tag + คำแนะนำ Clip/Exclude        |
| `apps/client/lib/auto-features.ts`                                                        | สร้างสูตร auto, หา interval, loop grouping |
| `apps/client/lib/zero-readings.ts`                                                        | หา tag ที่ค่า 0 เยอะ                       |
| `apps/client/lib/fetch-config.ts`                                                         | `piSummaryParams`, `withPiFetchSettings`   |
| `apps/client/lib/feature-engineering.ts`                                                  | kind `group`, datetime sin/cos             |
| `apps/client/lib/preprocessing.ts`                                                        | interpolate max gap                        |
| `apps/client/lib/trend-tooltip.ts`, `validation-format.ts`, `chart-format.ts`             | การแสดงผล                                  |
| `apps/python/services/feature_service.py`, `cleaning_service.py`, `validation_service.py` | ฝั่ง server ที่ต้องตรงกับ client           |
| `packages/py-scaling/src/softsensor_scaling/features.py`                                  | ชื่อคอลัมน์ / lookback ที่ serving ใช้     |
