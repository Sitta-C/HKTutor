import { Provider } from '@nestjs/common';
import { createClerkClient } from '@clerk/backend'; // Or '@clerk/backend' based on current package resolution

export const CLERK_CLIENT = 'CLERK_CLIENT';

export const ClerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  useFactory: () => {
    const secKey = process.env['CLERK_SECRET_KEY'];
    if (!secKey) {
    throw new Error('CLERK_SECRET_KEY is not defined in environment variables');
    }
    return createClerkClient({ secretKey: secKey });
  },
};