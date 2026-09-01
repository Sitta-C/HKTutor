'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { FormEvent } from 'react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);

    // TODO: login logic

    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-student to-tutor px-4 py-8">
      <div className="w-full max-w-[420px] space-y-6">
        {/* Login Form */}
        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-gray-200 bg-white p-8"
        >
          {/* Email Field */}
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-normal text-gray-800">
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="Value"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 transition-colors"
              required
            />
          </div>

          {/* Password Field */}
          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-normal text-gray-800">
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Value"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg border border-gray-200 px-3.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 transition-colors"
              required
            />
          </div>

          {/* Sign In Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isLoading}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-[#2b2b2b] px-4 text-sm font-medium text-white hover:bg-[#1f1f1f] focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>

        {/* Register Section */}
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-8">
          <p className="text-sm text-gray-800">Doesn&apos;t have an account yet?</p>
          <Link
            href="/register"
            className="flex h-11 w-full items-center justify-center rounded-lg bg-[#2b2b2b] px-4 text-sm font-medium text-white hover:bg-[#1f1f1f] focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2 transition-colors cursor-pointer"
          >
            Register Now!
          </Link>
        </div>
      </div>
    </div>
  );
}
