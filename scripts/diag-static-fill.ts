/**
 * Would the fill succeed right now, against the allowance already on chain?
 *
 * The graded-position run approved 1.000000 USDC, the approval mined, and the
 * fill's static call still reverted with "ERC20: transfer amount exceeds
 * allowance". The arithmetic says 1.000000 was enough — numContracts is floored
 * from the budget, so the charge lands just under it — which points at a stale
 * read rather than a short approval: the approval is mined on one RPC node and
 * the eth_call is served by another a block behind.
 *
 * This re-runs only the static call, for zero gas, against the live allowance.
 * If it passes, the approval is durably visible and the live run can simply be
 * repeated. Signs nothing, sends nothing.
 *
 *   npx tsx scripts/diag-static-fill.ts [--budget 1.00]
 */
import { loadEnv } from '../lib/env';
import { fetchBookDecoded } from '../lib/thetanuts';
import { config } from '../lib/config';

loadEnv();

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const budget = flag('budget') ?? '1.00';
const deadline = Date.parse('2026-09-06T23:59:00.000Z');

async function main() {
  const budgetRaw = BigInt(Math.round(Number(budget) * 1e6));
  const { orders } = await fetchBookDecoded();

  const survivors = orders
    .filter((o) => o.asset === 'ETH' && !o.isCall && Date.parse(o.expiry) > deadline)
    .sort((a, b) => Number(a.strike) - Number(b.strike));

  console.log(`\n${survivors.length} ETH puts survive judging, budget ${budget} USDC\n`);

  const { ThetanutsClient } = await import('@thetanuts-finance/thetanuts-client');
  const { ethers } = await import('ethers');

  const provider = new ethers.JsonRpcProvider(process.env.THETANUTS_RPC_URL);
  const wallet = new ethers.Wallet(process.env.THETANUTS_PRIVATE_KEY as string, provider);
  const client = new ThetanutsClient({ chainId: 8453, provider, signer: wallet });

  const usdc = new ethers.Contract(
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    ['function allowance(address,address) view returns (uint256)'],
    provider,
  );
  const allowance: bigint = await usdc.allowance(
    wallet.address,
    '0x1bDff855d6811728acaDC00989e79143a2bdfDed',
  );
  console.log(`signer     ${wallet.address}`);
  console.log(`allowance  ${ethers.formatUnits(allowance, 6)} USDC`);
  console.log(`block      ${await provider.getBlockNumber()}\n`);

  for (const o of survivors) {
    const preview = client.optionBook.previewFillOrder(
      o.raw as never,
      budgetRaw,
      config.referrer,
    );
    const nc = preview.numContracts as bigint;
    const ppc = preview.pricePerContract as bigint;
    // What the contract will actually pull: numContracts * price, 8dp scale.
    const charge = (nc * ppc) / 100000000n;

    let verdict: string;
    try {
      const sim = await client.optionBook.callStaticFillOrder(
        o.raw as never,
        budgetRaw,
        config.referrer,
      );
      verdict = sim.success ? '✓ WOULD FILL' : `✗ ${sim.error?.message ?? 'reverted'}`;
    } catch (e) {
      verdict = `✗ ${(e as Error).message.slice(0, 120)}`;
    }

    console.log(
      `  strike ${String(o.strike).padEnd(6)} exp ${o.expiry.slice(0, 10)}  ` +
        `contracts ${nc}  charge ${ethers.formatUnits(charge, 6)}  ${verdict}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
