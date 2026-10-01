# HKTutor Web Design Guidelines

เอกสารนี้เป็นแนวทางหลักสำหรับพัฒนา UI ใน `apps/web` ให้ต่อเนื่องกับ Notebook theme ปัจจุบัน
โดยเน้นความสม่ำเสมอ อ่านง่าย รองรับภาษาไทย และไม่สร้าง abstraction เกินความจำเป็นสำหรับโปรเจกต์ demo

โค้ด production และ tests ยังเป็น source of truth สำหรับ behavior, route, permission และ API contract
หากเอกสารนี้ไม่ตรงกับ behavior ที่ระบบรองรับ ให้รักษา behavior เดิมและแก้เอกสารให้ตรงกับโค้ด

## 1. Design principles

1. **Notebook, not decoration-first** — หน้าตาควรให้ความรู้สึกเหมือนสมุดเรียน แต่ลวดลายต้องไม่บังข้อความหรือทำให้ใช้งานยาก
2. **Clarity before novelty** — ลำดับข้อมูล, label, error และ action ต้องชัดกว่าความสวยงาม
3. **Reuse before creating** — ใช้ primitives ใน `components/ui/notebook.tsx` ก่อนสร้าง component หรือ style ใหม่
4. **Tailwind first** — styling ของ feature ใช้ Tailwind; CSS ใช้เฉพาะ texture, pseudo-element, token หรือ animation ที่ Tailwind ไม่เหมาะ
5. **Mobile and bilingual by default** — ทุกหน้าใหม่ต้องรองรับ mobile และข้อความ EN/TH ตั้งแต่เริ่ม
6. **Preserve behavior during redesign** — การเปลี่ยนหน้าตาไม่ควรเปลี่ยน validation, permission, API payload หรือ navigation โดยไม่ตั้งใจ
7. **Keep it small** — ไม่เพิ่ม UI library, animation library หรือ state-management library หาก primitives และ React ปัจจุบันเพียงพอ

## 2. Visual language

### 2.1 Core aesthetic

- พื้นกระดาษสีขาวอมครีม
- เส้นบรรทัดสีฟ้าอ่อนและเส้น margin สีชมพูแดง
- กระดาษกราฟสำหรับ preview, empty state หรือข้อมูลที่ต้องการแยกพื้นที่
- Sticky note สำหรับข้อความช่วยเหลือ, warning หรือ highlight สั้น ๆ
- Washi tape เป็นของตกแต่งตามมุม ไม่ใช่หัวข้อหรือ control
- เงานุ่มและขอบสีอุ่นเพื่อให้เหมือนกระดาษซ้อนกันบนโต๊ะเรียน
- ใช้การเอียงเล็กน้อยเฉพาะของตกแต่ง ไม่เอียง form, table หรือข้อความยาว

### 2.2 Color tokens

เพิ่มหรือแก้ token ที่ `apps/web/src/app/globals.css` ภายใน `@theme` แทนการกระจาย hex ใหม่ใน feature

| Purpose          | Token / Tailwind class                  | Value                |
| ---------------- | --------------------------------------- | -------------------- |
| Paper background | `paper`, `bg-paper`                     | `#fcfbf7`            |
| Secondary paper  | `paper-deep`, `bg-paper-deep`           | `#f7f3e8`            |
| Paper border     | `paper-edge`, `border-paper-edge`       | `#ddd6c7`            |
| Notebook lines   | `notebook-line`                         | `#e5e7eb`            |
| Margin guide     | `margin-guide`                          | `#fca5a5`            |
| Primary text     | `notebook-ink`, `text-notebook-ink`     | `#292524`            |
| Muted text       | `notebook-muted`, `text-notebook-muted` | `#78716c`            |
| Yellow note      | `sticky-yellow`                         | `#fef9c3`            |
| Pink note        | `sticky-pink`                           | `#fce7f3`            |
| Blue note        | `sticky-blue`                           | `#dbeafe`            |
| Green note       | `sticky-green`                          | `#dcfce7`            |
| Student accent   | `student`, `student-deep`               | `#22c49a`, `#0e8a73` |
| Tutor accent     | `tutor`, `tutor-deep`                   | `#0e8eea`, `#0b6db0` |
| Admin accent     | `admin`, `admin-deep`                   | `#d18b43`, `#b26f28` |

Role color ใช้เพื่อบอกบริบทและ active state แต่ห้ามใช้สีเพียงอย่างเดียวในการสื่อความหมาย
ต้องมีข้อความ, icon หรือ status label ประกอบเสมอ

