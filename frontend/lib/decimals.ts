import { AppError } from "./errors";

const TOKEN_DECIMALS: Record<string, number> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": 6,
  "0x4200000000000000000000000000000000000006": 18,
  "0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf": 8,
};

export const PRICE_DECIMALS = 8;

export function decimalsFor(token: string): number {
  const decimals = TOKEN_DECIMALS[token.toLowerCase()];
  if (decimals === undefined) throw new AppError("ASSET_UNRESOLVED", `Unknown token ${token}`);
  return decimals;
}

export function fromScaled(value: bigint | string | number, decimals: number): string {
  const scaled = BigInt(typeof value === "string" ? value.replace(/n$/, "") : value);
  const negative = scaled < BigInt(0);
  const absolute = negative ? -scaled : scaled;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function toScaled(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0").slice(0, decimals));
}

export const decodePrice = (value: bigint | string | number) => fromScaled(value, PRICE_DECIMALS);
export const decodeAmount = (value: bigint | string | number, collateralToken: string) =>
  fromScaled(value, decimalsFor(collateralToken));
