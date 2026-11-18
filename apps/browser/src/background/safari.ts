/**
 * Safari. Safari gives extensions neither response headers nor blocking request listeners, so a PDF is recognised by its
 * address: a web page load whose path ends in .pdf is sent to the viewer. PDFs served from addresses without .pdf stay with
 * Safari's own viewer. Local files (file://) are left to Safari too. Nothing is recorded or sent anywhere.
 */
import { ext } from '../ext.js';
import { pdfAddress } from '../intercept.js';
import { VIEWER, clearBypass, grant, isBypassed, registerCommon, setBypass } from './common.js';

ext.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0) return;
  const address = pdfAddress(d.url);
  if (!address) return;
  void (async () => {
    if (await isBypassed(d.tabId, address)) return;
    await grant(d.tabId, address);
    await ext.tabs.update(d.tabId, { url: `${VIEWER}?file=${d.url}` });
  })();
}, { url: [{ schemes: ['http', 'https'], pathSuffix: '.pdf' }, { schemes: ['http', 'https'], pathSuffix: '.PDF' }] });

registerCommon({ bypass: setBypass, clearBypass });
