/**
 * Usage `default: throw new ExhaustiveError(x)` to ensure switch statements are exhaustive.
 */
export class ExhaustiveError extends Error {
  constructor(message: never) {
    super(`${JSON.stringify(message)} not implemented`);
    this.name = new.target.name;
  }
}
