# Project Demonstration Tests

ชุดนี้ใช้สำหรับ Project Demonstration หน้า 8 ข้อ 2 และ 3 โดยเลือก **E11 Identity,
Privacy & Access Control สำหรับ Playwright** และสงวน **E12 สำหรับ Manual** ตามที่ผู้ใช้เลือก
เมื่อ 16 พฤศจิกายน 2026 ไม่แก้ไข Testing Plan PDF/DOCX เดิม

แหล่งข้อกำหนด: [Product Backlog แถว 64–70](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=443082416#range=A64:L70),
Project Description หน้า 8 ส่วน Project Demonstration และรหัสเคสจาก Testing Plan เดิม
เส้นทาง HTTP ใช้ `/api/v1` ตาม implementation ปัจจุบัน

## ข้อ 2 Playwright สำหรับ E11

ไฟล์ `apps/web/e2e/identity-demo-live.spec.ts` ทดสอบ Chromium → เว็บ production build →
same-origin proxy → NestJS → PostgreSQL จริง ไม่มีการ mock API หรือดักตอบด้วย `route.fulfill`
ชุดเดโมแยกจาก Playwright UI suites เดิม และรัน worker เดียว ไม่มี automatic retries

| Story          | เคสจาก Testing Plan                       | สิ่งที่ตรวจ                                                                                                                                                                    |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US11-1         | TC-A02                                    | รหัสผ่านผิดได้ 401, UI แสดงข้อผิดพลาด, ไม่มี refresh cookie                                                                                                                    |
| US11-1         | TC-A10, A01, A08, A09                     | เข้าสู่ dashboard, อ่านเฉพาะ identity ที่อนุญาต, cookie เป็น HttpOnly, logout ได้ 204, JWT เดิมใช้ไม่ได้, กลับเข้าหน้าส่วนตัวไม่ได้                                            |
| US11-1, US11-2 | TC-A05, A06, A07, B01, B02                | ปฏิเสธรหัสผ่านสั้น/role admin/ไม่ consent/policy เก่า; อีเมลซ้ำตอบ generic 201 โดยไม่ออก access token หรือ refresh cookie                                                      |
| US11-2         | TC-B05                                    | UI ไม่ส่งคำขอสมัครเมื่อยังไม่ยอมรับ privacy notice                                                                                                                             |
| US11-1         | TC-A03, A13                               | token ที่ไม่มีอยู่ หมดอายุ หรือถูกใช้แล้วได้ 400 และไม่ออก refresh cookie                                                                                                      |
| US11-2, US11-4 | TC-B03, B04, D15                          | policy เก่าอ่าน/เขียนโปรไฟล์ไม่ได้, ปฏิเสธ consent ที่ไม่ถูกต้อง, ยอมรับ policy ปัจจุบันได้, การเขียนที่ถูกปฏิเสธไม่ได้สร้างโปรไฟล์                                            |
| US11-3, US11-4 | TC-C01, C02, C03, C04, D08                | student เรียก admin/tutor ไม่ได้, tutor เขียน student profile ไม่ได้และเห็นเฉพาะประกาศตัวเอง, แก้ประกาศผู้อื่นได้ 404 และเจ้าของอ่านกลับได้ข้อมูลเดิม; route admin เก่าได้ 404 |
| US11-1, US11-4 | TC-A12, A13, D14, D01, D02, D03, D07, D10 | ยืนยันอีเมลจาก token fixture จริง, บังคับ onboarding, ตรวจ 6 ช่องว่าง, สร้าง/แก้/โหลดโปรไฟล์ซ้ำ, ปฏิเสธชื่อว่างและ userId แทรกโดยข้อมูลเดิมไม่เปลี่ยน, ใช้ token ซ้ำไม่ได้     |
| US11-1, US11-4 | TC-A04, D09                               | ไม่มี session ได้ 401 โดยไม่เปิดเผย private fields และ UI กลับหน้า login                                                                                                       |

รหัสเคสอ้างอิงพฤติกรรมและ equivalence class เดิม โดยแทนบัญชี/ข้อมูลจริงด้วย fixtures สมมติ
และใช้ Chromium สำหรับ UI ชุดนี้เป็นตัวแทนสำหรับเดโมทั้ง 4 stories ไม่ใช่การรันครบ 82 เคสใน Testing Plan
การสมัครบัญชีใหม่สำเร็จ การส่งอีเมล Resend และการตรวจ hash/atomic registration ในฐานข้อมูล
อยู่นอกชุด Playwright นี้ token สำหรับ verification ถูกเตรียมล่วงหน้าและเก็บในฐานข้อมูลเป็น hash
ไม่มีการส่งอีเมลจริง ไม่มีการเรียกบริการชำระเงินหรืออัปโหลดไฟล์

### เตรียมครั้งแรก

ต้องมี Node.js/pnpm ตามรีโพ, Chromium ของ Playwright และพอร์ต
`3311` (API), `3100` (เว็บ), `3112` (proxy) ว่าง ใช้ **dev database จาก `DATABASE_URL`
ในไฟล์ `.env` ที่ root** ตามที่ผู้ใช้ยืนยัน ไม่ต้องใช้ Docker/container หรือ export ค่าใน Terminal
ฐานข้อมูลต้องมี migrations ปัจจุบันอยู่แล้ว คำสั่งเดโมไม่ migrate หรือ seed ฐานข้อมูล

```bash
pnpm db:migrate:status
pnpm build
pnpm --filter @hktutor/web exec playwright install chromium
```

`pnpm build` ต้องดาวน์โหลด Google Fonts หากยังไม่มี cache ไม่ต้องเปลี่ยนฟอนต์เพื่อรันเทสต์
runner อ่านเฉพาะ `DATABASE_URL` จาก `.env` และให้ค่านี้มีผลเหนือ `DATABASE_URL` ที่เคย export
ใน Terminal เพื่อให้ทุกขั้นตอนใช้ dev database เดียวกัน ไม่พิมพ์ connection URL หรือ credentials
ส่วน JWT keys/passwords/verification secrets สร้างใหม่แบบสุ่มในหน่วยความจำทุกครั้ง
Resend, Storage และ Omise ใช้ค่าทดสอบ ไม่เรียกบริการจริง และ background jobs ของ API ปิดด้วย `NODE_ENV=test`
การเรียก fixtures หรือ Playwright config โดยตรงโดยไม่มี environment ของ runner จะถูกปฏิเสธ

### รันเดโม

```bash
# รันจาก root ได้เลย ไม่ต้อง export environment variables
pnpm test:demo:playwright

# เปิดผลลัพธ์พร้อม steps ภาพหน้าจอ และวิดีโอแยกตามเทสต์
pnpm --filter @hktutor/web exec playwright show-report playwright-report/e11-demo
```

ทุกครั้งจะสร้าง run ID, บัญชี 7 บัญชี, ประกาศ DRAFT 2 รายการ และ catalog ที่ inactive 2 รายการ
โดยใช้ IDs/อีเมลเฉพาะรอบนั้น ไม่มีการ upsert/reset บัญชี dev ที่มีอยู่
หลังสำเร็จหรือล้มเหลว runner จะ cleanup เฉพาะข้อมูลของ run นั้นใน transaction
รวม profiles, sessions และ verification tokens ไม่ reset ฐานข้อมูลทั้งก้อน

หากการเชื่อมต่อขาดระหว่าง cleanup หรือโปรเซสถูกปิดทันที ให้ใช้ run ID ที่แสดงไว้ตอนเริ่ม:

```bash
pnpm test:demo:cleanup <run-id>
```

cleanup ตรวจ IDs และอีเมลของบัญชีก่อนลบ หากไม่ตรงกับ run ID จะปฏิเสธการลบ
อย่าใช้ `.env` ที่ชี้ production กับคำสั่งนี้

HTML report อยู่ที่ `apps/web/playwright-report/e11-demo/index.html`, JSON report อยู่ที่
`apps/web/test-results/e11-demo-results.json` และภาพหน้าจอ/วิดีโออยู่ใต้
`apps/web/test-results/e11-demo/` ทุกไฟล์เป็น ignored output

### วิดีโอสำหรับเปิดดูและนำเสนอ

คำสั่ง `pnpm test:demo:playwright` บันทึก WebM ของเทสต์ที่มีหน้าเว็บทุกครั้ง แม้เทสต์ผ่าน
เปิดดูได้ใน HTML report โดยเลือกเทสต์แล้วเปิดหัวข้อ Video ใช้ viewport 1280×720
และ slow motion 200 ms ต่อ action พร้อมหยุดที่ผลลัพธ์ที่ตรวจแล้ว 1.2 วินาทีเพื่อให้อ่านทัน
การรันครบชุดจะมีวิดีโอ 5 UI tests ส่วนอีก 4 API-only tests ดูผลใน steps ของรายงาน

เมื่อมี `ffmpeg` ใน PATH runner จะรวมวิดีโอทั้ง 5 ตามลำดับเทสต์เป็น H.264 MP4 อัตโนมัติ
หลัง cleanup ฐานข้อมูลแล้ว:

```text
apps/web/test-results/e11-demo/e11-project-demonstration.mp4
```

หากยังไม่มี `ffmpeg` จะยังดู WebM ในรายงานได้ เมื่อเตรียมเครื่องมือพร้อมแล้วสามารถแปลง
ผลรอบล่าสุดซ้ำได้โดยไม่รันเทสต์หรือแตะฐานข้อมูล:

```bash
pnpm test:demo:video:export
```

วิดีโอเก็บเฉพาะภาพหน้าเว็บ ช่อง password แสดงเป็นจุดและไม่มีการเปิดดูรหัสผ่าน
address bar และ network response ไม่อยู่ในวิดีโอ ปิด trace/HAR เพื่อไม่เก็บ auth response
ภาพหน้าจอที่แนบปิดทับช่อง password เพิ่มอีกชั้น วิดีโอและรายงานจะถูกแทนที่เมื่อรันชุดเดโมรอบใหม่

## ข้อ 3 Jest และ statement coverage 100 เปอร์เซ็นต์

ฟังก์ชันที่เลือกคือ `verifyAccessSession` ใน `apps/api/src/modules/auth/access-session.ts`
ซึ่งตรวจ JWT, session ที่มีอยู่และยังไม่ถูก revoke, session owner/expiry, สถานะบัญชี,
บทบาทและ privacy consent ก่อนคืนตัวตนของผู้ใช้

```bash
pnpm test:demo:unit
```

ใช้ Jest และ real JWT service โดย mock เฉพาะ persistence boundary ไม่ต้องมี PostgreSQL
ทดสอบผลสำเร็จของ student/tutor, role ล่าสุดในฐานข้อมูล, invalid JWT, session ที่หาย/ผิดเจ้าของ/
ถูก revoke/หมดอายุ, expiry ตรงเวลาปัจจุบัน, deleted/suspended/unverified account,
consent ที่หายหรือ policy เก่า, REST เทียบกับ chat, JWT/session expiry ที่สั้นกว่า
และ database failure ใช้เวลาคงที่เพื่อให้ผลซ้ำได้

`apps/api/jest.demo.config.mjs` บังคับ coverage ของไฟล์ที่มีฟังก์ชันนี้เพียงฟังก์ชันเดียว
ที่ 100% statements, branches, functions และ lines ถ้าต่ำกว่านี้คำสั่งจะล้มเหลว
HTML อยู่ที่ `apps/api/coverage/project-demonstration/index.html` และ JSON summary อยู่ข้างกัน
ตัวเลขนี้อ้างถึงฟังก์ชันที่เลือกเท่านั้น ไม่ใช่ backend ทั้งระบบ

## ผลการตรวจสอบ

รอบแรก 16 พฤศจิกายน 2026 บนฐานข้อมูลแยก `hktutor_e11_demo_test` (ก่อนเปลี่ยนมาใช้ dev):

- Playwright ผ่าน 9/9 tests ครบทั้ง 4 stories; รอบสุดท้าย 10.3 วินาที
- Jest ชุดเดโมผ่าน 17/17 tests, statements/branches/functions/lines = 100%
- `pnpm check` ผ่าน formatting, lint, web unit tests 878 เคส, API unit tests 1,883 เคส และ production builds
- หลังเสริม assertions รอบสุดท้าย web lint และ `tsc --noEmit` ผ่าน
- `pnpm verify:workspace` ผ่าน 140/140 contracts
- ตรวจ fixtures และ Playwright config รวม 10 กรณี: ปฏิเสธ URL ที่หาย, ไม่ opt-in,
  host นอกเครื่อง, ชื่อฐานข้อมูลผิด และ schema override

ชุดนี้ไม่รัน Playwright UI suites เดิมทั้งหมดหรือ database verifiers อื่น

รอบหลังเปลี่ยนมาใช้ dev database เมื่อ 16 พฤศจิกายน 2026:

- อ่าน `DATABASE_URL` จาก `.env` ด้วยคำสั่ง `pnpm test:demo:playwright` โดยไม่ export ค่าใน shell
- schema เป็นเวอร์ชันล่าสุด ไม่ได้ apply migration หรือรัน seed
- Playwright ผ่าน 9/9 tests และ cleanup ข้อมูลของรอบนั้นสำเร็จ
- ทดลองให้ Playwright ล้มเหลวด้วย filter ที่ไม่ถูกต้อง: runner คืน exit code 1 และยัง cleanup สำเร็จ
- คำสั่ง recovery cleanup รันซ้ำกับ run ที่ลบแล้วได้โดยไม่สร้างข้อมูลใหม่
- ตรวจจำนวนแถวก่อน/หลังใน 9 ตารางแล้วเท่าเดิม: User, StudentProfile, TutorProfile,
  TeachingListing, Subject, GradeLevel, AuthSession, EmailVerificationToken และ PasswordResetToken
  การตรวจนี้ใช้เฉพาะ `COUNT(*)` ไม่อ่านเนื้อหาของแถวเดิม
- unit tests ของ runner ผ่าน 3 เคส: เลือกเป้าหมายจาก `.env`, สุ่ม credentials/IDs ใหม่ทุกรอบ,
  และปฏิเสธ configuration ที่ไม่ถูกต้องโดยไม่เปิดเผย credentials
- `pnpm check` ผ่าน และ `pnpm verify:workspace` ผ่าน 143/143 contracts

รอบบันทึกวิดีโอ: Playwright ผ่าน 9/9 tests, สร้าง WebM 5 คลิปและ MP4 รวม 19.28 วินาที
ตรวจ decode ไฟล์ MP4 ผ่าน (H.264, 1280×720), root/web lint, web typecheck,
formatting และ runner tests 3 เคสผ่าน จำนวนแถวทั้ง 9 ตารางหลัง cleanup เท่าก่อนรัน
