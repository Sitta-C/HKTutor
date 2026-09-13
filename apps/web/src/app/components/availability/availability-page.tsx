'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

type AvailabilitySlot = {
  time: string;
  duration: string;
  booking: string;
  state: 'open' | 'reserved';
};

type AvailabilityDay = {
  day: string;
  date: string;
  slots: AvailabilitySlot[];
};

const sampleDays: AvailabilityDay[] = [
  {
    day: 'Wednesday',
    date: '9 Sep 2026',
    slots: [
      { time: '18:00–19:00', duration: '1 hour', booking: 'No active booking', state: 'open' },
      { time: '19:00–20:00', duration: '1 hour', booking: 'Pending booking', state: 'reserved' },
    ],
  },
  {
    day: 'Thursday',
    date: '10 Sep 2026',
    slots: [
      { time: '10:00–11:30', duration: '1.5 hours', booking: 'No active booking', state: 'open' },
      { time: '16:00–17:00', duration: '1 hour', booking: 'Confirmed booking', state: 'reserved' },
    ],
  },
  {
    day: 'Saturday',
    date: '12 Sep 2026',
    slots: [
      { time: '09:00–10:00', duration: '1 hour', booking: 'No active booking', state: 'open' },
      { time: '13:00–15:00', duration: '2 hours', booking: 'No active booking', state: 'open' },
    ],
  },
];

const thaiDays: Record<string, string> = {
  Wednesday: 'วันพุธ',
  Thursday: 'วันพฤหัสบดี',
  Saturday: 'วันเสาร์',
};

