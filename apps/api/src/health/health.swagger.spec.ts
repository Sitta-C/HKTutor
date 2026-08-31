import * as healthSwagger from '@/health/health.swagger';

describe('health Swagger decorators', () => {
  it('exports documentation using the controller method name', () => {
    const decorator = Reflect.get(healthSwagger, 'GetHealthDoc') as unknown;

    expect(typeof decorator).toBe('function');
  });
});
