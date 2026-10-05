# การคำนวณ Bins สำหรับ PSI (Population Stability Index)

> เอกสารสำหรับ Data Scientist ใช้อ่านทำความเข้าใจและ Recheck ว่าระบบแบ่ง bins และคำนวณ PSI อย่างไร
> ทุกสมการอ้างอิงจากโค้ดจริง (ตรวจสอบ ณ 2026-10-05 หลังแก้ MODEL-SERVE-029) พร้อมระบุไฟล์

---

## สรุปภาพรวม

ระบบใช้ **3 วิธีในการสร้าง bins อ้างอิง (reference)** (ลองตามลำดับ) + **1 กฎการนับค่าลง bin** (ใช้ร่วมกันทั้งตอน train และ serving) + **สูตร PSI + เกณฑ์ค่านอกช่วง**

| #   | ส่วน                                        | ใช้เมื่อไร                                               | ไฟล์                                                                   |
| --- | ------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | **Continuous — Quantile (Equal-frequency)** | วิธีหลัก                                                 | `packages/py-scaling/src/softsensor_scaling/psi.py` (`quantile_edges`) |
| 2   | **Continuous — Distinct-value split**       | Fallback เมื่อวิธี 1 ใช้ไม่ได้ และ tag มีค่าไม่ซ้ำ > 10  | `psi.py` (`quantile_edges`)                                            |
| 3   | **Categorical (1 ค่า = 1 bin)**             | Fallback สุดท้าย ใช้กับ tag ที่มีค่าไม่ซ้ำ ≤ 10 เท่านั้น | `psi.py` (`_categorical`)                                              |
| 4   | **กฎนับค่าลง bin** (`bucket_value`)         | ใช้ทั้งนับข้อมูล train (refCounts) และข้อมูล live        | `psi.py` (`bucket_value`)                                              |
| 5   | **สูตร PSI + เกณฑ์ค่านอกช่วง**              | เทียบ live กับ reference แล้วตัดสินสถานะ                 | `apps/backend/src/lib/prediction-psi.ts` (`computePsi`)                |

### ลำดับการทำงาน

```
[ตอน Train — คำนวณครั้งเดียว แล้ว freeze ไว้ตลอดอายุ ModelVersion]
ข้อมูล RAW (ก่อน scaling) ของ tag เดียว, train split, เฉพาะแถว Good
        │
        ▼
  ค่าไม่ซ้ำ d < 2 ? ──ใช่──► Categorical (1 bin)
        │ไม่
        ▼
  วิธี 1: ขอบ quantile (k = min(10, d)) → ปัด 6 ตำแหน่ง → ตัดขอบซ้ำ
          → ขยายขอบนอกให้ครอบ min/max ของ train
        │
        ▼
  ได้ ≥ 2 bin และไม่มี bin ว่าง ? ──ใช่──► ✅ Continuous
        │ไม่
        ▼
  d > 10 ? ──ใช่──► วิธี 2: ขอบจากค่าไม่ซ้ำเรียงลำดับ → ผ่านเงื่อนไข ? ──ใช่──► ✅ Continuous
        │ไม่ (หรือวิธี 2 ไม่ผ่าน)
        ▼
  วิธี 3: Categorical (1 ค่าไม่ซ้ำ = 1 bin)

  บันทึก edges / binCount / binMode / refCounts ลง feature_spec.json

[ตอน Serving — ทุก request]
ค่า live (RAW) → นับลง bin ที่ freeze ไว้ (กฎเดียวกับตอน train) → เก็บ {counts, below, above}

[ตอน Monitoring]
รวม histogram ของ 24 inference window ล่าสุด → คำนวณ PSI + สัดส่วนนอกช่วง → ตัดสินสถานะ
```

**ข้อมูลตั้งต้น** (`apps/python/services/feature_spec_service.py`, `compute_psi_ref_edges`)

- ค่า **RAW** (หน่วยวิศวกรรมจริง) ไม่ใช่ค่าหลัง scale เพราะค่า live ที่เข้า `/predict` เป็นค่า RAW
- เฉพาะ **train split** และเฉพาะแถวที่สถานะ **Good** (`boxplot_service.good_values`)
- คำนวณ **แยกทีละ tag** (รวม derived feature ด้วย)

