'use client';

import { useAuth } from '@clerk/nextjs';

import { fetchWithAuth, AuthTokenError } from '@/api/Token';
import { processFetch } from 'next/dist/client/components/router-reducer/fetch-server-response';

const backendApi = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function Dashboard() {
  const { getToken } = useAuth();

  const onClicked = async () => {
    try {
      const res = await fetchWithAuth(getToken, `${backendApi}`);

      if (!res.ok) {
        console.error('Backend request failed', res.status, await res.text());
        return;
      }

      const result = await res.json();
      console.log(result);
    } catch (err) {
      if (err instanceof AuthTokenError) {
        console.error('No Clerk session token available (not signed in?)');
        return;
      }
      console.error('Failed to fetch dashboard data', err);
    }
  };

  return (
    <div>
      <button onClick={onClicked}>Load dashboard</button>
    </div>
  );
}
