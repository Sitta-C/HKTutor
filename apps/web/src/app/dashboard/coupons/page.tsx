import AdminCouponPage from '@/components/coupons/admin-coupon-page';

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Discount coupons',
  description: 'Private administrator workspace for percentage coupons.',
  robots: { index: false, follow: false },
};

export default function DashboardCouponsPage() {
  return <AdminCouponPage />;
}
