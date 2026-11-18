/**
 * Firefox. Firefox's request rules cannot match on the server's response headers, so the viewer uses the blocking
 * webRequest listener Firefox keeps in Manifest V3: it looks at the response headers of a page load (only the headers,
 * never the page) and, for a PDF, sends the tab to the viewer. Nothing is recorded or sent anywhere.
 * Local files (file://) are left to Firefox's own viewer.
 */
import { ext } from '../ext.js';
import { pdfResponseAddress } from '../intercept.js';
import { VIEWER, clearBypass, grant, isBypassed, registerCommon, setBypass } from './common.js';

interface HeadersDetails { tabId: number; url: string; method: string; type: string; responseHeaders?: Array<{ name: string; value?: string }> }
type Blocking = { redirectUrl?: string };
const webRequest = (ext as unknown as { webRequest: { onHeadersReceived: { addListener(cb: (d: HeadersDetails) => Promise<Blocking>, filter: { urls: string[]; types: string[] }, extra: string[]): void } } }).webRequest;

webRequest.onHeadersReceived.addListener(async (d) => {
  if (d.tabId < 0) return {};
  const address = pdfResponseAddress({ url: d.url, method: d.method, type: d.type, headers: d.responseHeaders ?? [] });
  if (!address || (await isBypassed(d.tabId, address))) return {};
  await grant(d.tabId, address); // before the redirect, so the viewer finds it when it asks
  return { redirectUrl: `${VIEWER}?file=${d.url}` };
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['blocking', 'responseHeaders']);

registerCommon({ bypass: setBypass, clearBypass });
