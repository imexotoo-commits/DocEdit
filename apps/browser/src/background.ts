/**
 * Sends PDFs the browser is about to show to the Oakqueill viewer.
 *
 * Web PDFs are recognised by what the server says they are (Content-Type), with browser request rules
 * (declarativeNetRequest): no code sees the pages you browse, and nothing is sent anywhere. Files the server marks
 * as downloads (Content-Disposition: attachment) are left alone, as are PDFs embedded in other pages.
 * Local files (file://) need "Allow access to file URLs" for the extension.
 *
 * The viewer page has to be reachable from websites for the redirect to work, so it loads a PDF only with a grant from
 * here: a grant is made when this browser tab was just sent to the viewer for that address (by the rule above, or for
 * a local file), and it ends when the tab goes anywhere else. A viewer opened any other way asks before it loads.
 */
import { normalUrl, sourceFromLocation } from './address.js';

const VIEWER = chrome.runtime.getURL('viewer.html');
const NOT_A_DOWNLOAD = [{ header: 'content-disposition', values: ['attachment*'] }];

async function installRules(): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
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
chrome.runtime.onInstalled.addListener(() => void installRules());
chrome.runtime.onStartup.addListener(() => void installRules());

// --- grants: which address the viewer in a tab may load (kept in session storage, so they outlive a worker restart)
const grantKey = (tabId: number) => `grant:${tabId}`;
const grant = (tabId: number, url: string) => chrome.storage.session.set({ [grantKey(tabId)]: url });
const revoke = (tabId: number) => chrome.storage.session.remove(grantKey(tabId));
async function granted(tabId: number): Promise<string | undefined> {
  return (await chrome.storage.session.get(grantKey(tabId)))[grantKey(tabId)] as string | undefined;
}

// a web PDF: the browser's own redirect from that address to the viewer, in this tab
chrome.webRequest.onBeforeRedirect.addListener((d) => {
  if (d.type !== 'main_frame' || d.tabId < 0 || !d.redirectUrl.startsWith(`${VIEWER}?`)) return;
  const target = sourceFromLocation(d.redirectUrl)?.url;
  if (target && target === normalUrl(d.url)) void grant(d.tabId, target);
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] });

// a local file: sent to the viewer from here
chrome.webNavigation.onBeforeNavigate.addListener((d) => {
  if (d.frameId !== 0 || !/\.pdf$/i.test(new URL(d.url).pathname)) return;
  const url = normalUrl(d.url);
  if (!url) return;
  // the viewer address keeps the #fragment (a page to start on)
  void grant(d.tabId, url).then(() => chrome.tabs.update(d.tabId, { url: `${VIEWER}?file=${d.url}` }));
}, { url: [{ schemes: ['file'], pathSuffix: '.pdf' }, { schemes: ['file'], pathSuffix: '.PDF' }] });

// the tab shows something else: the grant ends (the PDF's own address, shown by the browser, keeps it)
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0 || d.url.startsWith(`${VIEWER}?`)) return;
  void granted(d.tabId).then((g) => { if (g !== undefined && g !== normalUrl(d.url)) return revoke(d.tabId); });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void revoke(tabId);
  void chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [bypassRuleId(tabId)] }).catch(() => {});
});

// --- "Open in the browser's own viewer": this address, in this tab, for the rest of the browser session
// one rule per tab, numbered by the tab, so a new choice replaces the old one even after a worker restart
const bypassRuleId = (tabId: number) => 1000 + tabId;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Sender = { id?: string; url?: string; frameId?: number; tab?: { id?: number } };
/** The viewer page in a tab's main frame, and the address it shows. */
function fromViewer(sender: Sender): { tabId: number; url: string } | null {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(`${VIEWER}?`) || sender.frameId !== 0 || typeof sender.tab?.id !== 'number') return null;
  const src = sourceFromLocation(sender.url);
  return src ? { tabId: sender.tab.id, url: src.url } : null;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const m = msg as { type?: string; url?: string };
  const from = fromViewer(sender);
  if (!from || typeof m?.url !== 'string' || normalUrl(m.url) !== from.url) return;

  if (m.type === 'claim') {
    // the redirect's grant is written as the viewer starts loading; give it a moment
    void (async () => {
      for (let i = 0; i < 5; i++) {
        if ((await granted(from.tabId)) === from.url) return reply(true);
        await new Promise((r) => setTimeout(r, 100));
      }
      reply(false);
    })();
    return true; // answering asynchronously
  }

  if (m.type === 'bypass' && /^https?:\/\//.test(from.url)) {
    const id = bypassRuleId(from.tabId);
    const rule = { id, priority: 2, action: { type: 'allow' as const }, condition: { regexFilter: `^${escapeRe(from.url)}$`, resourceTypes: ['main_frame'], tabIds: [from.tabId] } };
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id], addRules: [rule] }).then(() => reply(true), (e: unknown) => reply(String(e)));
    return true;
  }
});
