'use client';

import { NotebookLoading } from '@/components/ui/notebook-loading';
import { useLanguage } from '@/lib/i18n';

export function DashboardLoading({ embedded = false }: { embedded?: boolean }) {
  const { copy } = useLanguage();
  return (
    <NotebookLoading
      kind={embedded ? 'tutorDashboard' : 'dashboardSession'}
      label={copy.dashboard.common.loading}
      layout={embedded ? 'content' : 'page'}
    />
  );
}
