'use client';

import Link from 'next/link';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import { getUserDisplayName } from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/auth-client';

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

      <div className="dash-card mt-6 max-w-2xl p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-50 text-2xl">
            🛡️
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-[#1a1916]">{adminCopy.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5e5a52]">{adminCopy.notice}</p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void onLogout()} className="dash-btn-dark">
                <span>{adminCopy.signOutButton}</span>
              </button>
              <Link
                href="/privacy"
                className="rounded-full border border-[#d9d2c6] bg-white px-5 py-2.5 text-sm font-bold text-[#1a1916] transition-colors hover:bg-[#faf8f4]"
              >
                {adminCopy.privacyButton}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

export default AdminDashboard;
