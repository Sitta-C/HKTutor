// lib/api-client.test.ts
import { fetchWithAuth, AuthTokenError, GetToken } from './api-client';

describe('fetchWithAuth', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = mockFetch;
  });

  it('acquires a token via getToken() and sends it as a Bearer header', async () => {
    const getToken: GetToken = jest.fn().mockResolvedValue('mock.clerk.jwt');
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await fetchWithAuth(getToken, 'https://api.example.com/dashboard');

    // token was actually requested from Clerk
    expect(getToken).toHaveBeenCalledTimes(1);

    // and forwarded to the backend call
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/dashboard');
    expect(options.headers.get('Authorization')).toBe('Bearer mock.clerk.jwt');

    expect(res.status).toBe(200);
  });

  it('merges Authorization into any headers the caller already set', async () => {
    const getToken: GetToken = jest.fn().mockResolvedValue('mock.clerk.jwt');
    mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

    await fetchWithAuth(getToken, 'https://api.example.com/thing', {
      headers: { 'Content-Type': 'application/json' },
    });

    const options = mockFetch.mock.calls[0][1];
    expect(options.headers.get('Content-Type')).toBe('application/json');
    expect(options.headers.get('Authorization')).toBe('Bearer mock.clerk.jwt');
  });

  it('throws AuthTokenError and never calls fetch when there is no session', async () => {
    const getToken: GetToken = jest.fn().mockResolvedValue(null);

    await expect(fetchWithAuth(getToken, 'https://api.example.com/dashboard')).rejects.toThrow(
      AuthTokenError,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('propagates a non-2xx backend response without throwing', async () => {
    const getToken: GetToken = jest.fn().mockResolvedValue('mock.clerk.jwt');
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));

    const res = await fetchWithAuth(getToken, 'https://api.example.com/dashboard');
    expect(res.status).toBe(401);
  });
});
