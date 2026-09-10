# S1-T16 — Tutor profile editor และ teaching listings

เอกสารนี้เป็น handoff สำหรับ owner คนที่ 2 ของ S1-T16 โดยสรุปสิ่งที่ทำเสร็จแล้วใน branch ปัจจุบัน,
contract ที่โค้ดใช้จริง, วิธีตรวจสอบ, ข้อจำกัดที่ยังมี และลำดับงานที่ควรทำต่อ

เอกสารนี้อัปเดตจากโค้ดบน branch `feature/s1-t16-tutor-profile-editor` ณ วันที่ 2026-09-10

## สถานะปัจจุบัน

- Branch: `feature/s1-t16-tutor-profile-editor`
- Pull request: [Draft PR #40](https://github.com/Sitta-C/HKTutor/pull/40)
- Base branch: `main`
- Branch ถูก rebase บน `origin/main` ล่าสุดแล้ว
- GitHub CI ล่าสุดผ่านทั้งหมด
- Commit ล่าสุด: `466a37b fix: satisfy profile metadata lint`
- งานในเอกสารนี้ครอบคลุมทั้ง profile editor และ tutor listings แม้ชื่อ task จะเป็น S1-T16

ดู commit ทั้งหมดของงานนี้ได้ด้วย:

```bash
git log --oneline origin/main..feature/s1-t16-tutor-profile-editor
```

## ขอบเขตของงานที่ทำแล้ว

### Tutor profile

มี profile editor ตัวเดียวที่ใช้ได้สองโหมด:

- onboarding หลังยืนยันอีเมล: `/onboarding/profile`
- แก้ไข profile ภายหลัง: `/dashboard/profile`

รองรับข้อมูล Tutor ดังนี้:

- ชื่อจริง `firstName`
- นามสกุล `lastName`
- ชื่อเล่น `nickname`
- ชื่อที่นักเรียนเห็น `displayName`
- แนะนำตัว `bio`
- ประสบการณ์สอนเป็นปี `experienceYears`

ข้อมูลต่อไปนี้เป็น server-controlled และแสดงแบบอ่านอย่างเดียว:

- สถานะการยืนยันตัวตน `verificationStatus`
- คะแนนเฉลี่ย `ratingAverage`
- จำนวนรีวิว `reviewCount`
- วันที่สร้าง `createdAt`
- วันที่แก้ไขล่าสุด `updatedAt`

เมื่อ profile ยังไม่ผ่านการยืนยัน จะเปิดให้กรอกและบันทึกได้ แต่ไม่อนุญาตให้ publish listing

### Tutor listings

มีหน้าใช้งานจริงสาม route:

| Route                                  | หน้าที่                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `/dashboard/listings`                  | แสดงประกาศของ Tutor ทั้งหมด พร้อม filter, search, summary และ action ตามสถานะ |
| `/dashboard/listings/new`              | สร้างประกาศใหม่เป็น Draft                                                     |
| `/dashboard/listings/[listingId]/edit` | แก้ไขประกาศเดิมและจัดการสถานะ                                                 |

หนึ่ง listing ประกอบด้วยข้อมูลที่แก้ไขได้สี่ตัว:

- `subjectId`
- `gradeLevelId`
- `pricePerHour`
- `description`

หน้า list แสดงชื่อจาก `subject.name` และ `gradeLevel.name` โดยไม่มี field `title` ใน model

สถานะที่รองรับ:

- `DRAFT`
- `PUBLISHED`
- `ARCHIVED`

ความสามารถของหน้าเว็บ:

- สร้าง Draft แรกจาก empty state
- กรอง All, Published, Draft และ Archived
- ค้นหาจากชื่อวิชา ระดับชั้น หรือคำอธิบาย
- แก้ไขข้อมูลโดยไม่ publish ให้อัตโนมัติ
- Publish เมื่อ profile เป็น `VERIFIED`
- Archive พร้อม confirmation inline
- คืน Archived กลับเป็น Draft
- Publish Archived ได้เมื่อ profile ผ่านการยืนยัน
- แสดงราคาเป็น THB และวันที่ตาม `Asia/Bangkok`
- แสดง publication readiness checklist
- แสดง preview ที่เปลี่ยนตามข้อมูลในฟอร์ม
- แจ้ง unsaved changes ก่อนออกจากหน้าด้วย browser `beforeunload`

### Shell, responsive และ notification

`DashboardShell` ถูกปรับให้ใช้ร่วมกับหน้า profile และ listings:

- ใช้โทน cafe เดียวกับหน้า login: cream, coffee brown, apricot และ white surface
- ใช้ icon แบบ inline SVG แทน emoji ใน navigation และ listing controls
- card และ control ส่วนใหญ่ใช้มุมเหลี่ยมระดับ `rounded-md` เพื่อให้ดูเป็นระบบเดียวกัน
- desktop มี sidebar ที่ย่อ/ขยายได้
- หน้าจอไม่เกิน 960px จะย่อ sidebar และเปิดผ่านปุ่ม hamburger
- เมื่อ mobile sidebar เปิด จะมี backdrop, lock body scroll และปิดได้ด้วย Escape หรือกดนอกเมนู
- profile มี section menu แบบปุ่มสามขีดที่เปิดเป็น floating popover
- หน้า profile และ listings ใช้ notification popover ใน header
- notification popover รองรับ unread badge, mark all as read, close button, Escape และ click outside

notification ตอนนี้เป็น UI state แบบ static เพื่อรองรับ UX เท่านั้น ยังไม่ได้เชื่อม API หรือ database

## โครงสร้างไฟล์สำคัญ

### Web

| ไฟล์                                                                                                                             | หน้าที่                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`apps/web/src/components/profile/profile-editor.tsx`](apps/web/src/components/profile/profile-editor.tsx)                       | Profile editor ของ Student/Tutor, onboarding/edit mode, validation, consent และ preview |
| [`apps/web/src/components/listings/tutor-listings-page.tsx`](apps/web/src/components/listings/tutor-listings-page.tsx)           | รายการ listing, filters, search, counts และ lifecycle actions                           |
| [`apps/web/src/components/listings/tutor-listing-editor.tsx`](apps/web/src/components/listings/tutor-listing-editor.tsx)         | ฟอร์ม create/edit, client validation, readiness checklist และ student preview           |
| [`apps/web/src/components/listings/listing-ui.tsx`](apps/web/src/components/listings/listing-ui.tsx)                             | shared field class, SVG icons, metric, status badge และ loading state                   |
| [`apps/web/src/components/dashboard/dashboard-shell.tsx`](apps/web/src/components/dashboard/dashboard-shell.tsx)                 | sidebar, responsive collapse, header, language switch, privacy modal และ notifications  |
| [`apps/web/src/lib/api/listings.ts`](apps/web/src/lib/api/listings.ts)                                                           | client functions สำหรับ catalog, list/get/create/update/status                          |
| [`apps/web/src/lib/api/profiles.ts`](apps/web/src/lib/api/profiles.ts)                                                           | client functions สำหรับ profile และ privacy consent                                     |
| [`apps/web/src/lib/api/types.ts`](apps/web/src/lib/api/types.ts)                                                                 | Web-side types ของ profile, catalog และ listing                                         |
| [`apps/web/src/lib/dashboard-navigation.ts`](apps/web/src/lib/dashboard-navigation.ts)                                           | role-based navigation และ active route resolution                                       |
| [`apps/web/src/app/globals.css`](apps/web/src/app/globals.css)                                                                   | theme, dashboard shell, profile layout, responsive rules และ notification styles        |
| [`apps/web/src/app/dashboard/listings/page.tsx`](apps/web/src/app/dashboard/listings/page.tsx)                                   | route entry ของ listing list                                                            |
| [`apps/web/src/app/dashboard/listings/new/page.tsx`](apps/web/src/app/dashboard/listings/new/page.tsx)                           | route entry ของ listing create                                                          |
| [`apps/web/src/app/dashboard/listings/[listingId]/edit/page.tsx`](apps/web/src/app/dashboard/listings/[listingId]/edit/page.tsx) | route entry ของ listing edit                                                            |

