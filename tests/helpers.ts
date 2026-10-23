import { isStoreError } from '../src/store/errors';
import type { StoreErrorCode } from '../src/store/errors';

export async function expectStoreError(
  promise: Promise<unknown>,
  code: StoreErrorCode,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    if (isStoreError(error, code)) return;
    const actual = isStoreError(error)
      ? error.code
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`Expected ${code}, got ${actual}`);
  }
  throw new Error(`Expected ${code}, but the call succeeded`);
}

export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
