import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

function readConfiguration(config: Record<string, unknown>): {
  secretKey: string;
  webhookSecret: string;
} {
  if (config['PAYMENT_PROVIDER'] !== undefined && config['PAYMENT_PROVIDER'] !== 'omise') {
    throw new Error('PAYMENT_PROVIDER supports only omise');
  }
  const secretKey =
    typeof config['OMISE_SECRET_KEY'] === 'string' ? config['OMISE_SECRET_KEY'].trim() : '';
  const webhookSecret =
    typeof config['OMISE_WEBHOOK_SECRET'] === 'string' ? config['OMISE_WEBHOOK_SECRET'].trim() : '';
  if (!secretKey && !webhookSecret) {
    return { secretKey, webhookSecret };
  }
  if (!/^skey_test_[A-Za-z0-9]+$/.test(secretKey) || /REPLACE|PLACEHOLDER/i.test(secretKey)) {
    throw new Error('OMISE_SECRET_KEY must be a test secret key');
  }
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(webhookSecret) ||
    Buffer.from(webhookSecret, 'base64').length < 32
  ) {
    throw new Error('OMISE_WEBHOOK_SECRET must be the Base64 webhook secret from Omise');
  }
  return { secretKey, webhookSecret };
}

export function validatePaymentsEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  readConfiguration(config);
  return config;
}

@Injectable()
export class PaymentsConfigService {
  readonly values: ReturnType<typeof readConfiguration>;

  constructor(config: ConfigService) {
    this.values = readConfiguration({
      PAYMENT_PROVIDER: config.get<string>('PAYMENT_PROVIDER'),
      OMISE_SECRET_KEY: config.get<string>('OMISE_SECRET_KEY'),
      OMISE_WEBHOOK_SECRET: config.get<string>('OMISE_WEBHOOK_SECRET'),
    });
  }
}
