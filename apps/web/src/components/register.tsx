'use client';

import { FormEvent, useState } from 'react';

type Role = 'student' | 'tutor';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [role, setRole] = useState<Role>('student');
  const [acceptedPolicy, setAcceptedPolicy] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setPasswordError('');
    setIsLoading(true);
    
    // TODO: Register Logic, duplicate email, weak password, etc.
    
    setIsLoading(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-student to-tutor px-4 py-8">
      <div className="w-full max-w-[480px]">
        {/* Register Card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-gray-200 bg-white p-6 sm:p-8"
        >
          {/* Email Field */}
          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-2 block text-sm font-normal text-gray-800"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              placeholder="Value"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 transition-colors"
              required
            />
          </div>

          {/* Password Field */}
          <div className="mb-4">
            <label
              htmlFor="password"
              className="mb-2 block text-sm font-normal text-gray-800"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="Value"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 transition-colors"
              required
            />
          </div>

          {/* Confirm Password Field */}
          <div className="mb-5">
            <label
              htmlFor="confirmPassword"
              className="mb-2 block text-sm font-normal text-gray-800"
            >
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="Value"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none transition-colors ${
                passwordError
                  ? 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500'
                  : 'border-gray-200 focus:border-gray-400 focus:ring-1 focus:ring-gray-400'
              }`}
              required
            />
            {passwordError && (
              <p className="mt-1.5 text-xs text-red-500">{passwordError}</p>
            )}
          </div>

          {/* Select Role Toggle */}
          <div className="mb-7 flex flex-wrap items-center justify-between gap-3 py-1">
            <span className="text-sm font-normal text-gray-800 select-none">
              Select Role
            </span>
            <div className="inline-flex rounded-full border border-gray-300 bg-white p-1 select-none shadow-xs">
              <button
                type="button"
                onPointerDown={() => setRole('student')}
                onClick={() => setRole('student')}
                className={`relative flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 sm:px-6 py-2.5 text-sm font-medium transition-colors cursor-pointer select-none touch-manipulation ${
                  role === 'student'
                    ? 'bg-student text-white shadow-sm'
                    : 'bg-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                {role === 'student' && (
                  <svg
                    className="h-4 w-4 pointer-events-none shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                Student
              </button>

              <button
                type="button"
                onPointerDown={() => setRole('tutor')}
                onClick={() => setRole('tutor')}
                className={`relative flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 sm:px-6 py-2.5 text-sm font-medium transition-colors cursor-pointer select-none touch-manipulation ${
                  role === 'tutor'
                    ? 'bg-tutor text-white shadow-sm'
                    : 'bg-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                {role === 'tutor' && (
                  <svg
                    className="h-4 w-4 pointer-events-none shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
                Tutor
              </button>
            </div>
          </div>

          {/* Policy Agreement Checkbox */}
          <div className="mb-7 flex items-center justify-center">
            <label className="flex items-center gap-2.5 cursor-pointer select-none py-1">
              <input
                id="policy"
                type="checkbox"
                checked={acceptedPolicy}
                onChange={(e) => setAcceptedPolicy(e.target.checked)}
                className="sr-only"
                required
              />
              <div
                className={`flex h-[18px] w-[18px] items-center justify-center rounded transition-all ${
                  acceptedPolicy
                    ? 'bg-gradient-to-br from-student to-tutor text-white shadow-xs'
                    : 'border border-gray-300 bg-white hover:border-gray-400'
                }`}
              >
                {acceptedPolicy && (
                  <svg
                    className="h-3 w-3 pointer-events-none"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </div>
              <span className="cursor-pointer text-sm text-gray-800 select-none">
                I accept the policy
              </span>
            </label>
          </div>

          {/* Submit Button */}
          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full rounded-lg bg-[#2b2b2b] py-2.5 px-4 text-center text-sm font-medium text-white hover:bg-[#1f1f1f] focus:outline-none focus:ring-2 focus:ring-gray-800 focus:ring-offset-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isLoading ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

