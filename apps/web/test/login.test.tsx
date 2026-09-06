// app/login/login.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// --- Mock next/navigation ---
const pushMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// --- Mock i18n ---
jest.mock('@/lib/i18n', () => ({
  useLanguage: () => ({
    copy: {
      login: {
        eyebrow: 'Welcome back',
        title: 'Sign in',
        subtitle: 'subtitle',
        emailLabel: 'Email',
        emailPlaceholder: 'you@example.com',
        passwordLabel: 'Password',
        passwordPlaceholder: 'Password',
        showPassword: 'Show',
        hidePassword: 'Hide',
        trouble: 'Trouble signing in?',
        loading: 'Signing in...',
        submit: 'Sign in',
        newTo: 'New here?',
        createAccount: 'Create account',
      },
      social: { dividerLogin: 'or' },
    },
  }),
}));

// --- Mock the auth shell so we only render the form itself ---
jest.mock('@/components/auth-shell', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AuthSocialButtons: () => <div data-testid="social-buttons" />,
  EyeIcon: () => <svg data-testid="eye-icon" />,
}));

// --- Mock @clerk/nextjs ---
const signInPasswordMock = jest.fn();
const signInFinalizeMock = jest.fn();
const getTokenMock = jest.fn();

jest.mock('@clerk/nextjs', () => ({
  useSignIn: () => ({
    signIn: {
      password: signInPasswordMock,
      finalize: signInFinalizeMock,
      status: 'complete',
      supportedSecondFactors: [],
    },
    fetchStatus: 'idle',
  }),
  useAuth: () => ({
    getToken: getTokenMock,
    isLoaded: true,
  }),
  useUser: () => ({
    isSignedIn: false,
  }),
  useClerk: () => ({
    signOut: jest.fn(),
    setActive: jest.fn(),
  }),
}));

import Login from './login';

describe('Login form', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('submits email/password to Clerk and finalizes sign-in on success', async () => {
    signInPasswordMock.mockResolvedValue({ error: null });
    signInFinalizeMock.mockImplementation(async ({ navigate }) => {
      // simulate Clerk resolving to an internal (non-http) redirect url
      await navigate({ session: {}, decorateUrl: (url: string) => url });
    });

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'user@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'hunter2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(signInPasswordMock).toHaveBeenCalledWith({
        emailAddress: 'user@test.com',
        password: 'hunter2',
      });
    });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows the backend/Clerk error message when sign-in fails', async () => {
    signInPasswordMock.mockResolvedValue({
      error: { errors: [{ message: 'Invalid credentials' }] },
    });

    render(<Login />);

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'user@test.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('acquires a session token via getToken() once signed in', async () => {
    getTokenMock.mockResolvedValue('mock.clerk.jwt');

    // Any component/hook that needs to call your backend does it like this:
    const token = await getTokenMock();
    expect(token).toBe('mock.clerk.jwt');
  });
});