### API

| ไฟล์                                                                                           | หน้าที่                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`apps/api/src/profiles/profiles.controller.ts`](apps/api/src/profiles/profiles.controller.ts) | profile owner endpoints                                      |
| [`apps/api/src/profiles/profiles.service.ts`](apps/api/src/profiles/profiles.service.ts)       | profile upsert, privacy consent check และ profile completion |
| [`apps/api/src/profiles/profiles.dto.ts`](apps/api/src/profiles/profiles.dto.ts)               | validation ของ Student/Tutor profile                         |
| [`apps/api/src/profiles/profiles.swagger.ts`](apps/api/src/profiles/profiles.swagger.ts)       | Swagger contract ของ profile                                 |
| [`apps/api/src/tutors/tutors.controller.ts`](apps/api/src/tutors/tutors.controller.ts)         | tutor listing routes, guards และ ownership metadata          |
| [`apps/api/src/tutors/tutors.service.ts`](apps/api/src/tutors/tutors.service.ts)               | query, create, patch, publish, archive และ restore listing   |
| [`apps/api/src/tutors/tutors.dto.ts`](apps/api/src/tutors/tutors.dto.ts)                       | listing request/filter/status validation                     |
| [`apps/api/src/tutors/tutors.swagger.ts`](apps/api/src/tutors/tutors.swagger.ts)               | Swagger contract ของ listing routes                          |
| [`apps/api/src/catalogs/catalogs.controller.ts`](apps/api/src/catalogs/catalogs.controller.ts) | public subject/grade-level endpoints                         |
| [`apps/api/src/catalogs/catalogs.service.ts`](apps/api/src/catalogs/catalogs.service.ts)       | ดึงเฉพาะ catalog ที่ active และเรียงลำดับ                    |
| [`apps/api/src/app.module.ts`](apps/api/src/app.module.ts)                                     | register `CatalogsModule` และ `TutorsModule`                 |

