import { Injectable } from '@nestjs/common';
import { argon2id, hash, verify } from 'argon2';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, { type: argon2id });
  }

  verify(hashValue: string, password: string): Promise<boolean> {
    return verify(hashValue, password);
  }
}
