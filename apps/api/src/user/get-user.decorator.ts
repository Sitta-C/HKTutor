import { createParamDecorator } from '@nestjs/common';

import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export type UserPayload = Record<string, unknown>;

interface RequestWithUser extends Request {
  user?: UserPayload;
}

export const GetUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    return data ? user[data] : user;
  },
);