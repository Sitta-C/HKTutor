# Auth example

โฟลเดอร์นี้เป็นตัวอย่างการสร้าง NestJS endpoint ที่ใช้ระบบ authentication ใหม่ครบทั้ง Swagger, JWT authentication, role-based authorization และการอ่านผู้ใช้ปัจจุบันจาก request

Endpoint ตัวอย่างคือ:

```http
GET /api/v1/examples/protected
Authorization: Bearer <access-token>
```

อนุญาตเฉพาะผู้ใช้ role `TUTOR` หรือ `ADMIN`

## ไฟล์ภายในโฟลเดอร์

### `auth-example.controller.ts`

ประกาศ route และรวม security components เข้าด้วยกัน:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuthExampleController {
  @Get('protected')
  @GetProtectedAuthExampleDoc()
  @Roles(Role.TUTOR, Role.ADMIN)
  getProtectedExample(@CurrentUser() user: AuthenticatedUser) {
    // ใช้ user.id, user.email, user.role และ user.sessionId ได้ที่นี่
  }
}
```

`@UseGuards(JwtAuthGuard, RolesGuard)` มีลำดับสำคัญ Guard ทำงานจากซ้ายไปขวา ดังนั้น `JwtAuthGuard` ต้องมาก่อนเพื่อสร้าง `request.auth` แล้ว `RolesGuard` จึงตรวจ `request.auth.role` ได้

ตำแหน่งของ `@Roles(...)` เมื่อเทียบกับ `@UseGuards(...)` ใน source code ไม่ได้กำหนดลำดับการทำงาน เพราะ `@Roles` มีหน้าที่บันทึก metadata เท่านั้น ส่วนลำดับภายใน `@UseGuards(...)` เป็นสิ่งที่กำหนดลำดับ Guard

ปัจจุบัน `@UseGuards` อยู่ระดับ controller จึงป้องกันทุก endpoint ใน controller นี้ หากต้องการป้องกันเฉพาะบาง endpoint ให้นำ `@UseGuards` ไปวางที่ method นั้นแทน

### `auth-example.swagger.ts`

รวม Swagger decorators ไว้ใน custom decorator `@GetProtectedAuthExampleDoc()` เพื่อแยก API documentation ออกจาก controller logic

- `ApiOperation` แสดงชื่อ endpoint ใน Swagger UI
- `ApiBearerAuth` ระบุว่าต้องใช้ Bearer access token
- `ApiOkResponse` อธิบาย response เมื่อสำเร็จ
- `ApiUnauthorizedResponse` อธิบาย `401 Unauthorized`
- `ApiForbiddenResponse` อธิบาย `403 Forbidden`

Swagger เป็นเพียงเอกสารและช่องสำหรับกรอก token ใน Swagger UI การใส่ `ApiBearerAuth` อย่างเดียวไม่ได้ป้องกัน API ต้องมี `JwtAuthGuard` ด้วยเสมอ

ชื่อ `JWT_BEARER_AUTH` ต้องตรงกับชื่อที่ใช้ตอนลงทะเบียน security scheme ใน `DocumentBuilder.addBearerAuth(...)` มิฉะนั้นปุ่ม Authorize อาจไม่แนบ token ให้ endpoint นี้

### `auth-example.dto.ts`

กำหนด response ที่ Swagger และ TypeScript ใช้อ้างอิง มีข้อมูล:

- `message`: ข้อความยืนยันว่า request ผ่าน Guard แล้ว
- `userId`: ID ของผู้ใช้ปัจจุบัน
- `email`: อีเมลที่โหลดจากฐานข้อมูล
- `role`: role ปัจจุบันที่ `RolesGuard` ใช้ตรวจสิทธิ์

`@ApiProperty` ใช้สร้าง OpenAPI schema ไม่ได้ทำ runtime validation หากเป็น request body ควรใช้ validation decorators เช่น `class-validator` เพิ่มต่างหาก

### `auth-example.module.ts`

ลงทะเบียน `AuthExampleController` กับ NestJS ส่วน Auth dependencies มาจาก global `AuthModule` ที่ `AppModule` โหลดไว้แล้ว จึงไม่ต้อง import `AuthModule` ซ้ำใน module นี้

### `test/unit/examples/auth-example.controller.spec.ts`

ทดสอบทั้ง behavior และ OpenAPI contract:

- controller ส่งข้อมูลผู้ใช้ปัจจุบันกลับถูกต้อง
- endpoint กำหนด allowed roles เป็น `TUTOR` และ `ADMIN`
- Swagger มี Bearer security และ response `200`, `401`, `403`

## Request flow โดยละเอียด

```text
Client
  -> Authorization: Bearer <access-token>
  -> JwtAuthGuard
       1. อ่าน Bearer token จาก Authorization header
       2. ตรวจ signature, issuer, audience, type และวันหมดอายุ
       3. อ่าน sub (user ID) และ sid (session ID) จาก payload
       4. ตรวจ AuthSession ว่ายัง active และยังไม่หมดอายุ
       5. ตรวจ User ว่ายืนยันอีเมลแล้วและ accountStatus ยังใช้งานได้
       6. สร้าง request.auth จากข้อมูลปัจจุบันในฐานข้อมูล
  -> RolesGuard
       1. อ่าน allowed roles จาก @Roles(...)
       2. อ่าน role จาก request.auth
       3. อนุญาตเมื่อ role ตรงกับอย่างน้อยหนึ่งค่าที่กำหนด
  -> @CurrentUser()
       1. อ่าน request.auth จาก ExecutionContext
       2. ส่ง AuthenticatedUser เข้า parameter ของ controller
  -> Controller handler
