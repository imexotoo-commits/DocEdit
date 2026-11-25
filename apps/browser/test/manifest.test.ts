import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { manifestFor } from '../scripts/manifest.mjs';

const base = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const m = (t: string) => manifestFor(t, base, '1.2.3') as Record<string, any>;

describe('the manifest each browser gets', () => {
  it('Chromium keeps the request-rule setup', () => {
    const c = m('chromium');
    expect(c.version).toBe('1.2.3');
    expect(c.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(c.permissions).toContain('declarativeNetRequestWithHostAccess');
    expect(c.minimum_chrome_version).toBe('128');
  });

  it('Firefox runs an event page with the blocking listener, and says which Firefox and what data it collects', () => {
    const f = m('firefox');
    expect(f.background).toEqual({ scripts: ['background.js'], type: 'module' });
    expect(f.permissions).toEqual(expect.arrayContaining(['webRequest', 'webRequestBlocking', 'webNavigation', 'storage']));
    expect(f.permissions).not.toContain('declarativeNetRequestWithHostAccess');
    expect(f.minimum_chrome_version).toBeUndefined();
    expect(f.browser_specific_settings.gecko.id).toMatch(/^\{[0-9a-f-]{36}\}$/);
    expect(Number.parseFloat(f.browser_specific_settings.gecko.strict_min_version)).toBeGreaterThanOrEqual(128);
    expect(f.browser_specific_settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
  });

  it('Safari watches page loads by address and has no request rules or blocking listener', () => {
    const s = m('safari');
    expect(s.background.scripts).toEqual(['background.js']);
    expect(s.permissions).toEqual(expect.arrayContaining(['webNavigation', 'storage', 'tabs']));
    for (const p of ['webRequest', 'webRequestBlocking', 'declarativeNetRequestWithHostAccess']) expect(s.permissions).not.toContain(p);
    expect(s.minimum_chrome_version).toBeUndefined();
  });

  it('every browser keeps the strict content security policy, the viewer page and the icons', () => {
    for (const t of ['chromium', 'firefox', 'safari']) {
      const x = m(t);
      expect(x.content_security_policy.extension_pages).toBe("script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; form-action 'none'"); // WebAssembly only: pdf.js's image decoders
      expect(x.web_accessible_resources[0].resources).toEqual(['viewer.html']);
      expect(x.icons['128']).toBe('icons/icon-128.png');
      expect(x.manifest_version).toBe(3);
    }
  });

  it('does not change the shared manifest it is given', () => {
    const before = JSON.stringify(base);
    m('firefox'); m('safari');
    expect(JSON.stringify(base)).toBe(before);
  });
});
