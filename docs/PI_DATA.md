D1 - PI 9121 A .MEAS
│ │ │ │ └─ suffix = ประเภทค่า (MEAS = measured value)
│ │ │ └───── ลำดับ / ตำแหน่งย่อย (A, B, C...)
│ │ └─────────── หมายเลข Loop / Tag Number
│ └─────────────── ประเภท Instrument
│ PI = Pressure Indicator
│ TI = Temperature Indicator
│ II = Current Indicator (mA)
│ FI = Flow Indicator
└────────────────────── ชื่อ Unit / District (D1 = District 1)

## ==Config PI Server==

RANGE_TIME = 1

# ──────────────────────────────────────────────────

# ช่วงเวลาย้อนหลังที่ดึงข้อมูล (หน่วยเป็นนาที)

# ปัจจุบันถูก Override ด้วย timedelta(minutes=1) ใน code

# ถ้าอยากใช้จริง ต้องแก้ code ให้อ้างอิง RANGE_TIME ด้วย

PI_NAME = "TPERYPIDH01"

# ──────────────────────────────────────────────────

# ชื่อ PI Data Archive Server ในองค์กร

# ดูได้จาก PI System Explorer > Servers

# ห้ามพิมพ์ผิด! ตัวพิมพ์ใหญ่/เล็กมีผล

CAL_TYPR = "Average"

# ──────────────────────────────────────────────────

# ประเภทการสรุปค่าใน interval นั้นๆ

# ตัวเลือก

# "Average" → ค่าเฉลี่ยในช่วงเวลา ✅ (ใช้บ่อยสุด)

# "Maximum" → ค่าสูงสุด

# "Minimum" → ค่าต่ำสุด

# "Total" → ผลรวม

# "StdDev" → ส่วนเบี่ยงเบนมาตรฐาน

# "Count" → จำนวนครั้งที่บันทึก

CAL_BASIS = "TimeWeighted"

# ──────────────────────────────────────────────────

# วิธีคำนวณ Average

# ตัวเลือก

# "TimeWeighted" → ถ่วงน้ำหนักด้วยเวลา ✅

# เหมาะกับ sensor ที่อ่านค่าไม่สม่ำเสมอ

# "EventWeighted" → ถ่วงน้ำหนักด้วยจำนวน event

# เหมาะกับ event-driven data

INTERVAL_TIME = "1m"

# ──────────────────────────────────────────────────

# ความถี่ในการสรุปค่า (Summary Duration)

# ตัวอย่าง

# "1m" → ทุก 1 นาที

# "5m" → ทุก 5 นาที

# "1h" → ทุก 1 ชั่วโมง

# "1d" → ทุก 1 วัน