## Runtime API contract ที่โค้ดใช้จริง

API มี global prefix เป็น `/api/v1` จาก [`apps/api/src/app.setup.ts`](apps/api/src/app.setup.ts)
ดังนั้นทุก path ด้านล่างต้องเติม prefix นี้เมื่อเรียกผ่าน API โดยตรง

ทุก private route ใช้ access token ใน `Authorization: Bearer <token>` และ client จะส่ง cookie ด้วย
`credentials: include`

### Profile routes

โค้ดจริงใช้ `/profiles/me` ไม่ใช่ route แบบ `/tutors/me/profile` ที่ยังมีอยู่ในเอกสาร design บางส่วน

| Method | Path                          | ผลลัพธ์                                                             |
| ------ | ----------------------------- | ------------------------------------------------------------------- |
| `GET`  | `/api/v1/profiles/me`         | `{ role, consentCurrent, policyVersion, profileComplete, profile }` |
| `PUT`  | `/api/v1/profiles/me/student` | สร้างหรือแก้ Student profile                                        |
| `PUT`  | `/api/v1/profiles/me/tutor`   | สร้างหรือแก้ Tutor profile                                          |

`GET /profiles/me` ของ Tutor จะคืน profile โดยมี shape หลักดังนี้:

```json
{
  "role": "TUTOR",
  "consentCurrent": true,
  "policyVersion": "2026-09-08",
  "profileComplete": true,
  "profile": {
    "firstName": "Anan",
    "lastName": "Sukjai",
    "nickname": "Anan",
    "displayName": "Kru Anan",
    "bio": "Mathematics tutor",
    "experienceYears": 5,
    "verificationStatus": "PENDING",
    "ratingAverage": "4.80",
    "reviewCount": 24,
    "createdAt": "2026-09-10T01:00:00.000Z",
    "updatedAt": "2026-09-10T01:00:00.000Z"
  }
}
```

`ratingAverage` เป็น decimal string หรือ `null` ตาม Web type และ Swagger ปัจจุบัน ไม่ควร assume เป็น
JavaScript number โดยตรง

การ save Tutor ใช้ body นี้:

```json
{
  "firstName": "Anan",
  "lastName": "Sukjai",
  "nickname": "Anan",
  "displayName": "Kru Anan",
  "bio": "Mathematics tutor",
  "experienceYears": 5
}
```

client ไม่สามารถแก้ `verificationStatus`, `ratingAverage`, `reviewCount`, `createdAt` หรือ
`updatedAt` ได้

### Listing routes

