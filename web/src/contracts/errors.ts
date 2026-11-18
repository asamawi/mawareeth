/** The one typed error every contract parser throws. `code` is a stable code from CODES.error_codes. */
export class ContractError extends Error {
  readonly code: string;
  readonly detail: string;

  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ContractError";
    this.code = code;
    this.detail = detail;
  }

  toDict(): { error: string; detail: string } {
    return { error: this.code, detail: this.detail };
  }
}
