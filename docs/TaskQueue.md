# Task Queue: คิว container สำหรับ train และ predict

ฟีเจอร์ `CONTAINER-QUEUE-001` สถานะ ณ 2026-11-09: เขียนโค้ดเสร็จ ยังไม่ได้ commit และยังไม่ได้ทดสอบครบทั้งระบบ
ความคืบหน้าของงานอยู่ที่ `docs/feature_list_container_queue.json`

> **ต้องตั้งค่า Redis ก่อนใช้งาน** ถ้ายังไม่ตั้ง งาน train/predict จะค้างที่สถานะ QUEUED และไม่มี container เริ่มเลย ดู[วิธีเปิดใช้งาน](#วิธีเปิดใช้งาน)

## ปัญหาเดิม

- train, score และ batch predict สร้าง container ทันทีที่กดเริ่ม ไม่มีเพดานรวมทั้งระบบ
- inference จำกัดแค่ 1 งานต่อ tick (5 นาที) จึงได้สูงสุด 12 งานต่อชั่วโมง
- แต่ละ container ได้ RAM สูงสุด 8 GiB แต่ Docker บนเครื่อง dev มี RAM รวม 7.8 GiB เพดานจึงไม่ได้กันอะไร
- train, score และ batch ไม่มี timeout ถ้า container ค้างจะกินทรัพยากรไปเรื่อยๆ

## ทำไมเลือก Redis + BullMQ

ผู้ใช้เลือกแบบนี้หลังเปรียบเทียบกับการทำคิวบน Postgres BullMQ ให้เรื่องลำดับงาน, priority และการปลุก worker ส่วนการตัดสินว่า CPU/RAM พอไหม BullMQ ไม่รู้จัก จึงเขียนเองใน `lib/container-budget.ts`

ข้อแลกเปลี่ยนที่ต้องรู้: มี service เพิ่มอีกหนึ่งตัวที่ต้องดูแล และถ้า Redis ล่ม container ใหม่จะเริ่มไม่ได้จนกว่า Redis จะกลับมา

## หลักการออกแบบ

- **แถวใน DB คือความจริง** UI, token guard และ callback อ่านจาก DB เหมือนเดิม BullMQ แค่ตัดสินว่าจะดูงานไหนต่อ ข้อมูลใน job มีแค่ id ไม่มี token
- **job จบทันทีที่ container เริ่ม** ไม่ถือ job ไว้ตลอดการ train เพราะถ้า backend restart ระหว่างนั้น BullMQ จะมองว่างานค้างและรันซ้ำ
- **worker ตรวจและเริ่มงานทีละงาน** (`concurrency: 1`) จึงไม่มีการแย่ง slot กัน งานที่ช้าห้ามอยู่ในขั้นนี้ การดึงข้อมูลจาก PI ของ inference จึงแยกไปอยู่คิว `inference-prep`

## ขั้นตอนการทำงาน

1. ผู้ใช้กดเริ่มงาน ระบบบันทึกแถวงาน (`QUEUED`, `PENDING` หรือ `scoringQueuedAt` สำหรับ score) แล้วเพิ่ม job เข้าคิว `container-admission`
2. worker อ่านแถวอีกครั้ง ถ้างานถูกยกเลิกไปแล้วก็จบทันที
3. ถ้ามี container ของงานนี้รันอยู่แล้ว (เช่น crash ระหว่างเริ่มงาน) ระบบจะรับช่วงต่อ ไม่สร้างซ้ำ
4. นับทรัพยากรจาก container ที่รันอยู่จริงใน Docker แล้วตัดสินตามตารางนี้

| ผลการตรวจ                      | สิ่งที่เกิดขึ้น                                                                |
| ------------------------------ | ------------------------------------------------------------------------------ |
| ทรัพยากรพอ                     | ออก token ใหม่แล้วเริ่ม container                                              |
| เครื่องเต็ม                    | หยุดคิวทั้งหมดชั่วคราวแล้วตรวจใหม่ทุก 3 วินาที งาน priority สูงสุดจึงไม่ถูกแซง |
| workspace ถึงเพดาน             | เลื่อนเฉพาะงานนั้น งานของ workspace อื่นไปต่อได้                               |
| งานใหญ่เกินกว่าเครื่องจะรับได้ | แถวงาน FAILED พร้อมบอกตัวเลขที่ต้องการและที่มี                                 |

## ลำดับความสำคัญ

| ลำดับ | งาน                           | เหตุผล                          |
| ----- | ----------------------------- | ------------------------------- |
| 1     | inference ของช่วงเวลาปัจจุบัน | ค่าที่พลาดไปกู้คืนไม่ได้        |
| 2     | score                         | ผู้ใช้รอผลอยู่ และใช้เวลาไม่นาน |
| 3     | batch predict                 |                                 |
| 4     | train                         | ใช้ทรัพยากรมากและรันนาน         |
| 5     | inference ย้อนหลัง (backfill) | ไม่ควรขวางงานของผู้ใช้          |

train และ batch ใช้ทรัพยากรส่วนสุดท้ายที่กันไว้ให้ inference ไม่ได้ train ที่รันนานจึงไม่ทำให้ monitoring ขาดช่วง

## ทรัพยากรต่องาน

| งาน       | RAM   | CPU |
| --------- | ----- | --- |
| train     | 4 GiB | 2   |
| score     | 2 GiB | 1   |
| batch     | 2 GiB | 1   |
| inference | 1 GiB | 1   |

ค่า train มาจากการวัด peak memory ใน trainer image กับขนาด dataset ใหญ่สุดจริง (35,593 แถว × 129 tag, 2 CPU)

| งานที่วัด                         | Peak RAM |
| --------------------------------- | -------- |
| Gaussian Process (10,000 แถว)     | 2.40 GiB |
| LSTM                              | 1.74 GiB |
| Random Forest grid search แบบขนาน | 0.70 GiB |
| Extra Trees                       | 0.57 GiB |
| LightGBM                          | 0.43 GiB |
| Random Forest                     | 0.39 GiB |
| XGBoost                           | 0.25 GiB |
| โหลด library และ predict ขนาดเล็ก | 0.33 GiB |

ค่าของ score และ batch ประเมินจากผลวัดด้านบน ยังไม่ได้วัดกับงานจริง

บนเครื่อง dev (Docker RAM 7.8 GiB) จะ train ได้ทีละ 1 งาน ถ้าเซิร์ฟเวอร์ใหญ่กว่า ระบบอ่านค่าจาก Docker และรันได้มากขึ้นเอง

## วิธีเปิดใช้งาน

1. เพิ่มใน `.env` โดยใช้รหัสเดียวกันทั้งสองบรรทัด และห้าม commit ไฟล์นี้

   ```
   REDIS_PASSWORD=<รหัสที่ตั้งเอง>
   REDIS_URL="redis://:<รหัสที่ตั้งเอง>@localhost:6379"
   ```

2. รัน `docker compose up -d redis`
3. Restart backend

DB local มี column `scoringQueuedAt` แล้ว (ใส่ด้วยมือ) environment อื่นต้อง apply migration `20261109100000_scoring_queued_at`

## การตั้งค่า

| ตัวแปร                                                                 | ค่าเริ่มต้น                | ความหมาย                            |
| ---------------------------------------------------------------------- | -------------------------- | ----------------------------------- |
| `TRAINING_MEMORY_BYTES`, `TRAINING_NANO_CPUS`                          | 4 GiB, 2 CPU               | ทรัพยากรของ train                   |
| `CONTAINER_SCORE_MEMORY_BYTES`, `CONTAINER_BATCH_MEMORY_BYTES`         | 2 GiB                      | RAM ของ score และ batch             |
| `CONTAINER_INFER_MEMORY_BYTES`                                         | 1 GiB                      | RAM ของ inference                   |
| `CONTAINER_SCORE_CPUS`, `CONTAINER_BATCH_CPUS`, `CONTAINER_INFER_CPUS` | 1                          | CPU ต่องาน                          |
| `CONTAINER_BUDGET_CPUS`, `CONTAINER_BUDGET_MEMORY_BYTES`               | ค่าจาก Docker หักส่วนสำรอง | กำหนดทรัพยากรรวมเอง                 |
| `CONTAINER_HOST_RESERVE_CPUS`, `CONTAINER_HOST_RESERVE_MEMORY_BYTES`   | 1, 1.5 GiB                 | สำรองให้ Postgres, MinIO, Redis     |
| `CONTAINER_HELD_CPUS`, `CONTAINER_HELD_MEMORY_BYTES`                   | 1, 1 GiB                   | ส่วนที่ train/batch ใช้ไม่ได้       |
| `CONTAINER_MAX_ACTIVE_PER_WORKSPACE`                                   | 2                          | train + batch พร้อมกันต่อ workspace |
| `CONTAINER_QUEUE_RECHECK_MS`                                           | 3,000                      | ความถี่ในการตรวจเมื่อเครื่องเต็ม    |
| `CONTAINER_QUEUE_SWEEP_MS`                                             | 60,000                     | ความถี่ในการเติมงานที่หลุดคิว       |
| `CONTAINER_QUEUE_MAX_WAIT_MS`                                          | 24 ชั่วโมง                 | รอคิวนานสุดก่อน FAILED              |
| `INFERENCE_PREP_CONCURRENCY`                                           | 2                          | จำนวน window ที่ดึงจาก PI พร้อมกัน  |

## เมื่อเกิดปัญหา

| อาการหรือเหตุการณ์    | สิ่งที่เกิดขึ้นและวิธีตรวจ                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| งานค้าง QUEUED ตลอด   | ตรวจ Redis ก่อน: `.env` ครบไหม, `docker compose ps redis` และ log ของ backend                  |
| Redis ล่ม             | กดเริ่มงานได้ปกติและแถวงานรออยู่ แต่ไม่มี container ใหม่ พอ Redis กลับมา ระบบเติมงานเข้าคิวเอง |
| Backend restart       | container ที่รันอยู่ทำงานต่อ และระบบกลับไปดูแลตอน boot                                         |
| รอคิวเกิน 24 ชั่วโมง  | train, batch, score จะ FAILED พร้อมเหตุผล                                                      |
| container รันเกินเวลา | train เกิน 12 ชั่วโมง, score/batch/inference เกิน 2 ชั่วโมง จะถูกหยุดและบันทึกเหตุผล           |

## ความปลอดภัย

container ของ train รันโค้ดที่ถือว่าไม่น่าเชื่อถือบน `monorepo_network` Redis จึงอยู่คนละ network, เปิด port เฉพาะ `127.0.0.1` และต้องใช้รหัสผ่าน

## ผลการทดสอบ

ผ่านแล้ว:

- Unit test ใหม่ของ budget, dispatcher และ spawn
- Type-check ของ backend และ client
- ทดสอบ dispatcher ตัวจริงกับ Docker และ Redis จริง โดยใช้ DB จำลองและ container ที่แค่ sleep:
  - มี slot เดียวแล้วงานรอตามลำดับ
  - inference แซง train ที่รอคิวได้
  - slot ว่างแล้วงานถัดไปเริ่มเอง
  - ยกเลิกระหว่างรอคิวแล้วไม่มี container เริ่ม
  - crash ระหว่างเริ่มงานแล้วไม่เกิด container ซ้ำ
  - เพดาน RAM ต่อโหมดถูกใช้จริง
- container บน `monorepo_network` มองไม่เห็น Redis ทาง DNS และทาง `host.docker.internal` ติดรหัสผ่าน

ยังไม่ได้ทดสอบ (ต้องตั้ง Redis ใน `.env` ก่อน):

- train จริงผ่าน UI ทั้งระบบ
- restart backend ระหว่าง train
- Redis ล่มขณะรันครบทั้งระบบ

test ที่ยังแดงอยู่ไม่เกี่ยวกับงานนี้: backend 9 suite ในไฟล์ที่ไม่ได้แตะ (auth, nodes, plan, workspace และ scaffold ของ controller) และ client 20 เคส โดย 6 เคสรันบน HEAD แล้วแดงเหมือนกัน ส่วนอีก 14 เคสอยู่ใน `core-config` และ `feature-count-sweep` ที่พังมาก่อน

## ข้อจำกัด

- รองรับ backend ตัวเดียวและ Docker host เครื่องเดียว ถ้าต้องขยายหลายเครื่อง ควรพิจารณา orchestrator เช่น Kubernetes Jobs
- ไม่มี dashboard ดูคิว
- ตัวเลข "runs ahead" นับเฉพาะ train ที่เข้าคิวก่อน งาน priority สูงกว่ายังแซงได้
- warm `/predict` และงาน preprocessing/loader ไม่ได้ใช้ container จึงไม่ได้อยู่ในคิวนี้

## ไฟล์หลัก

| ไฟล์                                                                                               | หน้าที่                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/backend/src/lib/container-budget.ts`                                                         | คำนวณว่าทรัพยากรพอไหม, ทรัพยากรต่อโหมด, priority |
| `apps/backend/src/api/v1/trainning-container/authorized/container-dispatch.service.ts`             | คิว, worker, การเติมงานที่หลุด, timeout          |
| `apps/backend/src/api/v1/trainning-container/authorized/trainning-container.authorized.service.ts` | สร้าง container, รับช่วงต่อ container เดิม       |
| `apps/backend/src/api/v1/inference-window/authorized/inference-window-scheduler.service.ts`        | เตรียม inference แล้วส่งเข้าคิว                  |
| `apps/client/lib/training-launch.ts`                                                               | ข้อความ "Waiting for compute"                    |
| `apps/client/lib/metric-source.ts`                                                                 | `isScoring` รวมสถานะ score ที่รอคิว              |
| `docker-compose.yml`                                                                               | service Redis                                    |
| `docs/ARCHITECTURE.md`                                                                             | หัวข้อ Container Job Queue                       |