| Method  | Path                                                 | พฤติกรรมจริง                                            |
| ------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `GET`   | `/api/v1/tutors/me/listings`                         | คืน listing ของ Tutor คนปัจจุบัน เรียง `updatedAt desc` |
| `GET`   | `/api/v1/tutors/me/listings?publicationStatus=DRAFT` | filter สถานะหนึ่งค่า                                    |
| `GET`   | `/api/v1/tutors/me/listings/:listingId`              | คืน listing ที่เป็นของ Tutor คนปัจจุบันและยังไม่ถูกลบ   |
| `POST`  | `/api/v1/tutors/me/listings`                         | สร้าง listing เป็น `DRAFT`                              |
| `PATCH` | `/api/v1/tutors/me/listings/:listingId`              | partial update เฉพาะ field ที่ส่งมา                     |
| `POST`  | `/api/v1/tutors/me/listings/:listingId/publish`      | publish แบบ legacy endpoint                             |
| `PATCH` | `/api/v1/tutors/me/listings/:listingId/status`       | เปลี่ยนเป็น `DRAFT`, `PUBLISHED` หรือ `ARCHIVED`        |

body ของ create:

```json
{
  "subjectId": "<uuid>",
  "gradeLevelId": "<uuid>",
  "pricePerHour": 450.5,
  "description": "Experienced mathematics tutor."
}
```

body ของ status:

```json
{
  "publicationStatus": "ARCHIVED"
}
```

response listing ที่ client ใช้มี field สำคัญดังนี้:

```json
{
  "listingId": "<uuid>",
  "subject": {
    "id": "<uuid>",
    "code": "MATH",
    "name": "Mathematics",
    "active": true
  },
  "gradeLevel": {
    "id": "<uuid>",
    "code": "G10",
    "name": "Grade 10",
    "active": true
  },
  "pricePerHour": 450.5,
  "description": "Experienced mathematics tutor.",
  "publicationStatus": "DRAFT",
  "publishedAt": null,
  "createdAt": "2026-09-10T01:00:00.000Z",
  "updatedAt": "2026-09-10T01:00:00.000Z"
}
```

### Catalog routes

เป็น public routes และคืนเฉพาะรายการที่ `active: true`:

| Method | Path                            | ผลลัพธ์                                                    |
| ------ | ------------------------------- | ---------------------------------------------------------- |
| `GET`  | `/api/v1/catalogs/subjects`     | `{ items: SubjectOption[] }` เรียงชื่อและ code             |
| `GET`  | `/api/v1/catalogs/grade-levels` | `{ items: GradeLevelOption[] }` เรียง `sortOrder` แล้วชื่อ |

Frontend filter `active` ซ้ำอีกครั้งเพื่อป้องกัน catalog ที่ไม่ควรเลือกหลุดเข้าฟอร์ม

## ความต่างระหว่าง design document กับ runtime ปัจจุบัน

จุดนี้สำคัญมากก่อน owner 2 จะเพิ่ม API หรือเปลี่ยน client เพราะเอกสาร design เดิมบางส่วนยังเป็น
ข้อเสนอจากช่วงก่อน implementation

| หัวข้อ                  | Design ที่เคยระบุ              | Runtime ปัจจุบัน                                                                             |
| ----------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| Profile path            | `/tutors/me/profile`           | `/profiles/me` และ `/profiles/me/tutor`                                                      |
| Listing edit            | `PUT .../:listingId`           | `PATCH .../:listingId`                                                                       |
| Listing list response   | `{ items, total }`             | controller คืน `ListingResponseDto[]`; web client รองรับทั้ง array และ wrapper แบบ defensive |
| Listing create response | full listing                   | controller คืน `string` เป็น listing ID แม้ Swagger decorator ระบุ `ListingResponseDto`      |
| Publish response        | full listing ตาม Swagger       | `POST .../publish` ใน controller ไม่คืน body; web ใช้ status endpoint แทน                    |
| Status transition       | generic status patch ใน design | มี `PATCH .../status` และยังมี publish endpoint เดิมอยู่พร้อมกัน                             |
| Listing identifier      | `id` ใน design field table     | response ที่ใช้จริงชื่อ `listingId`                                                          |
| Tutor profile `userId`  | มีในบาง design table           | owner profile response ปัจจุบันไม่ได้คืน `userId`                                            |

ก่อนแก้ให้เลือก shape เดียวแล้วอัปเดตพร้อมกันอย่างน้อยใน controller, Swagger, Web type และ client
ไม่ควรแก้เฉพาะหน้าเว็บให้เดา response หลายแบบต่อไปเรื่อย ๆ

## Validation และ business rules

