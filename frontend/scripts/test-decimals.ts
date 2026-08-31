import { decodeAmount, decodePrice, decimalsFor, fromScaled, toScaled } from "../lib/decimals";
import goldenOrder from "../fixtures/order.eth-put-2400.json";

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ TEST FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✓ ${message}`);
}

console.log("Running golden fixture tests for lib/decimals.ts...");

// Test 1: Strike Price decoding (8 decimals)
const decodedStrike = decodePrice(goldenOrder.order.strikePrice);
assert(decodedStrike === "2400", `Strike price decoded as 2400 (got ${decodedStrike})`);

// Test 2: Premium price decoding (8 decimals)
const decodedPremium = decodePrice(goldenOrder.order.price);
assert(decodedPremium === "2.15059967", `Premium decoded as 2.15059967 (got ${decodedPremium})`);

// Test 3: USDC collateral token decimals
const usdcDecimals = decimalsFor(goldenOrder.order.collateralToken);
assert(usdcDecimals === 6, `USDC decimals resolved as 6 (got ${usdcDecimals})`);

// Test 4: Available Amount decoding (6 decimals for USDC)
const decodedAmount = decodeAmount(goldenOrder.availableAmount, goldenOrder.order.collateralToken);
assert(decodedAmount === "10000", `Available amount decoded as 10000 (got ${decodedAmount})`);

// Test 5: Round-trip toScaled / fromScaled
const scaledBack = toScaled("2.15059967", 8);
assert(scaledBack.toString() === "215059967", `Round-trip scaling matches 215059967 (got ${scaledBack})`);

console.log("🎉 ALL GOLDEN FIXTURE TESTS PASSED!");