export default function AvailabilityPage() {
  const { isLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const isThai = language === 'th';

  useEffect(() => {
    if (!isLoading && !user) router.replace('/');
    if (!isLoading && user && user.role !== 'TUTOR') router.replace('/dashboard');
  }, [isLoading, router, user]);

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (isLoading || !user) return <AvailabilityLoading />;
  if (user.role !== 'TUTOR') return null;

  const copy = isThai ? thaiCopy : englishCopy;

  return (
    <DashboardShell
      user={user}
      onLogout={handleLogout}
      headerNavRight={
        <>
          <Link href="/dashboard/listings">{copy.myListings}</Link>
          <a className="dash-cta" href="#add-availability">
            {copy.addTime}
          </a>
        </>
      }
    >
      <div className="availability-page min-w-0 pb-12">
        <header className="dash-greeting availability-greeting">
          <p className="dash-eyebrow">{copy.eyebrow}</p>
          <h1>
            <span>{copy.title}</span>
            <span className="dash-role-chip dash-role-chip-tutor">{copy.bangkokTime}</span>
          </h1>
          <p>{copy.subtitle}</p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={copy.overview}>
          <Metric label={copy.openSlots} value="4" detail={copy.futureAvailable} />
          <Metric label={copy.reservedSlots} value="2" detail={copy.pendingOrConfirmed} />
          <Metric label={copy.teachingHours} value="6.5" detail={copy.thisWeek} />
          <Metric label={copy.timezone} value="UTC+7" detail="Asia/Bangkok" compact />
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.8fr)]">
          <section className="availability-panel" aria-labelledby="availability-week-title">
            <div className="availability-panel-head">
              <div>
                <h2 id="availability-week-title">{copy.week}</h2>
                <p>{copy.overlapRule}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="availability-secondary-button"
                  type="button"
                  aria-label={copy.previousWeek}
                >
                  ‹
                </button>
                <button className="availability-secondary-button" type="button">
                  {copy.today}
                </button>
                <button
                  className="availability-secondary-button"
                  type="button"
                  aria-label={copy.nextWeek}
                >
                  ›
                </button>
              </div>
            </div>

            <div className="availability-days">
              {sampleDays.map((day) => (
                <article className="availability-day" key={day.day}>
                  <div className="availability-day-label">
                    <strong>{isThai ? thaiDays[day.day] : day.day}</strong>
                    <span>{day.date}</span>
                  </div>
                  <div className="min-w-0 space-y-2">
                    {day.slots.map((slot) => (
                      <div className="availability-slot" key={slot.time}>
                        <span className="availability-slot-time">{slot.time}</span>
                        <span className="availability-slot-copy">
                          {slot.duration} · {isThai ? translateBooking(slot.booking) : slot.booking}
                        </span>
                        <AvailabilityPill
                          state={slot.state}
                          label={slot.state === 'open' ? copy.open : copy.reserved}
                        />
                        {slot.state === 'open' ? (
                          <button className="availability-delete-button" type="button">
                            {copy.delete}
                          </button>
                        ) : (
                          <button className="availability-secondary-button" type="button" disabled>
                            {copy.reserved}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
            <form
              id="add-availability"
              className="availability-panel"
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="availability-panel-head">
                <div>
                  <h2>{copy.addAvailableTime}</h2>
                  <p>{copy.createOneRange}</p>
                </div>
              </div>
              <div className="p-5 sm:p-6">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                  <Field
                    label={copy.date}
                    type="date"
                    defaultValue="2026-09-13"
                    className="sm:col-span-2 xl:col-span-1"
                  />
                  <Field label={copy.startTime} type="time" defaultValue="18:00" />
                  <Field label={copy.endTime} type="time" defaultValue="19:00" />
                </div>
                <div className="availability-preview">
                  <p>{copy.bangkokPreview}</p>
                  <strong>{copy.previewValue}</strong>
                  <span>{copy.utcPreview}</span>
                </div>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button className="availability-primary-button" type="submit">
                    {copy.addTime}
                  </button>
                  <button className="availability-secondary-button" type="reset">
                    {copy.reset}
                  </button>
                </div>
              </div>
            </form>

            <section className="availability-notice">
              <strong>{copy.reservedNoticeTitle}</strong>
              <p>{copy.reservedNoticeBody}</p>
            </section>
          </aside>
        </div>
      </div>
    </DashboardShell>
  );
}

function Field({
  className = '',
  label,
  ...inputProps
}: React.ComponentProps<'input'> & { label: string }) {
  return (
    <label className={`availability-field ${className}`}>
      <span>{label}</span>
      <input {...inputProps} className="availability-input" />
    </label>
  );
}

function Metric({
  compact = false,
  detail,
  label,
  value,
}: {
  compact?: boolean;
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <article className="availability-metric">
      <p>{label}</p>
      <strong className={compact ? 'text-[1.3rem]' : ''}>{value}</strong>
      <span>{detail}</span>
    </article>
  );
}

function AvailabilityPill({ label, state }: { label: string; state: AvailabilitySlot['state'] }) {
  return <span className={`availability-pill availability-pill-${state}`}>{label}</span>;
}

function AvailabilityLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f7f4ec] text-sm font-semibold text-[#5e5a52]">
      Loading availability…
    </div>
  );
}

function translateBooking(booking: string) {
  return (
    {
      'No active booking': 'ไม่มีการจองที่ใช้งานอยู่',
      'Pending booking': 'การจองรอยืนยัน',
      'Confirmed booking': 'การจองยืนยันแล้ว',
    }[booking] ?? booking
  );
}

const englishCopy = {
  eyebrow: 'Availability',
  title: 'Plan your teaching time',
  bangkokTime: 'Bangkok time',
  subtitle:
    'Add future time ranges in Asia/Bangkok. HKTutor stores UTC and calculates whether each slot is open from active bookings.',
  overview: 'Availability overview',
  openSlots: 'Open slots',
  futureAvailable: 'Future and available',
  reservedSlots: 'Reserved slots',
  pendingOrConfirmed: 'Pending or confirmed booking',
  teachingHours: 'Teaching hours',
  thisWeek: 'Shown for this week',
  timezone: 'Timezone',
  week: 'Week of 9–15 September 2026',
  overlapRule: 'Adjacent ranges are allowed. Overlapping ranges are rejected.',
  previousWeek: 'Previous week',
  nextWeek: 'Next week',
  today: 'Today',
  open: 'Open',
  reserved: 'Reserved',
  delete: 'Delete',
  addAvailableTime: 'Add available time',
  createOneRange: 'Create one date and time range at a time.',
  date: 'Date',
  startTime: 'Start time',
  endTime: 'End time',
  bangkokPreview: 'Bangkok preview',
  previewValue: 'Sunday 13 Sep 2026 · 18:00–19:00 · 1 hour',
  utcPreview: 'Stored as 11:00–12:00 UTC.',
  addTime: 'Add time',
  reset: 'Reset',
  reservedNoticeTitle: 'Why a reserved slot cannot be deleted',
  reservedNoticeBody:
    'A pending or confirmed booking currently owns that reservation. Canceling or completing a booking changes availability through booking rules.',
  myListings: 'My listings',
};

const thaiCopy = {
  eyebrow: 'ตารางว่าง',
  title: 'จัดเวลาสอนของคุณ',
  bangkokTime: 'เวลาตามกรุงเทพฯ',
  subtitle:
    'เพิ่มช่วงเวลาในอนาคตตามเวลาเอเชีย/กรุงเทพฯ ระบบจัดเก็บเป็น UTC และคำนวณสถานะว่างจากการจองที่ยังใช้งานอยู่',
  overview: 'ภาพรวมตารางว่าง',
  openSlots: 'ช่วงเวลาว่าง',
  futureAvailable: 'ในอนาคตและยังจองได้',
  reservedSlots: 'ช่วงเวลาที่ถูกจอง',
  pendingOrConfirmed: 'มีการจองที่รอหรือยืนยันแล้ว',
  teachingHours: 'ชั่วโมงสอน',
  thisWeek: 'แสดงสำหรับสัปดาห์นี้',
  timezone: 'เขตเวลา',
  week: 'สัปดาห์ 9–15 กันยายน 2026',
  overlapRule: 'ช่วงเวลาที่ต่อกันสร้างได้ แต่ช่วงเวลาที่ซ้อนกันจะถูกปฏิเสธ',
  previousWeek: 'สัปดาห์ก่อนหน้า',
  nextWeek: 'สัปดาห์ถัดไป',
  today: 'วันนี้',
  open: 'ว่าง',
  reserved: 'ถูกจอง',
  delete: 'ลบ',
  addAvailableTime: 'เพิ่มช่วงเวลาว่าง',
  createOneRange: 'สร้างครั้งละหนึ่งวันที่และหนึ่งช่วงเวลา',
  date: 'วันที่',
  startTime: 'เวลาเริ่ม',
  endTime: 'เวลาสิ้นสุด',
  bangkokPreview: 'ตัวอย่างเวลาตามกรุงเทพฯ',
  previewValue: 'วันอาทิตย์ 13 ก.ย. 2026 · 18:00–19:00 · 1 ชั่วโมง',
  utcPreview: 'จัดเก็บเป็น 11:00–12:00 UTC',
  addTime: 'เพิ่มเวลา',
  reset: 'รีเซ็ต',
  reservedNoticeTitle: 'เหตุผลที่ลบช่วงเวลาที่ถูกจองไม่ได้',
  reservedNoticeBody:
    'การจองที่รอยืนยันหรือยืนยันแล้วกำลังใช้ช่วงเวลานั้น การยกเลิกหรือจบคลาสจะเปลี่ยนสถานะผ่านกฎของการจอง',
  myListings: 'คอร์สของฉัน',
};