### 2.3 Typography

- Body และ form: **Bai Jamjuree** ผ่าน `--font-bai-jamjuree`
- Handwritten annotation ภาษาอังกฤษ: **Caveat**
- Handwritten annotation ภาษาไทย: **Mali**
- ใช้ `font-note` เฉพาะ eyebrow, caption, note หรือข้อความสั้น
- เนื้อหา, label, input, table และข้อความที่ต้องอ่านต่อเนื่องใช้ body font
- Heading ใช้น้ำหนัก `700` และ tracking ติดลบเล็กน้อย เช่น `tracking-[-0.045em]`
- หลีกเลี่ยงตัวพิมพ์ใหญ่ทั้งหมดในภาษาไทย
- ข้อความที่มาจากผู้ใช้ต้องรองรับการตัดบรรทัดด้วย `break-words` และ `[overflow-wrap:anywhere]` เมื่อจำเป็น

### 2.4 Shape and elevation

- Main paper card: `rounded-[1.5rem]`
- Graph paper: `rounded-[1.25rem]`
- Form control และ button: `rounded-lg`
- Badge/chip: `rounded-full`
- ใช้ `shadow-paper` สำหรับ card หลัก และ `shadow-note` สำหรับ sticky note
- อย่าเพิ่มเงาหนักหลายชั้นในหน้าหนึ่ง เพราะจะทำให้ theme ดูเป็น dashboard ทั่วไปแทนสมุดเรียน

## 3. Shared Notebook primitives

ใช้ component จาก `apps/web/src/components/ui/notebook.tsx`

| Component / helper    | ใช้เมื่อ                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| `NotebookPage`        | เป็น root surface ของหน้า Notebook; เลือก `ruled`, `grid` หรือ `plain` |
| `PaperCard`           | กลุ่มข้อมูลหรือ form หลัก                                              |
| `GraphPaper`          | Preview, summary, empty state หรือพื้นที่ข้อมูลย่อย                    |
| `StickyNote`          | Hint, warning, callout หรือข้อความช่วยเหลือสั้น ๆ                      |
| `WashiTape`           | ของตกแต่งมุม card เท่านั้น                                             |
| `NotebookHeading`     | Page heading ที่มี eyebrow, title และ description                      |
| `NotebookButton`      | ปุ่มทั่วไปที่ไม่ต้องประกอบ element พิเศษ                               |
| `notebookButtonClass` | Link หรือ element ที่ต้องใช้หน้าตาเหมือนปุ่ม                           |
| `notebookInputClass`  | Input, select และ textarea                                             |
| `NotebookField`       | Label + control + hint/error                                           |
| `StatusBadge`         | สถานะที่ต้องใช้ทั้งสีและข้อความ                                        |

### Washi tape rules

- Parent ต้องเป็น `relative` และมักใช้ `overflow-hidden`
- Tape ต้องมี `aria-hidden="true"` ซึ่ง `WashiTape` กำหนดไว้แล้ว
- วางที่มุมหรือขอบ card และไม่ทับ heading, label, icon หรือ interactive element
- ใช้ไม่เกินหนึ่งชิ้นต่อ card ในกรณีทั่วไป
- มุมที่แนะนำ: `-left-5 top-2 rotate-[-36deg]` หรือ `-right-5 top-3 rotate-12`
- ห้ามวาง tape กึ่งกลางเหนือข้อความ เพราะทำให้ visual center ของเนื้อหาดูคลาดเคลื่อน

สีของ tape และ note:

- Yellow: highlight หรือสถานะทั่วไป
- Pink: error, caution หรือ decorative accent
- Blue: tutor/info
- Green sticky note: success/student

## 4. Page composition

### Public and authentication pages

- ใช้ `AuthShell` เพื่อให้ header, language control, background และ footer เหมือนกัน
- จำกัดความกว้าง form card และจัดกึ่งกลาง
- Form action หลักต้องเห็นได้ชัดโดยไม่ต้อง scroll บน viewport ทั่วไป หากเนื้อหาไม่ยาวเกินไป
- Link รอง เช่น Login/Register/Privacy ต้องไม่แข่งขันกับ primary action

### Authenticated pages

