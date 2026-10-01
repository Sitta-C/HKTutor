import { PRIVACY_POLICY_VERSION } from '@/lib/privacy-notice';

import type { Language } from '@/lib/i18n';
import type { PrivacyNotice } from '@/lib/privacy-notice';

export interface PrivacyNoticeCopy extends PrivacyNotice {
  readonly close: string;
  readonly closeLabel: string;
  readonly effectiveLabel: string;
  readonly versionLabel: string;
}

export const privacyNoticeCopy = {
  en: {
    title: 'HKTutor Privacy Notice',
    version: PRIVACY_POLICY_VERSION,
    versionLabel: 'Version',
    effectiveDate: '30 September 2026',
    effectiveLabel: 'Effective',
    close: 'Close',
    closeLabel: 'Close privacy notice',
    summary:
      'HKTutor is an online tutor marketplace built as a university course project. This notice explains which account, profile, education, contact, and activity data HKTutor collects, who can see it, why it is needed, and how long it is kept. You must accept this notice before HKTutor creates your account record or saves your profile.',
    sections: [
      {
        heading: '1. Who is responsible for your data',
        paragraphs: [
          'The HKTutor project team operates this service as a student team project and decides why and how personal data is processed. The team runs the Next.js web application and the NestJS API that together form HKTutor.',
          'Because HKTutor is a course project, the platform is used for demonstration and coursework assessment. Do not upload personal data that you would not want reviewed by the project team or the course staff.',
        ],
        bullets: [],
      },
      {
        heading: '2. How sign-in credentials are processed',
        paragraphs: [
          'HKTutor operates its own sign-up, sign-in, email verification, and session system. The API stores a one-way password hash rather than your password and issues short-lived access tokens plus a refresh-session cookie.',
          'HKTutor uses Resend to deliver account verification emails. Resend processes the recipient address and delivery metadata needed to send those messages.',
        ],
        bullets: [
          'Account security data includes your email address, password hash, email verification state, and revocable refresh-session records.',
          'Verification links are random, expire after a limited period, and are stored by HKTutor only as one-way hashes.',
        ],
      },
      {
        heading: '3. What HKTutor stores about you',
        paragraphs: [
          'The HKTutor API stores application data in a managed Supabase PostgreSQL database, and stores tutor qualification documents in a private Supabase storage bucket that is only reachable through short-lived signed links issued by the API.',
        ],
        bullets: [
          'Account record: email address, password hash, role (student or tutor), account status, the time you accepted this notice, and the version you accepted.',
          'Student profile: first name, last name, nickname, school, grade level, and telephone number. The telephone number is treated as a private emergency contact field.',
          'Tutor profile: first name, last name, nickname, public display name, biography, years of experience, verification status, teaching listings, prices, and availability slots.',
          'Activity records: bookings, cancellations and reschedule requests, chat messages with the other party, notifications, reviews you write, and mock payment references.',
          'Security records: an append-only audit log of security-relevant actions, holding the acting account, the action, and a redacted snapshot of what changed.',
        ],
      },
      {
        heading: '4. Why HKTutor needs this data',
        paragraphs: [
          'Each category of data is collected for a stated purpose and is not reused for unrelated purposes.',
        ],
        bullets: [
          'To create and secure your account, and to apply the role and ownership rules that keep your records private from other users.',
          'To identify you inside your own account, complete role-specific onboarding, and let you review and correct your profile.',
          'To use a student’s school and grade level to support relevant tutoring and matching features.',
          'To let an authorised project administrator contact a student about an urgent class, safety, or service incident. Student telephone numbers are not used for marketing.',
          'To let students search tutors, and to let tutors publish listings and availability.',
          'To create, confirm, reschedule, cancel, and complete bookings, and to send you the related in-app notifications and reminders.',
          'To verify tutor qualifications before a listing may be published.',
          'To investigate misuse and to keep an accurate record of security-relevant changes.',
        ],
      },
      {
        heading: '5. Consent is required before your account is created',
        paragraphs: [
          'Accepting this notice is a required step of registration and profile onboarding. If you do not accept it, HKTutor creates no account record and saves no tutor or student profile.',
          'When you accept, HKTutor records the moment of acceptance and the version of this notice shown to you, so it is always clear which wording you agreed to. Re-submitting the same onboarding form does not create a second account.',
          'You may withdraw consent by asking the project team to delete your account. Withdrawal does not undo processing that already took place, and records that another user relies on, such as a completed booking, are retained as described below.',
        ],
        bullets: [],
      },
      {
        heading: '6. Who else can see your data',
        paragraphs: [
          'HKTutor does not sell personal data and shows no advertising. Data is shared only where the service cannot work without it.',
        ],
        bullets: [
          'Resend, as the verification-email delivery processor described in section 2.',
          'Supabase, as the managed database and private file storage processor.',
          'Students and visitors may see a tutor’s public display name, biography, experience, verification state, listings, ratings, and availability where the product permits it.',
          'A tutor connected to a booking may see the student’s nickname and the class details needed to teach. The student’s first name, last name, school, grade level, and telephone number are not part of a public tutor or search response.',
          'Authorised project administrators may access private profile data when needed for account support, an urgent class or safety incident, security, or course-project administration.',
          'Project administrators, who review tutor verification documents and security audit records.',
        ],
      },
      {
        heading: '7. How long data is kept',
        paragraphs: [
          'Account and profile data is kept while the account is active. Deleted accounts, listings, and availability may be deactivated rather than immediately erased so bookings, payments, reviews, security records, and other users’ records remain accurate. Private profile data is not used for new activity after account deletion.',
          'When the course project ends, the shared demonstration database and storage bucket are the project team responsibility and may be removed together with the data they hold.',
        ],
        bullets: [],
      },
      {
        heading: '8. Your choices and how to contact us',
        paragraphs: [
          'You can ask the project team to access, correct, receive a copy of, restrict, object to, or delete your personal data, and you may withdraw consent where consent is the applicable basis. Some requests may be limited where HKTutor must preserve another user’s transaction or comply with an applicable obligation.',
          'Contact route: the HKTutor project team, through the contact address published in the project repository README. This is a course project, so please allow for reply times outside teaching hours.',
        ],
        bullets: [],
      },
      {
        heading: '9. How your data is protected',
        paragraphs: [
          'The API is the only component that talks to the database and to file storage. Browser code never receives a database connection string or a service key.',
        ],
        bullets: [
          'All deployed connections between the browser, the API, Resend, and Supabase use TLS.',
          'Every request to a protected endpoint is checked against the signed JWT session and then against local role, account status, and ownership rules.',
          'Tutor documents live in a private bucket and are opened only through signed links that expire within minutes.',
          'Session tokens, database credentials, and service keys are never written to logs, API documentation, or error responses.',
        ],
      },
      {
        heading: '10. Changes to this notice',
        paragraphs: [
          `If the wording changes in a way that affects what is collected or why, HKTutor publishes the notice under a new version and asks you to accept it again before you continue. The current version is ${PRIVACY_POLICY_VERSION}.`,
        ],
        bullets: [],
      },
    ],
  },
  th: {
    title: 'ประกาศความเป็นส่วนตัวของ HKTutor',
    version: PRIVACY_POLICY_VERSION,
    versionLabel: 'เวอร์ชัน',
    effectiveDate: '30 กันยายน 2569',
    effectiveLabel: 'มีผลตั้งแต่',
    close: 'ปิด',
    closeLabel: 'ปิดประกาศความเป็นส่วนตัว',
    summary:
      'HKTutor เป็นแพลตฟอร์มค้นหาติวเตอร์ออนไลน์ที่สร้างขึ้นเป็นโครงงานรายวิชาในมหาวิทยาลัย ประกาศนี้อธิบายว่า HKTutor เก็บข้อมูลบัญชี โปรไฟล์ การศึกษา การติดต่อ และกิจกรรมใดบ้าง ใครสามารถเห็นข้อมูล เหตุใดจึงจำเป็นต้องใช้ และเก็บไว้นานเท่าใด คุณต้องยอมรับประกาศนี้ก่อนที่ HKTutor จะสร้างบัญชีหรือบันทึกโปรไฟล์ของคุณ',
    sections: [
      {
        heading: '1. ผู้รับผิดชอบข้อมูลของคุณ',
        paragraphs: [
          'ทีมโครงการ HKTutor ให้บริการระบบนี้ในฐานะโครงงานของทีมนักศึกษา และเป็นผู้กำหนดวัตถุประสงค์และวิธีการประมวลผลข้อมูลส่วนบุคคล ทีมดูแลเว็บแอปพลิเคชัน Next.js และ NestJS API ซึ่งทำงานร่วมกันเป็นระบบ HKTutor',
          'เนื่องจาก HKTutor เป็นโครงงานรายวิชา แพลตฟอร์มนี้จึงใช้สำหรับการสาธิตและการประเมินผลงาน โปรดอย่าอัปโหลดข้อมูลส่วนบุคคลที่คุณไม่ต้องการให้ทีมโครงการหรือบุคลากรของรายวิชาตรวจสอบ',
        ],
        bullets: [],
      },
      {
        heading: '2. การประมวลผลข้อมูลสำหรับเข้าสู่ระบบ',
        paragraphs: [
          'HKTutor ดูแลระบบสมัครสมาชิก เข้าสู่ระบบ ยืนยันอีเมล และเซสชันด้วยตนเอง API จัดเก็บค่าแฮชรหัสผ่านแบบทางเดียวแทนการเก็บรหัสผ่านจริง และออก access token อายุสั้นพร้อมคุกกี้ refresh session',
          'HKTutor ใช้ Resend เพื่อส่งอีเมลยืนยันบัญชี โดย Resend ประมวลผลอีเมลผู้รับและข้อมูลการจัดส่งที่จำเป็นต่อการส่งข้อความดังกล่าว',
        ],
        bullets: [
          'ข้อมูลความปลอดภัยของบัญชีประกอบด้วยอีเมล ค่าแฮชรหัสผ่าน สถานะการยืนยันอีเมล และข้อมูล refresh session ที่สามารถเพิกถอนได้',
          'ลิงก์ยืนยันถูกสร้างแบบสุ่ม มีอายุจำกัด และ HKTutor จัดเก็บเฉพาะค่าแฮชแบบทางเดียว',
        ],
      },
      {
        heading: '3. ข้อมูลที่ HKTutor จัดเก็บเกี่ยวกับคุณ',
        paragraphs: [
          'HKTutor API จัดเก็บข้อมูลแอปพลิเคชันในฐานข้อมูล Supabase PostgreSQL ที่มีการจัดการให้ และจัดเก็บเอกสารคุณสมบัติของติวเตอร์ใน private Supabase storage bucket ซึ่งเปิดได้ผ่านลิงก์ลงนามอายุสั้นที่ออกโดย API เท่านั้น',
        ],
        bullets: [
          'ข้อมูลบัญชี: อีเมล ค่าแฮชรหัสผ่าน บทบาท (นักเรียนหรือติวเตอร์) สถานะบัญชี เวลาที่ยอมรับประกาศนี้ และเวอร์ชันที่ยอมรับ',
          'โปรไฟล์นักเรียน: ชื่อ นามสกุล ชื่อเล่น โรงเรียน ระดับชั้น และเบอร์โทรศัพท์ โดยเบอร์โทรศัพท์ถือเป็นข้อมูลติดต่อฉุกเฉินส่วนตัว',
          'โปรไฟล์ติวเตอร์: ชื่อ นามสกุล ชื่อเล่น ชื่อสาธารณะ ประวัติแนะนำตัว จำนวนปีประสบการณ์ สถานะการยืนยัน ประกาศสอน ราคา และช่วงเวลาว่าง',
          'ข้อมูลกิจกรรม: การจอง การยกเลิกและคำขอเลื่อนเวลา ข้อความแชตกับอีกฝ่าย การแจ้งเตือน รีวิวที่คุณเขียน และเลขอ้างอิงการชำระเงินจำลอง',
          'ข้อมูลความปลอดภัย: บันทึกเหตุการณ์ด้านความปลอดภัยแบบเพิ่มข้อมูลต่อท้ายเท่านั้น ซึ่งระบุบัญชีผู้ดำเนินการ การกระทำ และภาพรวมข้อมูลที่เปลี่ยนแปลงโดยปกปิดข้อมูลสำคัญ',
        ],
      },
      {
        heading: '4. เหตุผลที่ HKTutor ต้องใช้ข้อมูลนี้',
        paragraphs: [
          'ข้อมูลแต่ละประเภทถูกเก็บเพื่อวัตถุประสงค์ที่ระบุไว้ และจะไม่นำไปใช้เพื่อวัตถุประสงค์อื่นที่ไม่เกี่ยวข้อง',
        ],
        bullets: [
          'เพื่อสร้างและรักษาความปลอดภัยของบัญชี รวมถึงใช้กฎบทบาทและความเป็นเจ้าของเพื่อป้องกันไม่ให้ผู้ใช้อื่นเข้าถึงข้อมูลส่วนตัวของคุณ',
          'เพื่อระบุตัวคุณภายในบัญชี ดำเนินขั้นตอนเริ่มต้นตามบทบาท และให้คุณตรวจสอบหรือแก้ไขโปรไฟล์',
          'เพื่อใช้โรงเรียนและระดับชั้นของนักเรียนสนับสนุนการสอนและการจับคู่ที่เกี่ยวข้อง',
          'เพื่อให้ผู้ดูแลโครงการที่ได้รับอนุญาตติดต่อนักเรียนในกรณีเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือบริการ โดยจะไม่ใช้เบอร์โทรศัพท์นักเรียนเพื่อการตลาด',
          'เพื่อให้นักเรียนค้นหาติวเตอร์ และให้ติวเตอร์เผยแพร่ประกาศสอนกับช่วงเวลาว่าง',
          'เพื่อสร้าง ยืนยัน เลื่อน ยกเลิก และดำเนินการจองให้เสร็จสิ้น รวมถึงส่งการแจ้งเตือนและคำเตือนที่เกี่ยวข้อง',
          'เพื่อตรวจสอบคุณสมบัติของติวเตอร์ก่อนอนุญาตให้เผยแพร่ประกาศสอน',
          'เพื่อตรวจสอบการใช้งานที่ไม่เหมาะสมและเก็บบันทึกการเปลี่ยนแปลงที่เกี่ยวข้องกับความปลอดภัยอย่างถูกต้อง',
        ],
      },
      {
        heading: '5. ต้องให้ความยินยอมก่อนสร้างบัญชี',
        paragraphs: [
          'การยอมรับประกาศนี้เป็นขั้นตอนบังคับของการสมัครสมาชิกและการกรอกโปรไฟล์ครั้งแรก หากคุณไม่ยอมรับ HKTutor จะไม่สร้างบัญชีหรือบันทึกโปรไฟล์นักเรียนหรือติวเตอร์',
          'เมื่อคุณยอมรับ HKTutor จะบันทึกเวลาที่ให้ความยินยอมและเวอร์ชันของประกาศที่แสดง เพื่อให้ตรวจสอบได้ว่าคุณยอมรับข้อความชุดใด การส่งแบบฟอร์มเริ่มต้นเดิมซ้ำจะไม่สร้างบัญชีที่สอง',
          'คุณสามารถถอนความยินยอมโดยขอให้ทีมโครงการลบบัญชี การถอนความยินยอมไม่ย้อนกลับการประมวลผลที่เกิดขึ้นแล้ว และข้อมูลที่ผู้ใช้อื่นต้องอาศัย เช่น การจองที่เสร็จสิ้นแล้ว จะถูกเก็บตามรายละเอียดด้านล่าง',
        ],
        bullets: [],
      },
      {
        heading: '6. บุคคลอื่นที่สามารถเห็นข้อมูลของคุณ',
        paragraphs: [
          'HKTutor ไม่ขายข้อมูลส่วนบุคคลและไม่แสดงโฆษณา ระบบจะแบ่งปันข้อมูลเฉพาะกรณีที่จำเป็นต่อการให้บริการเท่านั้น',
        ],
        bullets: [
          'Resend ในฐานะผู้ประมวลผลสำหรับส่งอีเมลยืนยันตามที่อธิบายในหัวข้อ 2',
          'Supabase ในฐานะผู้ให้บริการฐานข้อมูลและพื้นที่จัดเก็บไฟล์ส่วนตัว',
          'นักเรียนและผู้เยี่ยมชมอาจเห็นชื่อสาธารณะ ประวัติแนะนำตัว ประสบการณ์ สถานะการยืนยัน ประกาศสอน คะแนน และเวลาว่างของติวเตอร์ในส่วนที่ผลิตภัณฑ์อนุญาต',
          'ติวเตอร์ที่เกี่ยวข้องกับการจองอาจเห็นชื่อเล่นของนักเรียนและรายละเอียดชั้นเรียนที่จำเป็นต่อการสอน ชื่อ นามสกุล โรงเรียน ระดับชั้น และเบอร์โทรศัพท์ของนักเรียนจะไม่อยู่ในข้อมูลตอบกลับสาธารณะหรือผลการค้นหาติวเตอร์',
          'ผู้ดูแลโครงการที่ได้รับอนุญาตอาจเข้าถึงข้อมูลโปรไฟล์ส่วนตัวเมื่อจำเป็นต่อการช่วยเหลือบัญชี เหตุเร่งด่วนเกี่ยวกับชั้นเรียนหรือความปลอดภัย การรักษาความปลอดภัย หรือการบริหารโครงการรายวิชา',
          'ผู้ดูแลโครงการที่ตรวจสอบเอกสารยืนยันคุณสมบัติของติวเตอร์และบันทึกเหตุการณ์ด้านความปลอดภัย',
        ],
      },
      {
        heading: '7. ระยะเวลาการเก็บข้อมูล',
        paragraphs: [
          'ข้อมูลบัญชีและโปรไฟล์จะถูกเก็บไว้ขณะที่บัญชียังใช้งานอยู่ บัญชี ประกาศสอน และเวลาว่างที่ถูกลบอาจถูกปิดใช้งานแทนการลบทันที เพื่อให้ข้อมูลการจอง การชำระเงิน รีวิว บันทึกความปลอดภัย และข้อมูลของผู้ใช้อื่นยังถูกต้อง ข้อมูลโปรไฟล์ส่วนตัวจะไม่ถูกใช้กับกิจกรรมใหม่หลังลบบัญชี',
          'เมื่อโครงงานรายวิชาสิ้นสุด ฐานข้อมูลสาธิตและ storage bucket ที่ใช้ร่วมกันอยู่ภายใต้ความรับผิดชอบของทีมโครงการ และอาจถูกลบพร้อมข้อมูลที่จัดเก็บอยู่',
        ],
        bullets: [],
      },
      {
        heading: '8. ทางเลือกของคุณและช่องทางติดต่อ',
        paragraphs: [
          'คุณสามารถขอให้ทีมโครงการเข้าถึง แก้ไข ส่งสำเนา จำกัด คัดค้าน หรือลบข้อมูลส่วนบุคคลของคุณ และสามารถถอนความยินยอมเมื่อความยินยอมเป็นฐานในการประมวลผล คำขอบางรายการอาจมีข้อจำกัดหาก HKTutor ต้องเก็บธุรกรรมของผู้ใช้อื่นหรือปฏิบัติตามหน้าที่ที่เกี่ยวข้อง',
          'ช่องทางติดต่อ: ทีมโครงการ HKTutor ผ่านที่อยู่ติดต่อที่เผยแพร่ใน README ของ repository เนื่องจากเป็นโครงงานรายวิชา โปรดเผื่อเวลาสำหรับการตอบกลับนอกเวลาเรียน',
        ],
        bullets: [],
      },
      {
        heading: '9. วิธีที่เราใช้ปกป้องข้อมูลของคุณ',
        paragraphs: [
          'API เป็นส่วนประกอบเดียวที่ติดต่อฐานข้อมูลและพื้นที่จัดเก็บไฟล์ โค้ดใน browser จะไม่ได้รับ connection string ของฐานข้อมูลหรือ service key',
        ],
        bullets: [
          'การเชื่อมต่อที่ deploy แล้วทั้งหมดระหว่าง browser, API, Resend และ Supabase ใช้ TLS',
          'คำขอไปยัง endpoint ที่มีการป้องกันทุกครั้งจะถูกตรวจสอบกับ JWT session ที่ลงนามแล้ว จากนั้นตรวจสอบบทบาท สถานะบัญชี และความเป็นเจ้าของภายในระบบ',
          'เอกสารติวเตอร์อยู่ใน private bucket และเปิดได้เฉพาะผ่าน signed link ที่หมดอายุภายในไม่กี่นาที',
          'Session token ข้อมูลรับรองฐานข้อมูล และ service key จะไม่ถูกเขียนลง log, เอกสาร API หรือ error response',
        ],
      },
      {
        heading: '10. การเปลี่ยนแปลงประกาศนี้',
        paragraphs: [
          `หากข้อความเปลี่ยนแปลงในส่วนที่กระทบต่อข้อมูลที่เก็บหรือเหตุผลในการเก็บ HKTutor จะเผยแพร่ประกาศเป็นเวอร์ชันใหม่และขอให้คุณยอมรับอีกครั้งก่อนใช้งานต่อ เวอร์ชันปัจจุบันคือ ${PRIVACY_POLICY_VERSION}`,
        ],
        bullets: [],
      },
    ],
  },
} as const satisfies Record<Language, PrivacyNoticeCopy>;
