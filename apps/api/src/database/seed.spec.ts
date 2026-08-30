import { runSeed } from '@/database/seed';

describe('runSeed', () => {
  it('probes database connectivity without inserting domain data', async () => {
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);

    await runSeed({ $queryRawUnsafe: query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT 1 AS connected');
  });
});
