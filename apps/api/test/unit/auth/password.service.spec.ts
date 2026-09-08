import { PasswordService } from '@/auth/password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('stores an Argon2id hash and verifies only the original password', async () => {
    const hash = await passwords.hash('correct-horse-123');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(passwords.verify(hash, 'correct-horse-123')).resolves.toBe(true);
    await expect(passwords.verify(hash, 'wrong-password-123')).resolves.toBe(false);
  });
});
