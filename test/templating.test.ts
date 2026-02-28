import { describe, expect, it } from "vitest";
import { createPrng, expandJsonTemplate, expandTemplate } from "../src/plan/templating.js";

describe("templating", () => {
  it("expands deterministic random functions", () => {
    const rnd = createPrng(123);
    const out = expandTemplate(
      "/users/{{random.int(1,3)}}/{{random.choice(\"a\",\"b\")}}/{{random.string(4)}}/{{random.uuid}}",
      rnd
    );
    expect(out).toMatch(/^\/users\/[1-3]\/[ab]\/[A-Za-z0-9]{4}\/[0-9a-f-]{36}$/);
    const rnd2 = createPrng(123);
    const out2 = expandTemplate(
      "/users/{{random.int(1,3)}}/{{random.choice(\"a\",\"b\")}}/{{random.string(4)}}/{{random.uuid}}",
      rnd2
    );
    expect(out2).toBe(out);
  });

  it("expands nested json values", () => {
    const rnd = createPrng(7);
    const payload = expandJsonTemplate({ id: "{{random.int(1,9)}}", nested: ["{{random.string(3)}}"] }, rnd);
    expect(payload.id).toMatch(/^\d$/);
    expect(payload.nested[0]).toMatch(/^[A-Za-z0-9]{3}$/);
  });
});
