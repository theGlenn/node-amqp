/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
export {};

declare global {
  namespace jest {
    interface Expect {
      greaterThan(n: number): unknown;
      lessThan(n: number): unknown;

      greaterThanOrEqual(n: number): unknown;
      lessThanOrEqual(n: number): unknown;

      errorLike(e: string | Error): unknown;
    }
  }
}

expect.extend({
  greaterThan(actual, expected) {
    const pass = actual > expected;
    const message = pass
      ? () => `expected ${actual} not > ${expected}`
      : () => `expected ${actual} > ${expected}`;

    return { message, pass };
  },

  lessThan(actual, expected) {
    const pass = actual < expected;
    const message = pass
      ? () => `expected ${actual} not < ${expected}`
      : () => `expected ${actual} < ${expected}`;

    return { message, pass };
  },

  greaterThanOrEqual(actual, expected) {
    const pass = actual >= expected;
    const message = pass
      ? () => `expected ${actual} not >= ${expected}`
      : () => `expected ${actual} >= ${expected}`;

    return { message, pass };
  },

  lessThanOrEqual(actual, expected) {
    const pass = actual <= expected;
    const message = pass
      ? () => `expected ${actual} not <= ${expected}`
      : () => `expected ${actual} <= ${expected}`;

    return { message, pass };
  },

  errorLike(actual: Error, expected: string | Error) {
    const expectedMessage = expected instanceof Error ? expected.message : expected;
    const pass = actual.message === expectedMessage;

    const message = pass
      ? () => `expected ${actual.message} != ${expectedMessage}`
      : () => `expected ${actual.message} == ${expectedMessage}`;

    return { message, pass };
  },
});
