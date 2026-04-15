export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; code?: string; expose?: boolean; cause?: unknown } = {}
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? 500;
    this.code = options.code ?? 'INTERNAL_ERROR';
    this.expose = options.expose ?? false;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
