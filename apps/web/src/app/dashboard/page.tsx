'use client';

import { useAuth } from '@clerk/nextjs';
import { useState } from 'react';

import { fetchWithAuth, AuthTokenError } from '@/api/Token';

const backendApi = process.env.NEXT_PUBLIC_BACKEND_URL;

export default function Dashboard() {
  const { getToken } = useAuth();
  const [result, setResult] = useState<string>('');

  const onClicked = async () => {
    try {
      const res = await fetchWithAuth(getToken, `${backendApi}`);

      if (!res.ok) {
        const text = await res.text();
        console.error('Backend request failed', res.status, text);
        setResult(`Error ${res.status}: ${text}`);
        return;
      }

      const data = await res.json();
      setResult(JSON.stringify(data));
    } catch (err) {
      if (err instanceof AuthTokenError) {
        console.error('No Clerk session token available (not signed in?)');
        setResult('No Clerk session token available (not signed in?)');
        return;
      }
      console.error('Failed to fetch dashboard data', err);
      setResult('Failed to fetch dashboard data');
    }
  };

  return (
    <div>
      <button onClick={onClicked}>Load dashboard</button>
      <div>{result}</div>
    </div>
  );
}