### Global API validation

API ใช้ `ValidationPipe` แบบ `transform: true`, `whitelist: true` และ
`forbidNonWhitelisted: true`:

- unknown fields ถูก reject ไม่ใช่ silently accepted
- string ที่มี whitespace รอบข้างถูก trim ใน DTO ที่กำหนดไว้
- query/body ถูก transform ก่อนเข้า service
- error ใช้ shape `statusCode`, `error`, `message`

### Tutor profile DTO

| Field             | Rule                                          |
| ----------------- | --------------------------------------------- |
| `firstName`       | string หลัง trim, 1–100 ตัวอักษร              |
| `lastName`        | string หลัง trim, 1–100 ตัวอักษร              |
| `nickname`        | string หลัง trim, 1–60 ตัวอักษร               |
| `displayName`     | string หลัง trim, 1–100 ตัวอักษร              |
| `bio`             | string หลัง trim, 1–2,000 ตัวอักษร            |
| `experienceYears` | integer และไม่น้อยกว่า 0; 0 เป็นค่าที่ถูกต้อง |

Profile จะถือว่า `profileComplete` เมื่อ `firstName`, `lastName` และ `nickname` มีค่าไม่ว่าง
เท่านั้น ปัจจุบันยังไม่ได้ใช้ `displayName`, `bio` หรือ `experienceYears` เป็น completion gate

การดูหรือบันทึก profile ต้องยอมรับ privacy policy version ปัจจุบันก่อน ยกเว้น Admin ตาม service rule
Frontend จะแสดง consent UI เมื่อ API ตอบ `400` จาก stale consent

### Listing DTO

| Field               | Create          | Patch                    | Rule                                      |
| ------------------- | --------------- | ------------------------ | ----------------------------------------- |
| `subjectId`         | required UUID   | optional UUID            | ต้องเป็น subject ที่มีอยู่                |
| `gradeLevelId`      | required UUID   | optional UUID            | ต้องเป็น grade level ที่มีอยู่            |
| `pricePerHour`      | required        | optional                 | number มากกว่า 0, ทศนิยมไม่เกิน 2 ตำแหน่ง |
| `description`       | required        | optional                 | trim แล้ว 20–1,000 ตัวอักษร               |
| `publicationStatus` | ไม่รับใน create | ใช้เฉพาะ status endpoint | `DRAFT`, `PUBLISHED`, `ARCHIVED`          |

หน้าเว็บตรวจราคาแบบเข้มด้วยรูปแบบ `digits` และทศนิยมไม่เกินสองตำแหน่ง และตรวจ description
หลัง trim ก่อนส่ง API

### Listing lifecycle

กฎที่ frontend คาดหวังและ service ปัจจุบันทำไว้:

1. Create จะได้ `DRAFT` เสมอ
2. Save field จะไม่เปลี่ยนสถานะเป็น Published โดยอัตโนมัติ
3. Publish ต้องมี Tutor profile ที่ `verificationStatus === 'VERIFIED'`
4. Publish จะตั้ง `publishedAt` เป็นเวลาปัจจุบัน
5. เปลี่ยนเป็น Draft จะล้าง `publishedAt`
6. Archive จะเก็บค่า `publishedAt` เดิมไว้เป็น publication history
7. Archived คืนเป็น Draft ได้โดยไม่ต้อง verified
8. Archived publish ได้เมื่อ verified
9. Listing ที่ถูก soft-delete (`deletedAt != null`) ไม่ควรถูกเปิดเผยใน list/get/update/archive flow

## วิธีตรวจสอบงาน

### Automated checks

จาก root ของ repository:

```bash
pnpm db:generate
pnpm verify:workspace
pnpm format:check
pnpm lint
pnpm test
pnpm build
```

คำสั่งรวมทั้งหมดคือ:

```bash
pnpm check
```

ผลล่าสุดของ GitHub CI ผ่านทุกขั้น รวมถึง:

- workspace contract tests: 68 tests
- API unit tests: 30 suites, 159 tests
- Prettier check
- root/API/Web lint
- Web production build

รัน API test แบบเต็มเฉพาะ package ได้ด้วย:

```bash
pnpm --filter @hktutor/api exec jest --runInBand
```

### Tests ที่เกี่ยวข้องกับ T16

