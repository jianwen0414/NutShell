/**
 * Why did the fill revert on allowance when the approval succeeded?
 *
 * Reads the live allowance, the burner balance, and the amount the approval
 * transaction actually set, so the three can be compared against what the fill
 * demanded. Read-only, signs nothing.
 *
 *   npx tsx scripts/diag-allowance.ts [approvalTxHash]
 */
import { ethers } from 'ethers';
import { loadEnv } from '../lib/env';

loadEnv();

const RPC = process.env.THETANUTS_RPC_URL ?? process.env.BASE_RPC_URL ?? '';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BOOK = '0x1bDff855d6811728acaDC00989e79143a2bdfDed';
const BURNER = '0xB792296bE8202ba2fc5D3276fA184e5B479920E3';

const approvalHash = process.argv[2];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const usdc = new ethers.Contract(
    USDC,
    [
      'function allowance(address,address) view returns (uint256)',
      'function balanceOf(address) view returns (uint256)',
    ],
    provider,
  );

  const [allowance, balance, block] = await Promise.all([
    usdc.allowance(BURNER, BOOK) as Promise<bigint>,
    usdc.balanceOf(BURNER) as Promise<bigint>,
    provider.getBlockNumber(),
  ]);

  console.log('\n═══ ALLOWANCE STATE ═══');
  console.log('  at block  :', block);
  console.log('  burner    :', BURNER);
  console.log('  spender   :', BOOK, '(OptionBook)');
  console.log(
    '  allowance :',
    ethers.formatUnits(allowance, 6),
    'USDC   raw',
    allowance.toString(),
  );
  console.log(
    '  balance   :',
    ethers.formatUnits(balance, 6),
    'USDC   raw',
    balance.toString(),
  );

  if (approvalHash) {
    const tx = await provider.getTransaction(approvalHash);
    if (!tx) {
      console.log('\n  approval tx not found');
      return;
    }
    const iface = new ethers.Interface([
      'function approve(address spender, uint256 amount)',
    ]);
    const parsed = iface.parseTransaction({ data: tx.data });
    const receipt = await provider.getTransactionReceipt(approvalHash);
    console.log('\n═══ THE APPROVAL ═══');
    console.log('  status    :', receipt?.status === 1 ? 'SUCCESS' : 'FAILED');
    console.log('  block     :', receipt?.blockNumber);
    console.log('  spender   :', parsed?.args[0]);
    console.log(
      '  amount    :',
      ethers.formatUnits(parsed?.args[1] as bigint, 6),
      'USDC   raw',
      (parsed?.args[1] as bigint).toString(),
    );

    const approved = parsed?.args[1] as bigint;
    console.log('\n═══ READING ═══');
    if (allowance === 0n && approved > 0n) {
      console.log('  The approval set a non-zero allowance and it now reads 0.');
      console.log('  Something consumed it, or a later approval reset it.');
    } else if (allowance < approved) {
      console.log('  Allowance is BELOW what was approved — it has been partly spent.');
    } else {
      console.log('  Allowance matches the approval and is still in place.');
      console.log('  So the fill wanted MORE than this. Compare against the');
      console.log('  premium the selected order demanded at sign time.');
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
