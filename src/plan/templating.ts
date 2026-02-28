const TOKEN_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;

export interface DeterministicRandom {
  float(): number;
  int(min: number, max: number): number;
  choice<T>(values: T[]): T;
  string(length: number): string;
  uuid(): string;
}

export function createPrng(seed: number): DeterministicRandom {
  let state = seed >>> 0;
  const next = (): number => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  return {
    float: () => next(),
    int: (min, max) => {
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      return Math.floor(next() * (hi - lo + 1)) + lo;
    },
    choice: <T>(values: T[]): T => {
      if (values.length === 0) {
        throw new Error("random.choice requires at least one value");
      }
      return values[Math.floor(next() * values.length)];
    },
    string: (length: number) => {
      let out = "";
      for (let i = 0; i < length; i += 1) {
        out += alphabet[Math.floor(next() * alphabet.length)];
      }
      return out;
    },
    uuid: () => {
      const hex = "0123456789abcdef";
      const chars: string[] = [];
      for (let i = 0; i < 32; i += 1) {
        chars.push(hex[Math.floor(next() * 16)]);
      }
      chars[12] = "4";
      chars[16] = "89ab"[Math.floor(next() * 4)] ?? "8";
      return `${chars.slice(0, 8).join("")}-${chars.slice(8, 12).join("")}-${chars.slice(12, 16).join("")}-${chars.slice(16, 20).join("")}-${chars.slice(20).join("")}`;
    }
  };
}

function parseArgs(raw: string): string[] {
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function unquote(value: string): string {
  const match = value.match(/^["'](.*)["']$/);
  return match ? match[1] : value;
}

function evaluate(expr: string, random: DeterministicRandom): string {
  const intMatch = expr.match(/^random\.int\((.+)\)$/);
  if (intMatch) {
    const args = parseArgs(intMatch[1] ?? "");
    if (args.length !== 2) {
      throw new Error(`Invalid random.int expression: ${expr}`);
    }
    return String(random.int(Number(args[0]), Number(args[1])));
  }

  if (expr === "random.uuid") {
    return random.uuid();
  }

  const choiceMatch = expr.match(/^random\.choice\((.+)\)$/);
  if (choiceMatch) {
    const args = parseArgs(choiceMatch[1] ?? "").map(unquote);
    return String(random.choice(args));
  }

  const stringMatch = expr.match(/^random\.string\((\d+)\)$/);
  if (stringMatch) {
    return random.string(Number(stringMatch[1]));
  }

  throw new Error(`Unsupported template expression: ${expr}`);
}

export function expandTemplate(input: string, random: DeterministicRandom): string {
  return input.replace(TOKEN_REGEX, (_, expr: string) => evaluate(expr.trim(), random));
}

export function expandJsonTemplate<T>(value: T, random: DeterministicRandom): T {
  if (typeof value === "string") {
    return expandTemplate(value, random) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => expandJsonTemplate(v, random)) as T;
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      output[k] = expandJsonTemplate(v, random);
    }
    return output as T;
  }
  return value;
}
