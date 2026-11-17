import { describe, expect, it } from 'vitest';
import { signatureHeadline } from '../src/renderer/SignaturesPanel.js';

describe('signature headline', () => {
  it('shows "trusted" only for a valid status, whatever the trust result', () => {
    expect(signatureHeadline({ status: 'valid', trusted: true })[0]).toBe('ok');
    expect(signatureHeadline({ status: 'valid', trusted: false })).toEqual(['warn', 'Valid signature, signer not trusted']);
    expect(signatureHeadline({ status: 'indeterminate', trusted: true })).toEqual(['warn', 'Signature cannot be confirmed for this document']);
    expect(signatureHeadline({ status: 'invalid', trusted: true })[0]).toBe('bad');
  });
});