```

ข้อมูลใน access-token payload มี `sub`, `sid`, `role`, `type`, `jti` และ standard JWT claims แต่ controller ไม่ควรถอด token เอง ให้ใช้ `@CurrentUser()` เพราะข้อมูลนี้ผ่านการตรวจจาก `JwtAuthGuard` และตรวจสถานะล่าสุดในฐานข้อมูลแล้ว

`AuthenticatedUser` มีรูปแบบดังนี้:

```ts
interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  sessionId: string;
}
```

แม้ token จะมี `role` แต่ `JwtAuthGuard` ใช้ role ปัจจุบันจาก `User` ในฐานข้อมูลเป็นค่าที่เชื่อถือได้ หาก admin เปลี่ยน role หรือระงับบัญชี สิทธิ์จึงเปลี่ยนตามสถานะล่าสุดโดยไม่ต้องรอ access token หมดอายุ

## ความแตกต่างระหว่าง 401 และ 403

`401 Unauthorized` หมายถึงระบบยังยืนยันตัวตนไม่ได้ ตัวอย่างเช่น:

- ไม่ส่ง Bearer token
- token ผิดรูปแบบ ลายเซ็นไม่ถูกต้อง หรือหมดอายุ
- token เป็น refresh token ไม่ใช่ access token
- session ถูก revoke หรือหมดอายุ
- user ไม่พบ ถูกลบ ถูก suspend หรือยังไม่ยืนยันอีเมล

`403 Forbidden` หมายถึงยืนยันตัวตนสำเร็จแล้ว แต่ role ไม่มีสิทธิ์ เช่น `STUDENT` เรียก endpoint ที่อนุญาตเฉพาะ `TUTOR` และ `ADMIN`

## Endpoint ที่ต้อง login แต่ไม่จำกัด role

ใช้ `JwtAuthGuard` อย่างเดียว หรือใช้ `RolesGuard` ร่วมด้วยแต่ไม่ใส่ `@Roles` ก็ได้ โดยแบบที่อ่านง่ายที่สุดคือ:

```ts
@Get('me')
@UseGuards(JwtAuthGuard)
getMe(@CurrentUser() user: AuthenticatedUser) {
  return user;
}
```

## Endpoint ที่จำกัด role

```ts
@Get('admin-only')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
getAdminOnly(@CurrentUser() user: AuthenticatedUser) {
  return { adminId: user.id };
}
```

ถ้า endpoint หลายเส้นใน controller ใช้ Guard ชุดเดียวกัน สามารถวาง `@UseGuards` ระดับ controller แล้วกำหนด `@Roles` แยกในแต่ละ method ได้ Method ที่ไม่ใส่ `@Roles` จะผ่าน `RolesGuard` สำหรับทุก role ที่ login แล้ว

## Endpoint ที่ตรวจ ownership

วาง `ResourceOwnershipGuard` หลัง authentication และ role authorization เสมอ:

```ts
@Get('listings/:listingId')
@UseGuards(JwtAuthGuard, RolesGuard, ResourceOwnershipGuard)
@Roles(Role.TUTOR, Role.ADMIN)
@RequireOwnership({
  resource: 'teachingListing',
  idParam: 'listingId',
  allowAdmin: true,
})
getListing() {
  // เรียก business service หลังผ่าน authentication, role และ ownership แล้ว
}
```

`RequireOwnership` รองรับ `tutorProfile`, `teachingListing`, `availabilitySlot` และ `booking` โดย guard จะค้นหา resource ID พร้อม owner scope ใน query เดียว สำหรับ booking จะเลือก `studentUserId` หรือ `tutorProfileId` ตาม role ปัจจุบัน

เมื่อ record ไม่มีอยู่, ID ผิดรูปแบบ หรือเป็น private record ของผู้ใช้อื่น guard จะตอบ `404 Resource not found` เหมือนกันทั้งหมด จึงไม่เปิดเผยว่า record ของผู้ใช้อื่นมีอยู่หรือไม่ ส่วน `allowAdmin` ต้องเปิดเป็นราย endpoint ตามสิทธิ์ใน access matrix

## การทดสอบผ่าน Swagger UI

1. เรียก `POST /api/v1/auth/login` ด้วยบัญชีที่ยืนยันอีเมลแล้ว
2. คัดลอก `accessToken` จาก response ไม่ใช่ refresh token
3. กด **Authorize** ใน Swagger UI
4. ใส่ access token ตามรูปแบบที่ UI ขอ
5. เรียก `GET /api/v1/examples/protected`
6. บัญชี `TUTOR` หรือ `ADMIN` ควรได้ `200`; บัญชี `STUDENT` ควรได้ `403`

Refresh token ถูกเก็บใน cookie `hktutor_refresh` และใช้กับ endpoint refresh/logout ไม่ควรนำ refresh token มาใส่ใน Bearer header
