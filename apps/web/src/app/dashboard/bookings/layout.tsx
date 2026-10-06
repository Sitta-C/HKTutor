import BookingWorkspaceShell from '@/components/bookings/booking-workspace-shell';

export default function DashboardBookingsLayout({ children }: { children: React.ReactNode }) {
  return <BookingWorkspaceShell>{children}</BookingWorkspaceShell>;
}
