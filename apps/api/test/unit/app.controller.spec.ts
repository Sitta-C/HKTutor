import { AppController } from '@/app.controller';
import { AppService } from '@/app.service';

describe('AppController', () => {
  it('returns the protected API probe response', () => {
    const controller = new AppController(new AppService());

    expect(controller.getHello()).toBe('Hello World!');
  });
});
