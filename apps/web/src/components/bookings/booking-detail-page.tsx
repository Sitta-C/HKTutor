'use client';

import Link from 'next/link';

import { ClassDetailsPanel } from '@/components/bookings/class-details-panel';
import StudentBookingDetailPage from '@/components/bookings/student-booking-detail-page';
import { tutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import styles from './class-details.module.css';

export default function BookingDetailPage({ bookingId }: { bookingId: string }) {
  const { user } = useAuth();
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
  if (user?.role !== 'TUTOR') {
    return <StudentBookingDetailPage bookingId={bookingId} />;
  }
  return (
    <div className={styles.page}>
      <NotebookHeading
        eyebrow={tutorBookingInboxCopy[language].eyebrow}
        title={text.bookingDetails}
      />
      <PaperCard className={styles.paper}>
        <ClassDetailsPanel bookingId={bookingId} />
      </PaperCard>
      <Link className={styles.join} href="/dashboard/bookings">
        {text.backToBookings}
      </Link>
    </div>
  );
}
