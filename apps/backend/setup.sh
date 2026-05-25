#!/bin/bash

# รับชื่อ module จาก user 
MODULE_NAME=${1:-"example"}
# กำหนด Path หลัก (Nest CLI จะอิงจากโฟลเดอร์ src เป็นหลัก)
BASE_PATH="api/v1/$MODULE_NAME"

echo "🔥 Generating NestJS structure for module: $MODULE_NAME..."

# 1. สร้าง Main Module ก่อน
pnpm nest g mo $BASE_PATH/$MODULE_NAME --flat

# 2. สร้าง Public Layer (Controller + Service + Spec)
pnpm nest g co $BASE_PATH/public/$MODULE_NAME.public --flat
pnpm nest g s $BASE_PATH/public/$MODULE_NAME.public --flat

# 3. สร้าง Authorized (Member) Layer
pnpm nest g co $BASE_PATH/authorized/$MODULE_NAME.authorized --flat
pnpm nest g s $BASE_PATH/authorized/$MODULE_NAME.authorized --flat

# 4. สร้าง Admin Layer
pnpm nest g co $BASE_PATH/admin/$MODULE_NAME.admin --flat
pnpm nest g s $BASE_PATH/admin/$MODULE_NAME.admin --flat

# 5. สร้าง Entities และ DTOs (ใช้ nest g class)
# --no-spec คือไม่เอาไฟล์ test สำหรับ DTO/Entity ถ้าต้องการให้ลบ flag นี้ออกครับ
# pnpm nest g cl $BASE_PATH/entities/$MODULE_NAME.entity --no-spec --flat
pnpm nest g cl $BASE_PATH/public/dto/$MODULE_NAME.public.dto --no-spec --flat
pnpm nest g cl $BASE_PATH/authorized/dto/$MODULE_NAME.authorized.dto --no-spec --flat
pnpm nest g cl $BASE_PATH/admin/dto/$MODULE_NAME.admin.dto --no-spec --flat 

echo "✅ NestJS structure for '$MODULE_NAME' is ready with .spec.ts files!"