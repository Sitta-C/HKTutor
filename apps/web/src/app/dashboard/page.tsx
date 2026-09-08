'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { authenticatedFetch } from '@/lib/auth-client';
import { useAuth } from '@/lib/auth-context';

export default function Dashboard() {
  const { isLoading, logout, user } = useAuth();
  const router = useRouter();
  const [result, setResult] = useState('');

  useEffect(() => {
    if (!isLoading && !user) router.replace('/');
  }, [isLoading, router, user]);

  const loadProtectedData = async () => {
    try {
      const data = await authenticatedFetch<string>('/');
      setResult(JSON.stringify(data));
    } catch (error: unknown) {
      setResult(error instanceof Error ? error.message : 'Failed to load protected data');
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (isLoading || !user) {
    return <main className="p-8">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl p-8 text-[#171714]">
      <div className="rounded-3xl bg-[#f7f4ec] p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#d18b43]">
          Dashboard
        </p>
        <h1 className="mt-3 text-3xl font-bold">Welcome to HKTutor</h1>
        <p className="mt-3 text-[#5e5a52]">
          Signed in as {user.email} ({user.role})
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={loadProtectedData}
            className="rounded-xl bg-[#ffc57d] px-5 py-3 font-bold"
          >
            Test protected API
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-xl border border-[#d8d3c8] bg-white px-5 py-3 font-bold"
          >
            Sign out
          </button>
        </div>
        {result && (
          <pre className="mt-6 overflow-auto rounded-xl bg-white p-4 text-sm">{result}</pre>
        )}
      </div>
    </main>
  );
}