| ไฟล์                                                                                                           | สิ่งที่ตรวจ                                                                  |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`apps/api/test/unit/tutors/tutors.dto.spec.ts`](apps/api/test/unit/tutors/tutors.dto.spec.ts)                 | listing field validation, trim, price precision, status enum                 |
| [`apps/api/test/unit/tutors/tutors.controller.spec.ts`](apps/api/test/unit/tutors/tutors.controller.spec.ts)   | Tutor role metadata, ownership metadata, delegation และ missing listing ID   |
| [`apps/api/test/unit/tutors/tutors.service.spec.ts`](apps/api/test/unit/tutors/tutors.service.spec.ts)         | owner scope, catalog validation, create, patch, publish, archive และ restore |
| [`apps/api/test/unit/catalogs/catalogs.service.spec.ts`](apps/api/test/unit/catalogs/catalogs.service.spec.ts) | active catalog และ ordering                                                  |
| [`apps/api/test/unit/profiles/profiles.service.spec.ts`](apps/api/test/unit/profiles/profiles.service.spec.ts) | profile metadata, stale privacy consent และ Tutor profile behavior           |
| [`apps/api/test/unit/profiles/profiles.swagger.spec.ts`](apps/api/test/unit/profiles/profiles.swagger.spec.ts) | profile Swagger shape                                                        |
| [`tests/tutor-profile-listings-ui.test.mjs`](tests/tutor-profile-listings-ui.test.mjs)                         | static UI selectors, routes, labels และ responsive/menu hooks                |

### Manual QA checklist

ใช้ Tutor account ที่ verified แล้วและ Tutor account ที่ยัง pending เพื่อทดสอบแยกกัน

#### Profile

- เปิด `/dashboard/profile` แล้วตรวจว่าหน้าไม่ redirect กลับ `/dashboard`
- โหลด profile เดิมแล้วตรวจว่าค่าทั้งหมดเติมลงฟอร์มถูกช่อง
- ลองเว้นชื่อจริง, นามสกุล, ชื่อเล่น, display name และ bio เป็นค่าว่าง
- ลอง bio ยาวเกิน 2,000 ตัวอักษร
- ลอง experience เป็นทศนิยมและค่าติดลบ
- แก้ไขแล้วกด Save ตรวจ success state และตรวจค่าใหม่หลัง reload
- ตรวจว่า verification, rating, review count และ metadata แก้จาก client ไม่ได้
- ใช้ account ที่ privacy policy เก่า แล้วตรวจ consent UI และ flow ยอมรับ policy ใหม่

#### Listings

- เปิด `/dashboard/listings` แล้วตรวจ loading, empty state และ error state
- สร้าง listing ใหม่โดยกรอกไม่ครบ ต้องเห็น inline error ที่ field ที่เกี่ยวข้อง
- ตรวจว่าราคา `450.555`, `0`, ค่าว่าง และรูปแบบที่ไม่ใช่ตัวเลขถูก reject
- ตรวจว่า description ต่ำกว่า 20 ตัวอักษรถูก reject และ counter เปลี่ยนตาม input
- Save draft แล้วตรวจว่า listing อยู่ใน Draft
- แก้ Draft แล้วตรวจว่าการ Save ไม่ publish อัตโนมัติ
- ใช้ verified Tutor กด Publish แล้วตรวจสถานะและ `publishedAt`
- ใช้ pending Tutor ตรวจว่าปุ่ม Publish disabled และมีคำอธิบายสาเหตุ
- Archive Published แล้วตรวจ confirmation ก่อนยิง request
- Restore Archived เป็น Draft แล้วตรวจว่า `publishedAt` ถูกล้าง
- Publish จาก Archived หลัง verified แล้วตรวจว่ายังทำได้
- เปิด edit URL ด้วย listing ที่ไม่มีอยู่หรือไม่ใช่เจ้าของ ต้องได้ generic not-found behavior
- ตรวจ filter, search, count และ date/price formatting

#### Responsive และ shell

- ทดสอบ desktop width ที่ sidebar แสดงเต็ม
- ทดสอบต่ำกว่า 960px แล้ว sidebar ต้องย่อและเปิดด้วย hamburger ได้
- ตรวจ backdrop, Escape, click outside และ body scroll lock
- ตรวจ profile section menu แบบสามขีดบน mobile
- ตรวจว่าปุ่มหลักและปุ่มรองมีพื้นที่กดอย่างน้อยประมาณ 44px
- ตรวจไม่ให้เกิด horizontal overflow ที่หน้า list, editor และ notification popover
- เปิด notification แล้วตรวจ unread badge, mark all as read, close และ link navigation

