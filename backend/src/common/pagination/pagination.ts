import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Keyset ("cursor") pagination. IDs are UUIDv7, so ordering by id descending is
 * newest-first and stays correct as tables grow past millions of rows — unlike
 * OFFSET, which degrades and can skip rows when data is inserted concurrently.
 */
export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;

  /** ID of the last item from the previous page. */
  @IsOptional()
  @IsUUID('7')
  cursor?: string;
}

export interface Page<T> {
  data: T[];
  page: { limit: number; nextCursor: string | null };
}

/** Fetches limit+1 rows to decide whether another page exists without a second COUNT query. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, page: { limit, nextCursor: hasMore ? (data[data.length - 1]?.id ?? null) : null } };
}

/** Prisma arguments for keyset pagination. */
export function keysetArgs(query: PaginationQuery) {
  return {
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: { id: 'desc' as const },
  };
}