- ใช้ `DashboardShell` เป็น shell หลัก ห้ามสร้าง sidebar ซ้ำใน feature
- Navigation ต้องมาจาก `dashboard-navigation.ts` และแสดงเฉพาะ route ที่ implement แล้ว
- Sidebar ต้องรองรับ expanded, collapsed และ mobile drawer
- ข้อมูลผู้ใช้และ Sign out อยู่ด้านล่างของ sidebar
- ส่ง `userAvatarUrl` เมื่อ API รองรับรูปจริง; หากไม่มีให้ใช้ initial fallback
- Main content ใช้ `min-w-0` ใน grid/flex เพื่อป้องกันข้อความดัน layout ล้น

โครงสร้างหน้าทั่วไป:

```tsx
<DashboardShell user={user} onLogout={logout}>
  <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <NotebookHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <div className="mt-6 grid min-w-0 gap-5 lg:grid-cols-2">
      <PaperCard className="min-w-0 overflow-hidden p-5 sm:p-6">...</PaperCard>
      <GraphPaper className="min-w-0 p-5">...</GraphPaper>
    </div>
  </main>
</DashboardShell>
```

ปรับจำนวน column ตามเนื้อหา ไม่จำเป็นต้องใช้สอง column ทุกหน้า

## 5. Responsive behavior

ออกแบบแบบ mobile-first และทดสอบอย่างน้อยที่ความกว้างประมาณ 375px, 768px และ 1280px

- เริ่มด้วยหนึ่ง column แล้วเพิ่ม column ที่ `md` หรือ `lg`
- Action row ใช้ `flex-wrap` หรือเปลี่ยนเป็นแนวตั้งบน mobile
- หลีกเลี่ยง fixed width; ใช้ `w-full`, `max-w-*`, `minmax(0, 1fr)` และ `min-w-0`
- Card ต้องไม่ทำให้เกิด horizontal page scroll
- ข้อความ, email, ราคา และ user-generated description ต้อง wrap ได้
- Control ที่แตะได้ควรสูงอย่างน้อย 44px; primitives ปัจจุบันใช้ `min-h-11` หรือ `min-h-12`
- Modal/drawer ต้องปิดด้วย Escape, จัดการ focus และล็อก body scroll เมื่อเปิด
- เส้น margin guide สามารถซ่อนบนจอเล็กได้หากรบกวนพื้นที่เนื้อหา

## 6. Forms and feedback

### Forms

- ทุก control ต้องมี label ที่เชื่อมด้วย `htmlFor`/`id`
- แสดง validation error ใกล้ field ที่แก้ได้ ไม่ใช้ toast แทน field error
- ใช้ `aria-invalid` และ `aria-describedby` เมื่อมี error/hint ที่เกี่ยวข้อง
- Error summary ใช้ `role="alert"` เมื่อเป็น error ระดับ form หรือ load failure
- Disable submit ระหว่าง request และแสดงข้อความสถานะที่ชัดเจน
- อย่าซ่อน form ทั้งหน้าเพราะ optional catalog หรือ dependency โหลดไม่ได้; ปิดเฉพาะ control/action ที่ใช้งานไม่ได้และอธิบายสาเหตุ

ตัวอย่าง field:

```tsx
<NotebookField label={copy.subject} htmlFor="subject" error={errors.subject}>
  <select
    id="subject"
    className={notebookInputClass({ error: Boolean(errors.subject) })}
    aria-invalid={Boolean(errors.subject)}
  >
    ...
  </select>
</NotebookField>
```

### Toast

ใช้ `useNotebookToast()` จาก `components/ui/notebook-toast.tsx` สำหรับผลของ action ที่จบแล้ว เช่น save,
publish, restore, add หรือ delete

```tsx
const toast = useNotebookToast();

toast.success(copy.saved);
toast.error(copy.saveError);
```

ข้อกำหนดปัจจุบัน:

- ตำแหน่ง `top-center`
- รองรับ `success` และ `error`
- ปิดอัตโนมัติประมาณ 2 วินาที ไม่มีปุ่มปิด
- มี enter/exit animation และ animated success/error mark
- Tape พาดเฉียงที่มุมซ้ายบน ไม่วางเหนือข้อความ
- รองรับ `aria-live`, `role="status"`/`role="alert"` และ `prefers-reduced-motion`
- อย่าใช้ toast กับ validation ที่ผู้ใช้ต้องย้อนกลับไปแก้ field
- ไม่เพิ่ม toast dependency เว้นแต่ requirement ในอนาคตเกินความสามารถของ provider ปัจจุบันอย่างชัดเจน

## 7. Avatar and user identity

