/**
 * Attestation payload tests — PRD §12.
 *
 * The payload is what makes a trade auditable, so its encoding must be exact,
 * stable, and reversible. These tests never touch the network.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalLine,
  decodePayloadHex,
  encodePayloadHex,
  estimateSelfTxGas,
  evidenceHashFor,
  parseCanonicalLine,
  sha256Hex,
} from '../lib/attestation';
import type { AttestationPayload, TxHash } from '../types/index';

const payload: AttestationPayload = {
  v: 1,
  cid: 'nsh_a1b2c3d4e5f60718',
  truthScore: 88.5,
  agreement: 0.82,
  severity: 4,
  gonkaRequestIds: ['chatcmpl-abc123', 'chatcmpl-def456', 'chatcmpl-ghi789'],
  evidenceHash: '0xfeedface',
  hedgeTxHash: '0xabc0000000000000000000000000000000000000000000000000000000000001' as TxHash,
};

describe('the canonical payload line — PRD §12', () => {
  it('matches the specified field order and separator exactly', () => {
    expect(canonicalLine(payload)).toBe(
      'NSHv1|nsh_a1b2c3d4e5f60718|88.5|82|4|chatcmpl-abc123,chatcmpl-def456,chatcmpl-ghi789|0xfeedface|' +
        '0xabc0000000000000000000000000000000000000000000000000000000000001',
    );
  });

  it('scales agreement by 100, as the spec requires', () => {
    expect(canonicalLine({ ...payload, agreement: 1 }).split('|')[3]).toBe('100');
    expect(canonicalLine({ ...payload, agreement: 0 }).split('|')[3]).toBe('0');
    expect(canonicalLine({ ...payload, agreement: 0.667 }).split('|')[3]).toBe('66.7');
  });

  it('handles an empty request-ID list without collapsing the field count', () => {
    const line = canonicalLine({ ...payload, gonkaRequestIds: [] });
    expect(line.split('|')).toHaveLength(8);
    expect(line.split('|')[5]).toBe('');
  });

  it('sanitises a pipe inside a field so the framing cannot be corrupted', () => {
    const line = canonicalLine({ ...payload, gonkaRequestIds: ['bad|id', 'ok'] });
    expect(line.split('|')).toHaveLength(8);
    expect(line).toContain('bad_id');
  });

  it('sanitises newlines and tabs too', () => {
    const line = canonicalLine({ ...payload, cid: 'nsh_\n\tinjected' });
    expect(line.split('|')).toHaveLength(8);
    expect(line).not.toMatch(/[\r\n\t]/);
  });

  it('is stable — the same payload always produces the same bytes', () => {
    expect(canonicalLine(payload)).toBe(canonicalLine({ ...payload }));
  });
});

describe('hex encoding round trip', () => {
  it('encodes to hex and decodes back to the identical line', () => {
    const line = canonicalLine(payload);
    const hex = encodePayloadHex(line);
    expect(hex.startsWith('0x')).toBe(true);
    expect(decodePayloadHex(hex)).toBe(line);
  });

  it('produces one hex byte pair per UTF-8 byte', () => {
    const line = canonicalLine(payload);
    expect(encodePayloadHex(line).length).toBe(2 + Buffer.from(line, 'utf8').length * 2);
  });
});

describe('parsing a line back into its fields', () => {
  it('round-trips every field', () => {
    const parsed = parseCanonicalLine(canonicalLine(payload));
    expect(parsed).not.toBeNull();
    expect(parsed?.cid).toBe(payload.cid);
    expect(parsed?.truthScore).toBe(88.5);
    expect(parsed?.agreement).toBeCloseTo(0.82, 6);
    expect(parsed?.severity).toBe(4);
    expect(parsed?.gonkaRequestIds).toEqual(payload.gonkaRequestIds);
    expect(parsed?.hedgeTxHash).toBe(payload.hedgeTxHash);
  });

  it('rejects anything that is not an NSHv1 line', () => {
    expect(parseCanonicalLine('hello world')).toBeNull();
    expect(parseCanonicalLine('NSHv2|a|b|c|d|e|f|g')).toBeNull();
    expect(parseCanonicalLine('NSHv1|too|few|fields')).toBeNull();
  });
});

describe('hashing', () => {
  it('sha256Hex is a 0x-prefixed 32-byte digest', () => {
    const h = sha256Hex('abc');
    expect(h).toBe('0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('the evidence hash ignores key order, so it is stable across serialisations', () => {
    expect(evidenceHashFor({ a: 1, b: [2, 3] })).toBe(evidenceHashFor({ b: [2, 3], a: 1 }));
  });

  it('the evidence hash still changes when a value changes', () => {
    expect(evidenceHashFor({ a: 1 })).not.toBe(evidenceHashFor({ a: 2 }));
  });

  it('ignores undefined members, which JSON drops anyway', () => {
    expect(evidenceHashFor({ a: 1, b: undefined })).toBe(evidenceHashFor({ a: 1 }));
  });
});

describe('self-transaction gas', () => {
  it('charges the 21000 base plus 16 gas per non-zero calldata byte', () => {
    const hex = encodePayloadHex('AB'); // two non-zero bytes
    expect(estimateSelfTxGas(hex)).toBe(21_000n + 32n);
  });

  it('charges 4 gas for a zero byte', () => {
    expect(estimateSelfTxGas('0x00')).toBe(21_004n);
  });

  it('stays trivially cheap for a full payload — PRD §12 quotes ~$0.0001', () => {
    const gas = estimateSelfTxGas(encodePayloadHex(canonicalLine(payload)));
    expect(gas).toBeGreaterThan(21_000n);
    expect(gas).toBeLessThan(50_000n);
  });
});