---

## วิธีที่ 1: Continuous — Quantile (Equal-frequency)

### ขั้นที่ 1.1 กำหนดจำนวน bin ที่ขอ

$$k = \min(10,\ d)$$

- `10` = `DEFAULT_PSI_BIN_COUNT`
- $d$ = จำนวนค่าที่ไม่ซ้ำกันของข้อมูล train

### ขั้นที่ 1.2 คำนวณขอบ bin ด้วย quantile

$$p_j = \frac{j}{k},\qquad j = 0, 1, \dots, k$$

$$e_j = Q(p_j)$$

ได้ขอบ $k+1$ ค่า เช่น $k = 10$ → $p = 0, 0.1, 0.2, \dots, 1.0$ → ขอบ 11 ค่า → 10 bins

### ขั้นที่ 1.3 สูตร Quantile แบบ Linear interpolation

ใช้ `np.quantile(..., method="linear")` เรียงข้อมูลจากน้อยไปมาก $x_0 \le x_1 \le \dots \le x_{n-1}$

$$h = (n-1)\cdot p$$

$$Q(p) = x_{\lfloor h \rfloor} + \big(h - \lfloor h \rfloor\big)\cdot\big(x_{\lfloor h \rfloor + 1} - x_{\lfloor h \rfloor}\big)$$

> **"Linear" คือวิธีประมาณค่าเมื่อตำแหน่ง quantile ตกระหว่างข้อมูล 2 ตัว ไม่ได้แปลว่าแบ่งความกว้างเท่ากัน**
> Quantile = **Equal-frequency** → แต่ละ bin มีข้อมูล ≈ $\frac{1}{k}$ ของทั้งหมด แต่ **ความกว้างของ bin ไม่เท่ากัน**
> ช่วงที่ข้อมูลหนาแน่น → bin แคบ / ช่วงที่ข้อมูลเบาบาง → bin กว้าง

**ตัวอย่าง** ข้อมูล $[1, 2, 4, 8, 16]$, $n = 5$

| $p$ | $h = 4p$ | $Q(p)$                                                    |
| --- | -------- | --------------------------------------------------------- |
| 0.5 | 2.0      | $x_2 = 4$ (ตรงจุดข้อมูล)                                  |
| 0.3 | 1.2      | $2 + 0.2 \times (4 - 2) = 2.4$ (ประมาณค่าระหว่าง 2 กับ 4) |

### ขั้นที่ 1.4 ปัดเศษและตัดขอบซ้ำ

$$\text{edges} = \text{sorted}\Big(\text{unique}\big(\text{round}(e_j,\ 6)\big)\Big)$$

ถ้ามีค่าซ้ำเยอะ ขอบ quantile หลายตัวจะทับกัน → ถูกตัดทิ้ง → **จำนวน bin จริงอาจน้อยกว่า $k$**

### ขั้นที่ 1.5 ขยายขอบนอกให้ครอบข้อมูล train (MODEL-SERVE-029)

$$e_0 \leftarrow \min(e_0,\ \min(\text{train})) \qquad e_{\text{last}} \leftarrow \max(e_{\text{last}},\ \max(\text{train}))$$

การปัด 6 ตำแหน่งอาจทำให้ขอบแรกสูงกว่าค่า min (เช่น 1.2345678 → 1.234568) หรือขอบสุดท้ายต่ำกว่าค่า max ขั้นนี้รับประกันว่า **ค่า train ทุกค่าอยู่ในขอบของตัวเอง** → $\sum \text{refCounts} = n$

$$\text{binCount} = |\text{edges}| - 1$$

### ขั้นที่ 1.6 ขอบเขตของแต่ละ bin

$$\text{bin}_i = \begin{cases} [\,e_i,\ e_{i+1}\,) & i < \text{binCount} - 1 \\ [\,e_i,\ e_{i+1}\,] & i = \text{binCount} - 1 \ \text{(bin สุดท้ายปิดขวา)} \end{cases}$$

(ตรงกับ convention ของ `numpy.histogram`)