Component ที่แสดง identity ต้องรองรับรูปโปรไฟล์ในอนาคตโดยไม่ทำให้หน้าที่ไม่มีรูปแตก

ลำดับ fallback:

1. แสดงรูปเมื่อมี URL ที่ใช้งานได้
2. หากไม่มีรูป ใช้อักษรตัวแรกของ display name
3. หากไม่มีชื่อ ใช้ fallback ที่เหมาะกับบริบท เช่น `U` หรือ `T`

ข้อกำหนด:

- รูปใช้ `object-cover` และครอบด้วยวงกลม `overflow-hidden`
- กำหนดขนาดรูปด้วย `sizes` เมื่อใช้ `next/image`
- Container ใช้ชื่อผู้ใช้เป็น accessible label; รูปภายในใช้ `alt=""` เพื่อไม่ให้อ่านชื่อซ้ำ
- ห้ามแสดง email เป็น fallback avatar
- ใช้ role color กับ initial fallback เท่านั้น ไม่ tint รูปจริง

## 8. Language and copy

- UI ที่ผู้ใช้เห็นต้องรองรับ EN/TH ผ่าน `useLanguage()` และ `lib/i18n.tsx`
- เพิ่ม key ทั้งสองภาษาใน change เดียวกัน
- ห้ามฝังข้อความภาษาเดียวใน component หากข้อความนั้นปรากฏต่อผู้ใช้
- ข้อความที่ใช้ร่วมกันทั้งแอป เช่น shell, navigation และ generic action อยู่ใน `lib/i18n.tsx`
- ข้อความเฉพาะ feature อยู่ใน `*-copy.ts` ใกล้ feature และ export เป็น `{ en, th }` ที่มีโครงสร้างเดียวกัน
- Copy เดิมที่ยังอยู่ท้าย component ให้ย้ายเมื่อแก้ feature นั้นครั้งถัดไป ห้ามเพิ่มชุดใหม่ใน component
- ทุกชุด copy ที่ export ต้องถูกเพิ่มใน recursive EN/TH symmetry test ที่ `apps/web/test/i18n.test.ts`
- ใช้ `Intl` และ helper กลางสำหรับวันที่, เวลา, จำนวนเงิน และปี พ.ศ./ค.ศ.
- เวลา booking/availability แสดงตาม Bangkok time ตาม helper ที่มีอยู่ ห้าม format ISO เองใน component
- Copy ต้องสั้น ตรงไปตรงมา และบอก action หรือผลลัพธ์ ไม่ใช้ข้อความเทคนิคจาก backend โดยตรงหากไม่ช่วยผู้ใช้

## 9. Accessibility and motion

ทุกหน้าหรือ component ใหม่ต้องตรวจรายการต่อไปนี้:

- ใช้ semantic HTML และ heading ตามลำดับ
- Icon-only button มี `aria-label`
- Decorative element มี `aria-hidden="true"`
- Focus state มองเห็นได้ด้วย `focus-visible:ring-*`
- Keyboard ใช้งาน navigation, modal และ form ได้ครบ
- Error ไม่สื่อด้วยสีอย่างเดียว
- สีข้อความและขอบสำคัญมี contrast เพียงพอ
- ไม่ปิด pinch-to-zoom ใน viewport config
- Animation ต้องไม่จำเป็นต่อการเข้าใจ state
- Global `prefers-reduced-motion` ต้องยังครอบคลุม animation ใหม่
- Loading, empty, error และ success state ต้องแยกกันชัดเจน

## 10. CSS and component boundaries

### Put styles here

- Tailwind class ใน component: layout, spacing, typography, responsive, state และสีจาก token
- `notebook.module.css`: ruled/grid texture, folded corner, tape texture และ pseudo-element ของ primitives
- `globals.css`: Tailwind theme tokens, reset, font defaults, shared keyframes และ legacy shared classes ที่ยังใช้งานจริง

### Avoid

- เพิ่ม feature-specific selector จำนวนมากใน `globals.css`
- เพิ่ม hex ใหม่เมื่อมี token ที่ใกล้เคียงอยู่แล้ว
- ทำ component ใหม่ที่เป็นเพียง wrapper ของ Tailwind 1–2 class และใช้ครั้งเดียว
- แยก component ทุก section โดยไม่มีเหตุผลด้าน reuse, complexity หรือ ownership
- ใช้ inline style ยกเว้นค่าที่คำนวณจาก runtime และ Tailwind อธิบายไม่ได้ชัดเจน

