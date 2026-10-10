'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import { conversationCopy } from '@/components/conversations/conversation-copy';
import { MarginInbox } from '@/components/conversations/margin-inbox';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookLoading } from '@/components/ui/notebook-loading';
import { useLanguage } from '@/lib/i18n';
import { resolveDashboardGate } from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';
import { useProfileSession } from '@/lib/use-profile-session';

export default function MessagesPage() {
  const session = useProfileSession({
    profileMode: 'required',
    profileErrorMode: 'report',
    preserveReturnTo: true,
    allowGuest: true,
  });
  const { language } = useLanguage();
  const text = conversationCopy[language];
  const router = useRouter();
  const params = useSearchParams();
  const tutorId = params.get('tutorId');
  const { user } = session;

  useEffect(() => {
    if (session.isLoading) {
      return;
    }
    if (!user) {
      router.replace(
        withReturnTo(
          '/',
          `/dashboard/messages${tutorId ? `?${new URLSearchParams({ tutorId })}` : ''}`,
        ),
      );
    } else if (user.role === 'ADMIN') {
      router.replace('/dashboard');
    }
  }, [router, session.isLoading, tutorId, user]);

  if (session.isLoading || !user) {
    return <NotebookLoading kind="messagesSession" label={text.loading} />;
  }
  if (user.role === 'ADMIN') {
    return null;
  }
  const ready = session.profile && !resolveDashboardGate(session.profile);
  return (
    <DashboardShell
      user={session.profileUser ?? user}
      onLogout={async () => {
        await session.logout();
        router.replace('/');
      }}
    >
      {session.profileError ? (
        <div role="alert">
          <p>{text.profileError}</p>
          <button type="button" onClick={() => window.location.reload()}>
            {text.reload}
          </button>
        </div>
      ) : ready ? (
        <MarginInbox key={user.id} user={user} tutorId={user.role === 'STUDENT' ? tutorId : null} />
      ) : (
        <p role="status">{text.loading}</p>
      )}
    </DashboardShell>
  );
}
