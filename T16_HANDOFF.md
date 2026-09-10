# S1-T16 Tutor Listings — Handoff

เอกสารนี้ใช้ส่งต่องาน S1-T16 ฝั่ง frontend ให้ owner คนถัดไปตรวจต่อหรือพัฒนาต่อได้ทันที

อัปเดตล่าสุด: 10 กันยายน 2026  
PR: [#41](https://github.com/Sitta-C/HKTutor/pull/41)  
Branch: `feature/s1-t16-tutor-listings`  
ฐานของ branch: `origin/main` ที่ commit `4b33d03`

## เป้าหมายของ T16

ให้ Tutor สามารถจัดการประกาศสอนของตัวเองได้ครบใน Sprint 1:

- ดูรายการประกาศทั้งหมดของตัวเอง
- สร้างประกาศเป็น Draft
- แก้ไข Draft หรือประกาศที่มีอยู่
- Publish เมื่อผ่านการยืนยัน Tutor
- Archive ประกาศที่เผยแพร่แล้ว
- Restore ประกาศที่ Archive กลับเป็น Draft หรือ Publish ใหม่
- ค้นหาและกรองรายการตามสถานะ
- เห็น validation และ feedback ที่อ่านง่ายทั้งภาษาไทยและอังกฤษ

ขอบเขตของ listing ใน Sprint นี้มีเพียง `subject`, `gradeLevel`, `pricePerHour` และ `description` ไม่มี title แยก, รูปภาพ, duration, capacity, location หรือ teaching mode ตามข้อกำหนดใน `ui-design/uidesign.md` §9.6

## สิ่งที่ทำเสร็จแล้ว

### Frontend

หน้าที่เพิ่ม:

| Route                                  | หน้าที่                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `/dashboard/listings`                  | รายการประกาศของ Tutor, summary, search, filter และ actions |
| `/dashboard/listings/new`              | สร้าง Draft ใหม่ หรือ Publish ทันทีเมื่อผ่านเงื่อนไข       |
| `/dashboard/listings/[listingId]/edit` | แก้ไข, บันทึก, Publish และ Restore                         |

ความสามารถหลัก:

- โหลด catalog ของ Subject และ Grade Level จาก API แทน free text
- แสดงเฉพาะ catalog ที่ active แต่ยังแสดงค่าที่เคยบันทึกไว้ให้แก้รายการเก่าได้
- ตรวจ form ก่อนส่ง: Subject/Grade ต้องมี, ราคาเป็นตัวเลขมากกว่า 0 และไม่เกิน 2 ตำแหน่ง, description 20–1000 ตัวอักษร
- แสดงจำนวนอักขระและ progress ของ description
- แสดง readiness checklist ก่อน Publish
- block การ Publish ถ้า Tutor ยังไม่ `VERIFIED`
- เก็บค่าใน form เมื่อ API error และแสดง feedback ใน `role="alert"`
- เตือนก่อนออกจากหน้าเมื่อมี unsaved changes
- แสดง status `DRAFT`, `PUBLISHED`, `ARCHIVED`
- มี search จาก subject, grade และ description
- มี filter All/Published/Draft/Archived และ mobile select
- รองรับ loading, empty state, no-result state และ error state
- ปรับ responsive สำหรับ mobile/tablet/desktop โดย preview จะเลิก sticky บนจอเล็ก

### Backend boundary

branch นี้ไม่มีการแก้ `apps/api` หรือ API unit tests งาน backend เป็น ownership ของอีกคนหนึ่ง

Frontend client ใน branch นี้เรียก contract ที่ควรมีอยู่แล้วตามเอกสาร API:

- `GET /api/v1/catalogs/subjects`
- `GET /api/v1/catalogs/grade-levels`
- `GET /api/v1/tutors/me/listings`
- `POST /api/v1/tutors/me/listings`
- `PATCH /api/v1/tutors/me/listings/:listingId`
- `POST /api/v1/tutors/me/listings/:listingId/publish`

สาม endpoint หลักของ listing (`GET` list, `POST`, `PATCH`, `POST publish`) มีอยู่แล้วจากงาน T15 และ frontend branch นี้นำมาใช้ต่อ ไม่ได้สร้างซ้ำ

ส่วน catalog (`/catalogs/subjects`, `/catalogs/grade-levels`) และ archive/restore status เป็น dependency ที่ต้องตกลงกับ backend owner แยกต่างหาก เพราะยังไม่มีอยู่ใน API ที่มาจาก T15

หาก backend ยังไม่มี endpoint ให้ใช้ mock/fixture ชั่วคราวในการทำ visual QA แล้วประสาน backend owner ให้ตรง contract ก่อน merge

### Dashboard/Profile UI

- listings ใช้ shell, cafe palette, card shadow, role chip และ action hierarchy ชุดเดียวกับ Profile
- nav ซ้ายแสดง SVG icon พร้อมขนาดและ active state ที่ถูกต้อง
- notification menu และ mobile sidebar ใช้งานได้จาก shared `DashboardShell`
- เปลี่ยน emoji และ symbol ที่ทำหน้าที่เป็น UI icon ใน Student/Tutor/Admin/Profile เป็น shared SVG component
- shared icon อยู่ที่ `apps/web/src/components/dashboard/dashboard-icon.tsx`

## Data contract

### Catalog response

Frontend คาดหวัง response รูปแบบนี้จาก API:

```json
{
  "items": [
    {
      "id": "uuid",
      "code": "MATH",
      "name": "Mathematics",
      "active": true,
      "createdAt": "2026-08-17T00:00:00.000Z",
      "updatedAt": "2026-08-17T00:00:00.000Z"
    }
  ]
}
```

### Teaching listing response ที่ frontend ใช้จาก T15

```json
{
  "listingId": "uuid",
  "subject": {
    "id": "uuid",
    "code": "MATH",
    "name": "Mathematics",
    "active": true,
    "createdAt": "2026-08-17T00:00:00.000Z",
    "updatedAt": "2026-08-17T00:00:00.000Z"
  },
  "gradeLevel": {
    "id": "uuid",
    "code": "G10",
    "name": "Grade 10",
    "sortOrder": 10,
    "active": true,
    "createdAt": "2026-08-17T00:00:00.000Z",
    "updatedAt": "2026-08-17T00:00:00.000Z"
  },
  "pricePerHour": 450.5,
  "description": "Experienced mathematics tutor.",
  "publicationStatus": "DRAFT",
  "publishedAt": null,
  "updatedAt": "2026-08-17T00:00:00.000Z"
}
```

### Create/Edit payload

```json
{
  "subjectId": "uuid",
  "gradeLevelId": "uuid",
  "pricePerHour": 450.5,
  "description": "Experienced mathematics tutor with a practical approach."
}
```

Rules:

- `subjectId` และ `gradeLevelId` ต้องเป็น UUID และต้องชี้ไปยัง catalog ที่ active
- `pricePerHour` เป็น THB/hour, มากกว่า 0 และไม่เกิน 2 decimal places
- `description` trim ก่อนบันทึก และต้องยาว 20–1000 ตัวอักษร
- owner มาจาก session ห้ามรับ `tutorProfileId` จาก client
- API ไม่ควรคืนข้อมูล private ของ account หรือ Tutor document

### Status behavior

| จากสถานะ        | Action        | ผลลัพธ์                                                             |
| --------------- | ------------- | ------------------------------------------------------------------- |
| Draft           | Publish       | `PUBLISHED`, ตั้ง `publishedAt` ใหม่, ต้องเป็น Tutor ที่ `VERIFIED` |
| Published       | Archive       | `ARCHIVED`, เก็บประวัติรายการไว้                                    |
| Archived        | Restore draft | `DRAFT`, ล้าง `publishedAt`                                         |
| Archived        | Publish       | `PUBLISHED`, ตั้ง `publishedAt` ใหม่, ต้องเป็น Tutor ที่ `VERIFIED` |
| Published/Draft | Save          | แก้ข้อมูลโดยไม่เปลี่ยนสถานะเอง                                      |

จุดที่ต้องคุยกับ Backend owner: T15 มี list/create/update/publish แล้ว แต่ยังไม่มี catalog read, direct single-listing read และ archive/restore mutation ใน runtime ปัจจุบัน UI จึงใช้ list response สำหรับหน้า edit และรอ contract เพิ่มเติมสำหรับส่วนที่เหลือ

## File map

### Web

- `apps/web/src/app/dashboard/listings/page.tsx` — route รายการ
- `apps/web/src/app/dashboard/listings/new/page.tsx` — route สร้าง
- `apps/web/src/app/dashboard/listings/[listingId]/edit/page.tsx` — route แก้ไข
- `apps/web/src/components/listings/tutor-listings-page.tsx` — list screen และ lifecycle actions
- `apps/web/src/components/listings/tutor-listing-editor.tsx` — form/editor/preview
- `apps/web/src/components/listings/listing-ui.tsx` — icon, metric, status badge และ field class
- `apps/web/src/lib/api/listings.ts` — API client
- `apps/web/src/lib/api/types.ts` — frontend types
- `apps/web/src/components/dashboard/dashboard-shell.tsx` — shared shell/nav/notification/sidebar
- `apps/web/src/components/dashboard/dashboard-icon.tsx` — shared SVG icon set
- `apps/web/src/components/profile/profile-editor.tsx` — Profile editor ที่ใช้ icon set เดียวกัน
- `apps/web/src/app/globals.css` — cafe theme, profile/listing styles และ responsive rules

### Tests

- `tests/tutor-profile-listings-ui.test.mjs`

## Validation ที่รันแล้ว

ผ่านแล้วบน branch นี้:

```text
apps/web: tsc --noEmit
apps/web: eslint . --max-warnings=0
apps/web: prettier --check (ไฟล์ที่แก้)
apps/web: next build --webpack
node --test tests/tutor-profile-listings-ui.test.mjs
```

UI static tests ผ่าน 3 cases:

1. route และ API client ของ listings ยัง wired ถูกต้อง
2. Archived สามารถ restore เป็น Draft หรือ Publish ใหม่ได้
3. form feedback และ validation อยู่ใน contract ที่กำหนด

การทดสอบ API ไม่ได้อยู่ในขอบเขตของ branch นี้ ให้ backend owner รัน unit/integration tests ของ endpoint ที่ frontend ใช้

`pnpm check` ยังควรรันซ้ำใน CI หลัง merge เพราะ local sandbox เคยมีข้อจำกัดเรื่อง process/listen และ dependency environment

## Manual QA checklist สำหรับ owner คนถัดไป

### Access/role

- [ ] Login ด้วย Tutor แล้วเข้า `/dashboard/listings` ได้
- [ ] Student/Admin ถูก redirect ออกจาก Tutor listing pages
- [ ] เปิด edit URL ของ listing ของคนอื่นแล้วไม่ได้ข้อมูล
- [ ] เปิด listing ID ที่ไม่มีอยู่แล้วเห็น not-found/error state

### List screen

- [ ] Summary count ตรงกับรายการจริง
- [ ] Search หา subject, grade และคำใน description ได้
- [ ] Filter ทุกสถานะแสดง count และรายการตรงกัน
- [ ] Empty state มี CTA ไปสร้างรายการใหม่
- [ ] Action button disable ระหว่าง request และไม่ยิงซ้ำ
- [ ] Archive มี confirmation ก่อนเปลี่ยนสถานะ
- [ ] Archived มี Restore draft และ Publish

### Editor

- [ ] Catalog load สำเร็จและ active value แสดงถูกต้อง
- [ ] กด Save Draft แล้วกลับ list พร้อมรายการใหม่
- [ ] กด Save บน edit แล้วค่าที่แก้ยังอยู่เมื่อ API fail
- [ ] Publish ของ Tutor ที่ไม่ verified ถูก block ทั้ง UI และ API
- [ ] Description counter, readiness checklist และ inline errors อ่านได้ชัด
- [ ] ออกหน้าขณะมี unsaved change แล้วมี browser warning
- [ ] Preview เปลี่ยนตาม subject, grade, rate และ description แบบ local

### Responsive/accessibility

- [ ] Mobile ใช้ hamburger เปิด/ปิด sidebar และ backdrop/Escape ปิดได้
- [ ] Preview/editor ไม่ล้นแนวนอนบน viewport ประมาณ 360px
- [ ] ปุ่มมี touch target อย่างน้อยประมาณ 44px
- [ ] Nav active มี `aria-current="page"`
- [ ] Input error มี `aria-invalid` และ feedback เชื่อมกับ field
- [ ] Icon เป็น decorative และไม่ถูกอ่านซ้ำโดย screen reader

## สิ่งที่ยังไม่รวมใน T16

สิ่งเหล่านี้ยังไม่ควรเติมเข้า T16 โดยไม่คุยเรื่อง schema/owner ก่อน:

- รูปภาพของประกาศสอน
- รูปโปรไฟล์ Tutor
- public tutor search/detail
- availability/calendar จริง
- booking/request workflow
- review/rating mutation
- Tutor documents และ verification upload
- per-listing location, teaching mode, duration หรือ capacity

### เรื่องรูปภาพ

ตอนนี้ listing และ profile รองรับเฉพาะข้อมูล text/number ตาม contract ยังไม่มี upload endpoint, storage, authorization หรือ database field ที่พร้อมใช้ หากจะเพิ่มรูปต้องแยก requirement/product log อย่างน้อยให้กำหนด:

- รูปเป็นของ profile หรือ listing
- จำนวนและขนาดไฟล์
- MIME/type ที่อนุญาต
- upload service และ signed URL/private storage
- thumbnail/processing/failure/retry
- owner access และ delete/replace behavior
- public response จะคืน URL แบบใดและหมดอายุอย่างไร

## Known follow-up / จุดที่ควรตรวจ

1. **Contract handoff** — ใช้ T15 list/create/update/publish contract เป็นฐาน แล้วให้ backend owner ตัดสินใจเรื่อง catalog read, direct single-listing read, archive/status patch, `createdAt` และ `gradeLevel.sortOrder`
2. **API integration** — ให้ backend owner รันกับฐานข้อมูลที่ seed แล้ว ตรวจ catalog inactive, ownership guard และ error shape จริง
3. **Manual visual QA** — เปิดทุก role และ viewport จริง เพราะ style ถูกปรับใน shared `globals.css` และ `DashboardShell`
4. **Notification data** — notification ใน shell ตอนนี้เป็น static product guidance ยังไม่มี persisted notification API
5. **Branch/PR** — PR #41 เปิดจาก branch นี้แล้ว; ถ้า main มี commit ใหม่ ให้ rebase ก่อน merge:

   ```bash
   git fetch origin
   git rebase origin/main
   git push --force-with-lease origin feature/s1-t16-tutor-listings
   ```

   ใช้ `--force-with-lease` เท่านั้นเมื่อ rebase branch ที่มี PR อยู่แล้ว และตรวจ conflict ทุกไฟล์ก่อน push

## วิธีเริ่มทำงานต่อ

```bash
git fetch origin
git checkout feature/s1-t16-tutor-listings
git pull --ff-only origin feature/s1-t16-tutor-listings
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

Web เปิดที่ `http://localhost:3000` และ API เปิดที่ `http://localhost:3001` ตาม environment ปัจจุบัน หาก port 3001 ถูกใช้งานอยู่ ให้หยุด process เดิมก่อนเปิด API ใหม่

ก่อนส่งงานต่อให้รันอย่างน้อย:

```bash
pnpm verify:workspace
pnpm format:check
pnpm lint
pnpm build
```

## Definition of done สำหรับการปิด T16

- [ ] PR #41 ผ่าน CI และ review
- [ ] Backend owner ยืนยัน T15 contract และ contract ส่วนที่เพิ่มใหม่กับ frontend ตรงกัน
- [ ] Manual QA ครบ Tutor verified/unverified, Draft/Published/Archived และ mobile
- [ ] Backend owner ทดสอบ ownership/authorization กับ listing ของ user อื่นแล้ว
- [ ] ไม่มีข้อมูล private หรือ emoji ที่ทำหน้าที่เป็น UI icon หลุดกลับมา
- [ ] ถ้าจะเพิ่มรูปภาพ ให้เปิด requirement/product log แยกก่อนลง schema หรือ endpoint
