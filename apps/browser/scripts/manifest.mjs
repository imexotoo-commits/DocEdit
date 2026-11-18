// The manifest each browser gets, derived from manifest.json (the Chromium one).

/** The manifest for one browser. */
export function manifestFor(target, base, version) {
  const m = { ...base, version };
  if (target === 'chromium') return m;
  delete m.minimum_chrome_version;
  if (target === 'firefox') {
    // Firefox runs the background as an event page (no service workers) and has no request rules on response headers,
    // so it uses the blocking webRequest listener instead
    m.background = { scripts: ['background.js'], type: 'module' };
    m.permissions = ['webRequest', 'webRequestBlocking', 'webNavigation', 'storage'];
    m.browser_specific_settings = { gecko: { id: '{7b3a9f52-6b1e-4d5c-9a41-0f2d8e6c1a77}', strict_min_version: '128.0', data_collection_permissions: { required: ['none'] } } };
  } else {
    // Safari: no request rules on headers, no blocking listeners: the background watches page loads by address
    m.background = { scripts: ['background.js'] };
    m.permissions = ['webNavigation', 'storage', 'tabs'];
  }
  return m;
}