## สิ่งที่ยังไม่เสร็จหรือควรให้ owner 2 ทำต่อ

### 1. ปิด contract mismatch ระหว่าง API และ Web

นี่เป็นงานที่ควรทำก่อนเพิ่ม feature ใหม่:

- ตัดสินใจว่า list response จะเป็น array หรือ `{ items, total }`
- ทำให้ create คืน full listing ตาม Swagger หรือแก้ Swagger ให้ระบุว่าเป็น ID string
- ทำให้ publish endpoint คืน shape เดียวกับ status endpoint หรือถอด endpoint ซ้ำออก
- ตัดสินใจใช้ `PATCH` หรือ `PUT` เป็นมาตรฐานของ listing edit
- เปลี่ยนชื่อ `listingId` หรือแก้ shared type ให้ตรงกับ model/เอกสาร
- อัปเดต `ui-design/sprint1-ui-api-map.md` และ `ui-design/sprint1-api-field-requirements.md` ให้ตรง runtime

### 2. Harden service edge cases

ควรตรวจและเพิ่ม tests สำหรับ:

- Prisma `update()` ปกติจะ throw เมื่อหา row ไม่เจอ ไม่ได้คืน `null` เสมอไป การพึ่ง `if (!updatedListing)` อาจทำให้ missing/non-owned listing กลายเป็น 500
- `postPublishListing()` ใช้ where ที่ไม่มี `deletedAt: null` ใน update ควรป้องกันไม่ให้ soft-deleted listing ถูก publish
- status endpoint เรียก publish flow แยกจาก legacy `/publish` ทำให้กฎและ response มีโอกาสต่างกัน
- `@RequireOwnership({ allowAdmin: true })` ถูกวางไว้ แต่ controller มี `@Roles(Role.TUTOR)` อยู่ด้วย จึงต้องยืนยันว่าต้องการให้ Admin เข้าได้หรือไม่
- catalog validation ตอนนี้เช็กว่ามี ID แต่ควรยืนยัน product rule ว่าต้อง `active: true` ด้วยหรือไม่
- error response ยังไม่มี stable `code` สำหรับแยก not found, unverified และ conflict ใน frontend

### 3. เพิ่ม web-level behavior tests

ตอนนี้มี static test สำหรับตรวจ source/selector และ API unit tests แต่ยังไม่มี browser-level flow ที่
กดฟอร์มจริงครบทุกสถานะ ควรเพิ่มอย่างน้อย:

- profile load/save/error/consent flow
- listing create/edit/publish/archive/restore
- role guard ของ Student/Admin ที่เข้าหน้า Tutor listings
- responsive menu และ notification interactions
- retry หรือ session-expired behavior ของ `authenticatedFetch`

ควรเลือก test runner และวิธี mock API ให้สอดคล้องกับมาตรฐานของ repository ก่อนเพิ่ม dependency ใหม่

### 4. รูปภาพและเอกสาร Tutor

S1-T16 ปัจจุบันยังไม่รองรับรูป profile หรือรูปในประกาศสอน:

- Prisma model ยังไม่มี `avatarUrl`, `imageUrl` หรือ listing media relation
- API ไม่มี upload, storage, delete หรือ signed URL contract
- UI ใช้ตัวอักษรย่อแทน avatar
- certificate upload ใน design เป็น placeholder ของ Sprint 2

ถ้าจะเพิ่มรูป ต้องทำ product requirement และ contract แยกก่อน อย่างน้อยต้องตัดสินใจเรื่อง file type,
ขนาด, จำนวนรูป, storage, visibility, moderation, delete/replace และ fallback เมื่อ upload ล้มเหลว

### 5. Notification ยังเป็น presentation-only

notification ที่เห็นใน header ยังเป็นข้อมูลตัวอย่างตาม role และ state อยู่ใน component เท่านั้น:

- ไม่มี notification table หรือ API
- unread ไม่ persist เมื่อ reload
- ไม่มี timestamp จริง
- ไม่มี pagination, read-at, retry หรือ deep-link validation
- เนื้อหา profile/listing/privacy ยังเป็น static copy

