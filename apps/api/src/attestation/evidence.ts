import type { Request } from 'express';
import { ATTEST_HEADERS, type AttestEvidence } from './attestation.types';

/** A request's attestation evidence, and what it covers. */
export function evidenceOf(req: Request & { rawBody?: Buffer }) {
  const evidence: AttestEvidence = {
    nonce: req.header(ATTEST_HEADERS.nonce) || undefined,
    token: req.header(ATTEST_HEADERS.token) || undefined,
    keyId: req.header(ATTEST_HEADERS.keyId) || undefined,
  };
  return { evidence, request: { method: req.method, path: req.originalUrl, body: req.rawBody } };
}
