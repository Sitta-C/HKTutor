import { AppService } from '@/app.service';

describe('API source alias', () => {
  it('resolves application code through the source-root alias', () => {
    const service = new AppService();

    expect(service.getHello()).toBe('Hello World!');
  });
});
