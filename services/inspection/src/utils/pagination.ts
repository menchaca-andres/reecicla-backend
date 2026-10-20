import type { ParsedQs } from 'qs';

export interface PaginationRequest {
  page: number;
  page_size: number;
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total_items: number;
  total_pages: number;
}

export interface PageResult<T> {
  items: T[];
  total_items: number;
}

export function parsePagination(query: ParsedQs): PaginationRequest | undefined | null {
  if (query.page === undefined && query.page_size === undefined) return undefined;
  if ((query.page !== undefined && typeof query.page !== 'string') ||
      (query.page_size !== undefined && typeof query.page_size !== 'string')) return null;
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.page_size === undefined ? 10 : Number(query.page_size);
  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(offset)) {
    return null;
  }
  return { page, page_size: pageSize, limit: pageSize, offset };
}

export function paginationMeta(pagination: PaginationRequest, totalItems: number): PaginationMeta {
  return {
    page: pagination.page,
    page_size: pagination.page_size,
    total_items: totalItems,
    total_pages: Math.ceil(totalItems / pagination.page_size),
  };
}
