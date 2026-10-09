'use client';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { AdminVerificationQueue } from '@/components/qualifications/admin-verification-queue';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';

export interface AdminDashboardProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
}

export function AdminDashboard({ user, onLogout }: AdminDashboardProps) {
  const { copy } = useLanguage();
  const displayName = getUserDisplayName(user);
  const adminCopy = copy.dashboard.admin;

  return (
    <DashboardShell user={user} onLogout={onLogout}>
      <div className="dash-greeting">
        <p className="dash-eyebrow">{adminCopy.eyebrow}</p>
        <h1>
          <span>{copy.dashboard.common.welcomeBack.replace('{name}', displayName)}</span>
          <span className="dash-role-chip dash-role-chip-admin">
            {copy.dashboard.common.adminChip}
          </span>
        </h1>
        <p className="text-[#5e5a52]">{adminCopy.title}</p>
      </div>

      <AdminVerificationQueue />
    </DashboardShell>
  );
}

export default AdminDashboard;