ถ้าจะทำต่อเป็นระบบจริงควรแยก task และกำหนด event source ก่อน เช่น profile verification, listing
status change, booking request และ privacy policy update

### 6. Domain flow ที่ยังอยู่นอก S1-T16

ยังไม่ได้ทำใน branch นี้:

- availability manager
- public tutor search
- public tutor detail
- booking quote และ booking creation UI
- student/tutor booking history
- tutor booking management
- dashboard counts, revenue และ live activity จาก API
- settings และ support workflow

อย่าเพิ่ม endpoint เหล่านี้ใน T16 โดยไม่คุย owner ของ T18, T21, T24 และ T25 ก่อน

## ลำดับงานแนะนำสำหรับ owner 2

1. อ่านไฟล์นี้พร้อม [`ui-design/sprint1-api-field-requirements.md`](ui-design/sprint1-api-field-requirements.md)
   และ Swagger ที่ `/api/v1/docs`
2. checkout branch ล่าสุดของ T16 แล้วรัน `pnpm check`
3. ยืนยันกับ API owner ว่าจะใช้ response/method shape ใดเป็น final contract
4. แก้ service edge cases และเพิ่ม regression tests ก่อนแก้ UI ต่อ
5. ทำ browser-level tests สำหรับเส้นทางสำคัญของ profile และ listings
6. ทดสอบ manual QA ตาม checklist ด้านบนทั้ง verified และ unverified Tutor
7. ถ้าจะเพิ่มรูปหรือ notification จริง ให้เปิด requirement/product log แยก ไม่ยัด schema ใหม่เข้า T16 โดยไม่มีข้อตกลง

ตัวอย่างการสร้าง branch ต่อจากงานนี้:

```bash
git fetch origin
git switch -c <owner-2-branch> origin/feature/s1-t16-tutor-profile-editor
```

หลังจาก branch ของ owner 2 เสร็จ ให้เปิด PR แยกมายัง `main` หรือ merge ผ่าน PR #40 ตาม workflow ของทีม
โดยไม่ force-push ทับ branch นี้ถ้าไม่ได้ตกลงร่วมกัน

## กลุ่ม commit ของงานนี้

อ่านตามลำดับเพื่อดูพัฒนาการของงานได้ดังนี้:

| Commit    | เนื้อหา                                                  |
| --------- | -------------------------------------------------------- |
| `5dea96a` | polish tutor profile editor                              |
| `8b235b7` | ปรับ profile navigation และ shapes                       |
| `a5f67c4` | responsive profile layout และ floating tabs/menu         |
| `58595a0` | ทำ profile sidebar ให้เต็มความสูง                        |
| `48b6ac8` | ใช้ cafe theme ให้สอดคล้องกับ login                      |
| `1a226bd` | ลบ duplicate profile listing action                      |
| `2890d1b` | responsive profile menu และ notifications                |
| `0f1716f` | polish notification popover                              |
| `78b30cd` | เพิ่ม tutor listings management                          |
| `6b9d7f8` | polish listing UX                                        |
| `6148de5` | เติม profile/listing contract และ metadata               |
| `e3935c1` | restore tutor listing Swagger contract หลัง rebase       |
| `466a37b` | แก้ CI ESLint unsafe assignment ใน profile metadata test |

## Definition of done สำหรับการส่งต่องาน

ถือว่างานส่วนนี้พร้อมให้ owner 2 ต่อเมื่ออ่านแล้วตอบได้ว่า:

- profile routes ที่ใช้จริงคืออะไร
- listing create/edit/status response ปัจจุบันต่างจาก design อย่างไร
- verified Tutor กับ pending Tutor ทำอะไรได้ต่างกันอย่างไร
- profile และ listing validation อยู่ทั้ง client และ server ที่ไหน
- ทำไม listing จึงยังไม่มีรูป
- notification ที่เห็นตอนนี้เป็น static UI หรือ production data
- จะตรวจ regression ด้วย test และ manual QA ชุดใด

จุดประสงค์ของเอกสารนี้คือทำให้ owner 2 ต่อจาก implementation ปัจจุบันได้โดยไม่ต้องเดา contract จาก
หน้าจอหรือ commit เก่า และไม่ทำให้ route/API ที่ owner อื่นกำลังรับผิดชอบเกิดความขัดแย้ง
