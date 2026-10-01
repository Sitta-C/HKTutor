import { API_GLOBAL_PREFIX } from '@app/app.setup';

describe('API source alias', () => {
  it('resolves application code through the source-root alias', () => {
    expect(API_GLOBAL_PREFIX).toBe('api/v1');
  });
});