### ขั้นที่ 1.7 นับ refCounts และตรวจเงื่อนไข

$$\text{refCounts}_i = \#\{\,x \in \text{train} : x \in \text{bin}_i\,\}$$

ผ่านเมื่อ **binCount ≥ 2** และ **ทุก $\text{refCounts}_i > 0$** (bin ว่างทำให้ $E_i = 0$ → $\ln(A_i/0)$ หาค่าไม่ได้) → ได้ **Continuous** ✅

---

## วิธีที่ 2: Continuous — Distinct-value split (MODEL-SERVE-029)

**ใช้เมื่อ** วิธี 1 ไม่ผ่าน **และ** $d > 10$ (tag ดูเป็นข้อมูลต่อเนื่อง) — กรณีทั่วไปคือ **ค่าเดียวกินสัดส่วนมาก + หางยาว** (เช่น 95% เป็น 0) ทำให้ขอบ quantile แทบทั้งหมดทับกันที่ค่าเดียว

ให้ $u_0 < u_1 < \dots < u_{d-1}$ = ค่าไม่ซ้ำเรียงลำดับ

$$k' = \min(10,\ d - 1)$$

$$e_j = u_{\text{round}\left(j \cdot \frac{d-1}{k'}\right)},\qquad j = 0, 1, \dots, k'$$

- ขอบทุกตัวเป็น **ค่าที่มีอยู่จริง** → bin $[u_a, u_b)$ มี $u_a$ อย่างน้อย 1 ค่าเสมอ → ไม่มี bin ว่าง
- จำนวน bin **ไม่เกิน 10** เสมอ
- **ไม่ใช่ equal-frequency** (แบ่งตามลำดับค่าไม่ซ้ำ) แต่ refCounts ยังนับจริง
- ผ่านขั้น 1.5–1.7 เหมือนวิธี 1

> ก่อนแก้: กรณีนี้ตกไป categorical ได้ binCount = d (อาจหลักพัน) → ต้องมีข้อมูล live ≥ d × 20 แถว → ติด `INSUFFICIENT_DATA` ตลอด

---

## วิธีที่ 3: Categorical — 1 ค่าไม่ซ้ำ = 1 bin

### ใช้เมื่อ

| ข้อ | เงื่อนไข                                                     |
| --- | ------------------------------------------------------------ |
| (ก) | ค่าไม่ซ้ำ $d < 2$ (ค่าเดียว ไม่มีการกระจายให้แบ่ง)           |
| (ข) | วิธี 1 ไม่ผ่าน และ $d \le 10$ (เช่น tag แบบ state / digital) |
| (ค) | วิธี 2 ไม่ผ่าน (กันไว้ ไม่ควรเกิดในทางปฏิบัติ)               |

### การสร้าง bin

$$\text{edges} = \text{unique}(\text{train}) \quad (\text{ค่าจริงแต่ละค่า ไม่ใช่ขอบช่วง})$$

$$\text{binCount} = d \quad (\le 10\ \text{ยกเว้นกรณี (ค)})$$

ทุก bin มี count ≥ 1 แน่นอน เพราะสร้างจากค่าที่มีอยู่จริง และ refCounts เป็นสัดส่วนจริง (เช่น valve ปิด 80% / เปิด 20% ไม่ใช่ 50/50)

---

## กฎการนับค่าลง bin (`bucket_value`) — ใช้ร่วมกันทั้ง Train และ Serving

ใช้ฟังก์ชันเดียวกันเพื่อให้ค่าเดียวกันถูกนับลง bin เดียวกันเสมอ ไม่ว่าจะมาจาก train หรือ live

| ที่ใช้                            | ไฟล์                                               |
| --------------------------------- | -------------------------------------------------- |
| นับ refCounts ตอน train           | `apps/python/services/feature_spec_service.py`     |
| นับค่า live ตอน `/predict`        | `apps/serving/services/prediction_log.py`          |
| นับค่า live ผ่าน inference window | `apps/python/services/inference_window_service.py` |

### Continuous

$$\text{bucket}(x) = \begin{cases} \text{below} & x < e_0 \\ \text{above} & x > e_{\text{last}} \\ \min\big(\text{bisect\_right}(\text{edges}, x) - 1,\ \text{binCount} - 1\big) & \text{กรณีอื่น} \end{cases}$$

ค่านอกช่วงถูกนับเป็น `below` / `above` **แยกต่างหาก** ไม่ถูกนับรวมเข้า bin ปลาย (ถ้านับรวมจะซ่อน drift)

### Categorical (MODEL-SERVE-029: มี below / above แล้ว)

$$\text{tol} = \begin{cases} \tfrac{1}{2}\min_i\,(\text{edges}_{i+1} - \text{edges}_i) & d \ge 2 \\ 0 & d = 1 \end{cases}$$

$$\text{bucket}(x) = \begin{cases} \text{below} & x < \text{edges}_0 - \text{tol} \\ \text{above} & x > \text{edges}_{\text{last}} + \text{tol} \\ \arg\min_i \big|\, x - \text{edges}_i \,\big| & \text{กรณีอื่น} \end{cases}$$

| ตัวอย่าง (train = {0, 1} → tol = 0.5) | ผล                                      |
| ------------------------------------- | --------------------------------------- |
| 0.998                                 | bin ของ 1 (noise ยังนับเป็น state เดิม) |
| 1.5                                   | bin ของ 1 (ขอบพอดี นับว่าอยู่ในช่วง)    |
| 2.0                                   | **above** (state ใหม่ที่ไม่เคยเห็น)     |

| ตัวอย่าง (train = {5} → tol = 0) | ผล        |
| -------------------------------- | --------- |
| 5.0                              | bin ของ 5 |
| 5.1                              | **above** |

- ถ้าระยะห่างเท่ากัน เลือก index ที่น้อยกว่า
- **ข้อจำกัดที่ยังเหลือ:** ค่าใหม่ที่อยู่ **ระหว่าง** state เดิม (เช่น train = {0, 2}, live = 1) ยังถูกนับเข้า state ที่ใกล้สุด ไม่ถูกจับเป็นค่านอกช่วง

---

## สูตร PSI

ไฟล์ `apps/backend/src/lib/prediction-psi.ts` (`psiForColumn`)

### การรวม histogram

ระบบรวม histogram ของ **24 inference window ล่าสุด** โดยบวก count ของแต่ละ bin ตรงๆ (`poolHistograms`)

### สัดส่วนของแต่ละ bin

$$A_i = \max\!\left(\frac{\text{live}_i}{\sum_j \text{live}_j},\ \varepsilon\right) \qquad E_i = \max\!\left(\frac{\text{ref}_i}{\sum_j \text{ref}_j},\ \varepsilon\right) \qquad \varepsilon = 10^{-4}$$

- $A_i$ = สัดส่วน live (Actual), $E_i$ = สัดส่วน reference (Expected)
- ตัวหารของ $A_i$ คือ `liveInRangeTotal` = $\sum \text{live}_j$ **ไม่รวม** below / above
- $\varepsilon$ = `PSI_EPSILON` กัน $\ln(0)$ (ใส่ทั้ง 2 ฝั่ง)

### PSI

$$\boxed{\ \text{PSI} = \sum_{i=1}^{\text{binCount}} (A_i - E_i)\cdot \ln\!\frac{A_i}{E_i}\ }$$

ทุกพจน์ ≥ 0 เสมอ เพราะ $(A_i - E_i)$ และ $\ln(A_i/E_i)$ มีเครื่องหมายเดียวกัน → PSI ไม่ติดลบ

### สัดส่วนค่านอกช่วง (คำนวณแยก ไม่อยู่ในสูตร PSI)

$$\text{outOfRangePct} = \frac{\text{below} + \text{above}}{\text{liveTotal}} \times 100,\qquad \text{liveTotal} = \sum \text{live}_j + \text{below} + \text{above}$$

PSI มองไม่เห็นค่านอกช่วง (reference ไม่มีมวลนอกขอบให้เทียบ) จึง **ตัดสินด้วยเกณฑ์ของตัวเอง** (MODEL-SERVE-029)

---

## เกณฑ์ตัดสินสถานะ

ค่า default จาก `apps/backend/src/config/env.config.ts` (override ได้ผ่าน env) — ทุกค่าเป็น **convention ไม่ได้วัดจากข้อมูลโรงงาน**

| ตัวแปร                                                        | ค่า default |
| ------------------------------------------------------------- | ----------- |
| `PSI_WARN` / `PSI_CRITICAL`                                   | 0.1 / 0.25  |
| `PSI_OUT_OF_RANGE_WARN_PCT` / `PSI_OUT_OF_RANGE_CRITICAL_PCT` | 5% / 20%    |
| `PSI_MIN_SAMPLES_PER_BIN`                                     | 20          |

| ลำดับตรวจ | เงื่อนไข                                                      | สถานะ                                     | psi    |
| --------- | ------------------------------------------------------------- | ----------------------------------------- | ------ |
| 1         | ไม่มี reference หรือจำนวน bin ไม่ตรงกัน                       | `UNKNOWN`                                 | null   |
| 2         | $\text{liveTotal} < \text{binCount} \times 20$                | `INSUFFICIENT_DATA`                       | null   |
| 3         | $\text{liveInRangeTotal} = 0$ (ค่า live หลุดช่วง **ทั้งหมด**) | `CRITICAL`                                | null   |
| 4         | กรณีอื่น                                                      | **แย่กว่า** ของ (สถานะ PSI, สถานะนอกช่วง) | ตัวเลข |

**สถานะ PSI:** $\ge 0.25$ → CRITICAL, $\ge 0.1$ → WARN, ไม่งั้น OK
**สถานะนอกช่วง:** $\ge 20\%$ → CRITICAL, $\ge 5\%$ → WARN, ไม่งั้น OK

- ถ้าสถานะนอกช่วงแย่กว่า จะมี `reason` เช่น `"6.0% of live samples outside the trained range"`
- ไม่มี hysteresis เพราะการรวม 24 window ลด noise อยู่แล้ว
- สถานะรวมของโมเดล = สถานะที่ **แย่ที่สุด** ในบรรดาทุก tag

---

## ตัวอย่าง (รันจากฟังก์ชันจริง)

### ตัวอย่าง 1: ข้อมูลกระจายสม่ำเสมอ → วิธี 1, 10 bins

```
input : 0, 1, 2, ..., 999  (1,000 ค่า)
output: continuous, binCount=10, refCounts=[100 × 10]
```

### ตัวอย่าง 2: ค่าซ้ำมาก + หางยาว → วิธี 2

```
input : 0.0 × 950 ค่า + 1, 2, ..., 50  (d = 51)
output: continuous, binCount=10, refCounts=[954, 5, 5, 5, 5, 5, 5, 5, 5, 6]
```

วิธี 1 ขอบ quantile ทับกันที่ 0 เกือบทั้งหมด → ไม่ผ่าน → $d = 51 > 10$ → วิธี 2 (ก่อนแก้ได้ categorical 51 bins)

### ตัวอย่าง 3: state tag → วิธี 3

```
input : [0, 0, 0, 0, 0, 0, 0, 0, 1, 1]
output: categorical, binCount=2, edges=[0.0, 1.0], refCounts=[8, 2]
```

### ตัวอย่าง 4: ขอบนอกครอบ min/max

```
input : [1.2345678, 2, 3, ..., 11, 12.9876543]  (12 ค่า)
output: continuous, binCount=10, sum(refCounts)=12  (ก่อนแก้ได้ 10 จาก 12)
```

### ตัวอย่าง 5: คำนวณ PSI (4 bins, ไม่มีค่านอกช่วง)

| bin | ref | live | $E_i$ | $A_i$ | $(A_i - E_i)\ln(A_i/E_i)$ |
| --- | --- | ---- | ----- | ----- | ------------------------- |
| 1   | 25  | 10   | 0.25  | 0.10  | $(-0.15)\ln(0.4) = 0.137$ |
| 2   | 25  | 20   | 0.25  | 0.20  | $(-0.05)\ln(0.8) = 0.011$ |
| 3   | 25  | 30   | 0.25  | 0.30  | $(0.05)\ln(1.2) = 0.009$  |
| 4   | 25  | 40   | 0.25  | 0.40  | $(0.15)\ln(1.6) = 0.071$  |

$$\text{PSI} \approx 0.228 \Rightarrow 0.1 \le 0.228 < 0.25 \Rightarrow \texttt{WARN}$$

### ตัวอย่าง 6: ค่า live หลุดช่วงทั้งหมด

```
input : counts=[0, 0], below=0, above=300, refCounts=[50, 50]
output: status=CRITICAL, psi=null, outOfRangePct=100,
        reason="all 300 live sample(s) fell outside the trained range"
```

(ก่อนแก้: PSI = NaN → สถานะ `OK`)

---

## ผล Recheck — สถานะการแก้ไข (MODEL-SERVE-029, 2026-10-05)

| ข้อ  | ปัญหา                                                               | สถานะ                                                          |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| R1   | ค่า live หลุดช่วงทั้งหมด → NaN → `OK` และค่านอกช่วงไม่ถูกนำมาตัดสิน | ✅ แก้แล้ว — CRITICAL + เกณฑ์นอกช่วง 5% / 20%                  |
| R2   | ปัดขอบ 6 ตำแหน่งทำให้ค่า min/max ของ train หลุดจาก refCounts        | ✅ แก้แล้ว — ขยายขอบนอกครอบ min/max                            |
| R3.1 | Categorical: state ใหม่ถูกนับเข้าค่าใกล้สุดแบบเงียบๆ                | ✅ แก้แล้ว — เกินครึ่งช่องว่างที่ปลายช่วง = below/above        |
| R3.2 | Tag ค่าเดียว → PSI = 0 เสมอ ไม่มีทาง alert                          | ✅ แก้แล้ว — ค่าอื่นทั้งหมด = below/above → เกณฑ์นอกช่วงจับได้ |
| R3.3 | Tag ต่อเนื่องตก categorical หลักพัน bin → ติด INSUFFICIENT_DATA     | ✅ แก้แล้ว — วิธี 2 (distinct-value split) ≤ 10 bins           |

### ข้อควรรู้หลังแก้

- **R2 / R3.3 มีผลกับโมเดลที่ train ใหม่เท่านั้น** — reference ของโมเดลเดิม freeze อยู่ใน `feature_spec.json` ไม่เปลี่ยน
- **R3.1 / R3.2 มีผลกับข้อมูล live ที่นับหลัง deploy** (apps/serving + apps/python) — Docker image ของ `apps/serving` ต้อง rebuild เอง
- **R1 มีผลทันทีกับทุกโมเดล** — tag ที่มีค่านอกช่วง ≥ 5% ต่อเนื่องจะเริ่มแสดง WARN / CRITICAL (ตั้งใจ)
- **ยังเหลือ:** ค่าใหม่ที่อยู่ **ระหว่าง** state เดิมของ categorical ยังนับเข้า state ใกล้สุด

---

## อ้างอิงไฟล์

| เรื่อง                           | ไฟล์                                                                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| สร้าง bins / นับค่าลง bin        | `packages/py-scaling/src/softsensor_scaling/psi.py`                                                                                                   |
| เรียกสร้าง bins ตอน train        | `apps/python/services/feature_spec_service.py` (`compute_psi_ref_edges`)                                                                              |
| Filter แถว Good                  | `apps/python/services/boxplot_service.py` (`good_values`)                                                                                             |
| นับค่า live ตอน serving          | `apps/serving/services/prediction_log.py` (`bucket_histograms`)                                                                                       |
| รวม histogram / สูตร PSI / สถานะ | `apps/backend/src/lib/prediction-psi.ts`                                                                                                              |
| Threshold                        | `apps/backend/src/config/env.config.ts`                                                                                                               |
| คำอธิบายบนหน้าจอ                 | `apps/client/lib/monitoring-status-explain.ts`                                                                                                        |
| Test                             | `packages/py-scaling/tests/test_psi.py`, `apps/backend/src/lib/prediction-psi.spec.ts`, `apps/client/lib/__tests__/monitoring-status-explain.test.ts` |
