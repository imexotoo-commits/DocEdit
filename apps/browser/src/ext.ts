/**
 * The extension API object. Firefox and Safari provide a promise-based `browser`; Chromium provides `chrome` (also
 * promise-based in Manifest V3). The same code runs in all of them through this one name. (Outside a browser, as in the
 * tests, there is neither; the object is then only a placeholder that nothing calls.)
 */
const g = globalThis as unknown as { browser?: typeof chrome; chrome?: typeof chrome };
export const ext: typeof chrome = g.browser ?? g.chrome ?? ({} as typeof chrome);
