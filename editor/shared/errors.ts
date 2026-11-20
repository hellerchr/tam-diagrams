/** The message of anything thrown (an Error, a JSON-RPC error object, a string). */
export const errorText = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : String((error as { message?: unknown } | undefined)?.message ?? error);