เมื่อไฟล์ feature ใหญ่ ให้แยกตามสิ่งที่เปลี่ยนคนละเหตุผล:

- `*-copy.ts` — ข้อความของ feature
- `*-validation.ts` หรือ `*-model.ts` — validation, mapping และ pure logic
- `*-form.tsx` — form ที่มี state/markup จำนวนมาก
- `*-preview.tsx` — preview ที่แก้แยกจาก form
- Page component — session gate, fetching, submit และ orchestration

ไม่ต้องแยกไฟล์เพียงเพราะจำนวนบรรทัดถึงค่าหนึ่ง

## 11. Do and don't

| Do                                   | Don't                                         |
| ------------------------------------ | --------------------------------------------- |
| ใช้ `PaperCard` และ token ที่มีอยู่  | สร้าง white card พร้อม hex/shadow ใหม่ทุกหน้า |
| วาง tape ที่มุมและให้เป็น decorative | วาง tape ทับ heading หรือ control             |
| ใช้ sticky note กับข้อความสั้น       | ใส่ form หรือตารางใหญ่ลง sticky note          |
| ใช้ handwritten font กับ annotation  | ใช้ handwritten font กับ body ยาวหรือ input   |
| แสดง field error ใกล้ field          | แสดง validation ทุกอย่างด้วย toast            |
| ใช้ role accent อย่างมีความหมาย      | เปลี่ยนทั้งหน้าเป็นสี role จน contrast ลดลง   |
| รองรับ initial เมื่อไม่มี avatar     | สมมติว่าผู้ใช้ทุกคนมีรูป                      |
| เพิ่ม copy EN/TH พร้อมกัน            | hardcode ข้อความภาษาเดียวใน JSX               |
| ทดสอบ mobile และ keyboard            | ตรวจเฉพาะ desktop ด้วย mouse                  |

## 12. Review checklist

ก่อนส่ง PR ที่เพิ่มหรือแก้ UI ให้ตรวจว่า:

- [ ] ใช้ Notebook primitive และ token เดิมก่อนสร้างของใหม่
- [ ] ไม่มี tape หรือ decoration ทับเนื้อหา
- [ ] หน้าไม่เกิด horizontal scroll ที่ mobile
- [ ] ข้อความจากผู้ใช้ wrap ได้
- [ ] Loading, empty, error และ success state ครบ
- [ ] Form label/error และ ARIA เชื่อมกันถูกต้อง
- [ ] Keyboard focus มองเห็นและ flow ใช้งานได้
- [ ] EN/TH มี key ครบและ layout ไม่แตกเมื่อข้อความยาวต่างกัน
- [ ] Role และ permission ไม่ถูกอนุมานจาก UI state หรือ URL
- [ ] Redesign ไม่เปลี่ยน API payload หรือ behavior โดยไม่ตั้งใจ
- [ ] Animation รองรับ reduced motion
- [ ] ไม่มี dependency ใหม่ที่ไม่จำเป็น
- [ ] Tests ที่อ้างถึงไฟล์หรือ markup เดิมถูกปรับตามโครงสร้างใหม่

คำสั่งตรวจพื้นฐาน:

```bash
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/web test
pnpm --filter @hktutor/web build
pnpm verify:workspace
pnpm format:check
```

## 13. Source map

- Theme tokens/reset/keyframes: `apps/web/src/app/globals.css`
- Fonts/root providers: `apps/web/src/app/layout.tsx`
- Notebook primitives: `apps/web/src/components/ui/notebook.tsx`
- Notebook textures: `apps/web/src/components/ui/notebook.module.css`
- Toast: `apps/web/src/components/ui/notebook-toast.tsx`
- Public/Auth shell: `apps/web/src/components/auth-shell.tsx`
- Dashboard/sidebar shell: `apps/web/src/components/dashboard/dashboard-shell.tsx`
- Role navigation: `apps/web/src/lib/dashboard-navigation.ts`
- Language copy/provider: `apps/web/src/lib/i18n.tsx`
- Session/profile gate: `apps/web/src/lib/use-profile-session.ts`
- Cached current profile: `apps/web/src/lib/current-profile.ts`

เมื่อเปลี่ยน design foundation ให้แก้เอกสารนี้, primitives และ tests ที่เกี่ยวข้องใน PR เดียวกัน
เพื่อไม่ให้ทีมต้องเดาว่า pattern ใดเป็นแนวทางล่าสุด
