/**
 * 🔒 Attestation — PRD §12.
 *
 * The constraint: we do not control the calldata of a Thetanuts fill (the SDK
 * builds it, and appending trailing bytes is contract-dependent and may
 * revert), and deploying our own contract to Base mainnet is not greenlit.
 * So the link between a trade and the reasoning that caused it is written as
 * a separate transaction.
 *
 * Ladder: A (SELF_TX) → D (OFFCHAIN_ONLY). B (EAS) only when its entry
 * conditions are met; C (REGISTRY) needs explicit authorisation and is not
 * implemented.
 *
 * 🔒 A failed attestation NEVER fails the hedge. Every path in this module
 * either returns an `Attestation` or falls through to one that does.
 */

import { createHash } from 'node:crypto';
import { ethers } from 'ethers';

import { AppError, mapSdkError } from './errors';
import { CHAIN_ID, basescanTxUrl, config } from './config';
import { getProvider, getSigningClient, hasSigner, signerAddress } from './thetanuts';
import type {
  Address,
  Attestation,
  AttestationMethod,
  CompleteAttestation,
  AttestationPayload,
  CorrelationId,
  TxHash,
  UnsignedTx,
} from '../types/index';

/**
 * 🔒 The canonical payload line — PRD §12. Identical across every method, so
 * a verifier reads the same bytes whether they came from calldata, an EAS
 * attestation, or an offchain receipt.
 *
 *   NSHv1|<cid>|<truthScore>|<agreement×100>|<severity>|<gonkaIds csv>|<evidenceHash>|<hedgeTxHash>
 *
 * Pipes are the field separator, so any pipe inside a Gonka request ID would
 * corrupt the framing. IDs are sanitised rather than trusted.
 */
export function canonicalLine(payload: AttestationPayload): string {
  const ids = payload.gonkaRequestIds.map(sanitiseField).join(',');
  return [
    'NSHv1',
    sanitiseField(payload.cid),
    formatScore(payload.truthScore),
    formatScore(payload.agreement * 100),
    String(Math.round(payload.severity)),
    ids,
    sanitiseField(payload.evidenceHash),
    sanitiseField(payload.hedgeTxHash),
  ].join('|');
}

/** Strip the field separator and any control characters from a payload field. */
function sanitiseField(v: string): string {
  return String(v).replace(/[|\r\n\t]/g, '_');
}

/** Scores render with at most two decimals and no trailing zeros. */
function formatScore(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}

