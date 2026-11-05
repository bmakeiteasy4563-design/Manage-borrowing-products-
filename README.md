# MIES TRADING – ระบบยืม-คืนสินค้า (PWA – ใช้ GitHub อย่างเดียว)

ข้อมูลทั้งหมดอยู่ในไฟล์ `loans.json` ใน repo นี้ (ดูประวัติ/ย้อนกลับได้ที่ GitHub → History)

- **ผู้ยืม:** เปิดลิงก์แล้วดูได้เลย ไม่ต้องล็อกอิน (แก้ไม่ได้)
- **เจ้าของ:** กด "เข้าสู่ระบบเจ้าของสินค้า" ใส่ repo + token แล้วเพิ่ม/แก้ไข/ลบ/คืนสินค้าได้

## ตั้งค่า
1. สร้าง repo ใหม่บน GitHub (ต้องใช้ branch `main`) แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้
   (ไฟล์ `.nojekyll` ต้องอัปด้วย)
2. Settings → Pages → Deploy from branch → `main` / root
   (repo ฟรีต้องเป็น Public: ใครรู้ลิงก์ก็เปิดดูรายการได้)
3. สร้าง token: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   - Repository access: เลือกเฉพาะ repo นี้
   - Permissions → Contents: **Read and write**
4. เปิดเว็บ → เข้าสู่ระบบเจ้าของสินค้า → ใส่ `ชื่อผู้ใช้/ชื่อ repo` และ token
   (เก็บไว้ในเครื่องคุณเท่านั้น ไม่ต้องใส่ซ้ำ)

## หมายเหตุ
- ผู้ยืมอาจเห็นข้อมูลใหม่ช้าได้ราว 1–10 นาที (แคชของ GitHub Pages) ส่วนเจ้าของเห็นสดเสมอ
- ปุ่ม "สำรองข้อมูล" ดาวน์โหลดรายการทั้งหมดเป็นไฟล์ JSON
- ติดตั้งเป็นแอป: Android/Chrome เมนู ⋮ → ติดตั้งแอป / iPhone/Safari ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม
