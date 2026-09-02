import { describe, expect, it } from "vitest";
import { compactCurrency, currency } from "./format";

describe("currency", () => {
  it("formats a positive number as USD with no decimals by default", () => {
    expect(currency(1000)).toBe("$1,000");
  });
});

describe("compactCurrency", () => {
  it("delegates to currency() for normal-sized values", () => {
    expect(compactCurrency(62182)).toBe(currency(62182));
    expect(compactCurrency(999_999_999_999_999)).toBe(currency(999_999_999_999_999)); // just under 1e15
  });

  it("switches to scientific notation at 1e15 and beyond", () => {
    expect(compactCurrency(1e15)).toBe("$1.00 × 10^15");
    expect(compactCurrency(9.32e22)).toBe("$9.32 × 10^22");
  });

  it("handles negative extreme values", () => {
    expect(compactCurrency(-2.5e18)).toBe("$-2.50 × 10^18");
  });
});
