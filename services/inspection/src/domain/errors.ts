export class DomainError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
