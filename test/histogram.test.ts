import { describe, expect, it } from "vitest";
import { Histogram } from "../src/metrics/histogram.js";

describe("Histogram", () => {
  it("tracks bucket counts and percentiles", () => {
    const h = new Histogram([10, 20, 50]);
    [5, 7, 10, 11, 19, 25, 100].forEach((v) => h.record(v));

    expect(h.snapshot().counts).toEqual([3, 2, 1, 1]);
    expect(h.percentile(50)).toBe(20);
    expect(h.percentile(95)).toBe(50);
  });
});
