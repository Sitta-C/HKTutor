'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import {
  loginAccount,
  logoutSession,
  refreshSession,
  registerAccount,
  verifyEmail,
} from '@/lib/api/auth';
import { onSessionExpired } from '@/lib/api/client';

import type { AuthUser } from '@/lib/api/types';
import type { ReactNode } from 'react';

interface RegisterInput {
  email: string;
  password: string;
  role: 'student' | 'tutor';
  consent: boolean;
  policyVersion: string;
}

interface AuthContextValue {
  isLoading: boolean;
  user: AuthUser | null;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  verify(token: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => onSessionExpired(() => setUser(null)), []);

  useEffect(() => {
    let active = true;
    refreshSession()
      .then((result) => {
        if (active) setUser(result.user);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      user,
      async login(email, password) {
        setUser(await loginAccount(email, password));
      },
      async logout() {
        await logoutSession();
        setUser(null);
      },
      async register(input) {
        await registerAccount(input);
      },
      async verify(token) {
        setUser(await verifyEmail(token));
      },
    }),
    [isLoading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
