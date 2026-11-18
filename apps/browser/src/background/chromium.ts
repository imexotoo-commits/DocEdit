/**
 * Chrome, Edge, Brave, Opera, Vivaldi, Arc and other Chromium browsers.
 *
 * Web PDFs are recognised by what the server says they are (Content-Type), with browser request rules
 * (declarativeNetRequest): no code sees the pages you browse, and nothing is sent anywhere. Files the server marks
 * as downloads (Content-Disposition: attachment) are left alone, as are PDFs embedded in other pages.
 * Local files (file://) need "Allow access to file URLs" for the extension.
 */
import { normalUrl, sourceFromLocation } from '../address.js';
import { ext } from '../ext.js';
import { VIEWER, grant, registerCommon } from './common.js';

const NOT_A_DOWNLOAD = [{ header: 'content-disposition', values: ['attachment*'] }];

async function installRules(): Promise<void> {
  await ext.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1, 2],
    addRules: [
      { // served as a PDF
        id: 1, priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: `${VIEWER}?file=\\0` } },
        condition: { regexFilter: '^https?://.*', resourceTypes: ['main_frame'], requestMethods: ['get'],
          responseHeaders: [{ header: 'content-type', values: ['application/pdf', 'application/pdf;*', 'application/x-pdf*'] }], excludedResponseHeaders: NOT_A_DOWNLOAD },
      },
      { // served as "some bytes", but the address ends in .pdf
        id: 2, priority: 1,
        action: { type: 'redirect', redirect: { regexSubstitution: `${VIEWER}?file=\\0` } },
        condition: { regexFilter: '^https?://[^?#]*\\.[pP][dD][fF]([?#].*)?$', resourceTypes: ['main_frame'], requestMethods: ['get'],
          responseHeaders: [{ header: 'content-type', values: ['application/octet-stream*', 'binary/octet-stream*'] }], excludedResponseHeaders: NOT_A_DOWNLOAD },
      },
    ],
  });
}
ext.runtime.onInstalled.addListener(() => void installRules());
ext.runtime.onStartup.addListener(() => void installRules());

// a web PDF: the browser's own redirect from that address to the viewer, in this tab
ext.webRequest.onBeforeRedirect.addListener((d) => {
  if (d.type !== 'main_frame' || d.tabId < 0 || !d.redirectUrl.startsWith(`${VIEWER}?`)) return;
  const target = sourceFromLocation(d.redirectUrl)?.url;
  if (target && target === normalUrl(d.url)) void grant(d.tabId, target);
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });

// a local file: sent to the viewer from here
ext.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0 || !/\.pdf$/i.test(new URL(d.url).pathname)) return;
  const url = normalUrl(d.url);
  if (!url) return;
  // the viewer address keeps the #fragment (a page to start on)
  void grant(d.tabId, url).then(() => ext.tabs.update(d.tabId, { url: `${VIEWER}?file=${d.url}` }));
}, { url: [{ schemes: ['file'], pathSuffix: '.pdf' }, { schemes: ['file'], pathSuffix: '.PDF' }] });

// "Open in the browser's own viewer": this address, in this tab, for the rest of the browser session.
// One rule per tab, numbered by the tab, so a new choice replaces the old one even after a worker restart.
const bypassRuleId = (tabId: number) => 1000 + tabId;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

registerCommon({
  bypass: (tabId, url) => {
    const id = bypassRuleId(tabId);
    const rule = { id, priority: 2, action: { type: 'allow' as const }, condition: { regexFilter: `^${escapeRe(url)}$`, resourceTypes: ['main_frame'], tabIds: [tabId] } };
    return ext.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [rule] });
  },
  clearBypass: (tabId) => ext.declarativeNetRequest.updateSessionRules({ removeRuleIds: [bypassRuleId(tabId)] }).catch(() => {}),
});
