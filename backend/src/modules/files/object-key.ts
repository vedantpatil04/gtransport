import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** Keys are restricted to this shape so no key can escape its storage root. */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;

export function assertSafeObjectKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new BadRequestException('Invalid storage key.');
  }
  return key;
}

/**
 * Date-partitioned key: companies/<companyId>/<category>/<yyyy>/<mm>/<uuid><ext>.
 * Keeps listings manageable and makes lifecycle rules easy to apply per period.
 */
export function buildObjectKey(input: { companyId: string; category: string; filename: string; now?: Date }): string {
  const now = input.now ?? new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const extension = path.extname(input.filename).toLowerCase().slice(0, 10).replace(/[^.a-z0-9]/g, '');
  return assertSafeObjectKey(`companies/${input.companyId}/${input.category}/${year}/${month}/${randomUUID()}${extension}`);
}
