declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export type MatcherResult = undefined;
  export type Matchers<T> = {
    toBe: (value: unknown) => MatcherResult;
    toEqual: (value: unknown) => MatcherResult;
    toBeCloseTo: (value: number, precision?: number) => MatcherResult;
    toBeLessThan: (value: number) => MatcherResult;
    toBeLessThanOrEqual: (value: number) => MatcherResult;
    toBeGreaterThan: (value: number) => MatcherResult;
    toBeGreaterThanOrEqual: (value: number) => MatcherResult;
    not: Matchers<T>;
  };
  export function expect<T>(value: T): Matchers<T>;
  export function beforeEach(fn: () => void): void;
}