/** sha256 of a UTF-8 string, hex-encoded with a `0x` prefix. */
export function sha256Hex(input: string): string {
  return `0x${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

/**
 * The evidence hash bound into the payload. Hashing the canonical JSON of the
 * verification evidence makes the verdict tamper-evident even when the Gonka
 * request ID is not chain-resolvable (PRD §4.1, the `false` branch).
 */
export function evidenceHashFor(evidence: unknown): string {
  return sha256Hex(stableStringify(evidence));
}

/** Deterministic JSON: keys sorted at every level, so the hash is stable. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const entries = Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stableStringify(val)}`).join(',')}}`;
}

/** UTF-8 → `0x`-prefixed hex, the `data` field of the self-transaction. */
export function encodePayloadHex(line: string): string {
  return ethers.hexlify(ethers.toUtf8Bytes(line));
}

/** Decode calldata back to the canonical line — used by verifiers and tests. */
export function decodePayloadHex(hex: string): string {
  return ethers.toUtf8String(hex);
}

/** Parse a canonical line back into its fields. Returns null if not NSHv1. */
export function parseCanonicalLine(line: string): AttestationPayload | null {
  const parts = line.split('|');
  if (parts.length !== 8 || parts[0] !== 'NSHv1') return null;
  const [, cid, truth, agreementX100, severity, ids, evidenceHash, hedgeTxHash] = parts;
  return {
    v: 1,
    cid: cid as CorrelationId,
    truthScore: Number(truth),
    agreement: Number(agreementX100) / 100,
    severity: Number(severity),
    gonkaRequestIds: ids === '' ? [] : (ids as string).split(','),
    evidenceHash: evidenceHash as string,
    hedgeTxHash: hedgeTxHash as TxHash,
  };
}

export interface AttestParams {
  correlationId: CorrelationId;
  truthScore: number;
  agreement: number;
  severity: number;
  gonkaRequestIds: string[];
  /** sha256 of the raw model responses — see `evidenceHashFor`. */
  evidenceHash: string;
  hedgeTxHash: TxHash;
  /** Build the transaction without broadcasting it. */
  dryRun?: boolean;
  /** Override the ladder; defaults to ATTESTATION_METHOD then OFFCHAIN_ONLY. */
  method?: AttestationMethod;
}

function buildPayload(p: AttestParams): AttestationPayload {
  return {
    v: 1,
    cid: p.correlationId,
    truthScore: p.truthScore,
    agreement: p.agreement,
    severity: p.severity,
    gonkaRequestIds: p.gonkaRequestIds,
    evidenceHash: p.evidenceHash,
    hedgeTxHash: p.hedgeTxHash,
  };
}

/**
 * Build the unsigned SELF_TX: a zero-value transaction from the burner to
 * itself with the payload in `data`.
 *
 * Cannot revert (an EOA-to-EOA transfer ignores calldata), needs no
 * deployment, costs a fraction of a cent on Base, and is fully visible on
 * BaseScan. Its one weakness is the absence of an indexed event, which is
 * exactly the trade the PRD accepts.
 */
export function buildSelfTx(from: Address, payloadHex: string): UnsignedTx {
  return {
    to: from,
    data: payloadHex,
    value: '0',
    chainId: CHAIN_ID,
    description: 'NutShell attestation: zero-value self-transaction carrying the reasoning payload in calldata',
  };
}

/** Gas for a self-transaction: the 21000 base plus calldata bytes. */
export function estimateSelfTxGas(payloadHex: string): bigint {
  const bytes = ethers.getBytes(payloadHex);
  let cost = 21_000n;
  for (const b of bytes) cost += b === 0 ? 4n : 16n;
  return cost;
}

/**
 * 🔒 Write the attestation, walking the ladder.
 *
 * Never throws for an attestation failure: every method that fails is
 * recorded in `ladderAttempts` and the walk continues, ending at
 * OFFCHAIN_ONLY, which cannot fail. Only a malformed payload — a programming
 * error, not an operational one — raises.
 */
export async function attest(p: AttestParams): Promise<CompleteAttestation> {
  const payload = buildPayload(p);
  const line = canonicalLine(payload);
  const payloadHex = encodePayloadHex(line);
  const payloadHash = sha256Hex(line);
  const ladderAttempts: Attestation['ladderAttempts'] = [];

  const requested = (p.method ?? config.attestationMethod) as AttestationMethod;
  const dryRun = p.dryRun ?? !hasSigner();

  const base = {
    correlationId: p.correlationId,
    payload,
    createdAt: new Date().toISOString(),
    canonicalLine: line,
    payloadHex,
    payloadHash,
    ladderAttempts,
  };

  // ── C: REGISTRY — requires a mainnet deployment, which is not greenlit ──
  if (requested === 'REGISTRY') {
    ladderAttempts.push({
      method: 'REGISTRY',
      ok: false,
      error: 'Deploying a registry contract to Base mainnet is not authorised (PRD §2). Falling through.',
    });
  }

  // ── B: EAS — standards-based, needs a registered schema ────────────────
  if (requested === 'EAS') {
    ladderAttempts.push({
      method: 'EAS',
      ok: false,
      error:
        'EAS attestation is an enhancement-tier item (PRD §3 of the plan) and its schema is not registered. ' +
        'Falling through to SELF_TX.',
    });
  }

  // ── A: SELF_TX — the default ───────────────────────────────────────────
  if (requested !== 'OFFCHAIN_ONLY') {
    const from = signerAddress();
    if (!from) {
      ladderAttempts.push({
        method: 'SELF_TX',
        ok: false,
        error: 'No signer configured in this process — cannot broadcast a self-transaction.',
      });
    } else {
      const unsigned = buildSelfTx(from, payloadHex);
      if (dryRun) {
        ladderAttempts.push({ method: 'SELF_TX', ok: true });
        return {
          ...base,
          method: 'SELF_TX',
          wasDryRun: true,
          unsignedTx: unsigned,
        };
      }
      try {
        const signer = getSigningClient().requireSigner();
        const tx = await signer.sendTransaction({
          to: unsigned.to,
          data: unsigned.data,
          value: 0n,
          gasLimit: (estimateSelfTxGas(payloadHex) * 12n) / 10n,
        });
        await tx.wait(1);
        ladderAttempts.push({ method: 'SELF_TX', ok: true });
        return {
          ...base,
          method: 'SELF_TX',
          txHash: tx.hash as TxHash,
          baseScanUrl: basescanTxUrl(tx.hash),
          wasDryRun: false,
          unsignedTx: unsigned,
        };
      } catch (e) {
        // 🔒 Never fail the hedge for this. Record and fall through to D.
        ladderAttempts.push({ method: 'SELF_TX', ok: false, error: mapSdkError(e, p.correlationId).message });
      }
    }
  }

  // ── D: OFFCHAIN_ONLY — the floor of the ladder. Cannot fail. ───────────
  ladderAttempts.push({ method: 'OFFCHAIN_ONLY', ok: true });
  return {
    ...base,
    method: 'OFFCHAIN_ONLY',
    wasDryRun: dryRun,
    ...(signerAddress() ? { unsignedTx: buildSelfTx(signerAddress() as Address, payloadHex) } : {}),
  };
}

/**
 * Verify an attestation against an on-chain transaction: fetch the tx, decode
 * its calldata, and confirm it reproduces the canonical line.
 *
 * This is what makes the attestation more than a claim — anyone with the tx
 * hash can run it.
 */
export async function verifyOnChain(txHash: string): Promise<{
  found: boolean;
  selfTransaction: boolean;
  line?: string;
  payload?: AttestationPayload | null;
  from?: string;
  to?: string;
  error?: string;
}> {
  try {
    const tx = await getProvider().getTransaction(txHash);
    if (!tx) return { found: false, selfTransaction: false, error: 'Transaction not found on Base mainnet' };

    const from = tx.from?.toLowerCase();
    const to = tx.to?.toLowerCase() ?? undefined;
    const selfTransaction = Boolean(from && to && from === to);

    let line: string | undefined;
    try {
      line = decodePayloadHex(tx.data);
    } catch {
      return { found: true, selfTransaction, from, to, error: 'Calldata is not valid UTF-8' };
    }

    return { found: true, selfTransaction, line, payload: parseCanonicalLine(line), from, to };
  } catch (e) {
    throw new AppError('RPC_UNAVAILABLE', `Could not read ${txHash}: ${(e as Error).message}`, { cause: e });
  }
}
