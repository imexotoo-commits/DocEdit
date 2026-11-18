/**
 * What every browser's background script shares: the viewer's address, the "grant" that lets a tab's viewer load one
 * PDF (kept in session storage, so it outlives a worker restart), and the messages from the viewer page.
 *
 * The viewer page has to be reachable from websites for the browser's redirect to work, so it loads a PDF only with a grant
 * from here: a grant is made when this browser tab was just sent to the viewer for that address, and it ends when the tab
 * goes anywhere else. A viewer opened any other way asks before it loads.
 */
import { normalUrl, sourceFromLocation } from '../address.js';
import { ext } from '../ext.js';

export const VIEWER = ext.runtime.getURL('viewer.html');

const grantKey = (tabId: number) => `grant:${tabId}`;
export const grant = (tabId: number, url: string) => ext.storage.session.set({ [grantKey(tabId)]: url });
export const revoke = (tabId: number) => ext.storage.session.remove(grantKey(tabId));
export async function granted(tabId: number): Promise<string | undefined> {
  return (await ext.storage.session.get(grantKey(tabId)))[grantKey(tabId)] as string | undefined;
}

/** "Open in the browser's own viewer" for browsers without request rules: one address per tab, for the browser session. */
const bypassKey = (tabId: number) => `bypass:${tabId}`;
export const setBypass = (tabId: number, url: string) => ext.storage.session.set({ [bypassKey(tabId)]: url });
export const clearBypass = (tabId: number) => ext.storage.session.remove(bypassKey(tabId));
export async function isBypassed(tabId: number, url: string): Promise<boolean> {
  return (await ext.storage.session.get(bypassKey(tabId)))[bypassKey(tabId)] === url;
}

/** What differs between browsers: how "open in the browser's own viewer" is remembered. */
export interface Platform {
  bypass(tabId: number, url: string): Promise<unknown>;
  clearBypass(tabId: number): Promise<unknown>;
}

type Sender = { id?: string; url?: string; frameId?: number; tab?: { id?: number } };
/** The viewer page in a tab's main frame, and the address it shows. */
function fromViewer(sender: Sender): { tabId: number; url: string } | null {
  if (sender.id !== ext.runtime.id || !sender.url?.startsWith(`${VIEWER}?`) || sender.frameId !== 0 || typeof sender.tab?.id !== 'number') return null;
  const src = sourceFromLocation(sender.url);
  return src ? { tabId: sender.tab.id, url: src.url } : null;
}

export function registerCommon(p: Platform): void {
  // the tab shows something else: the grant ends (the PDF's own address, shown by the browser, keeps it)
  ext.webNavigation.onCommitted.addListener((d) => {
    if (d.frameId !== 0 || d.url.startsWith(`${VIEWER}?`)) return;
    void granted(d.tabId).then((g) => { if (g !== undefined && g !== normalUrl(d.url)) return revoke(d.tabId); });
  });
  ext.tabs.onRemoved.addListener((tabId) => {
    void revoke(tabId);
    void Promise.resolve(p.clearBypass(tabId)).catch(() => {});
  });

  ext.runtime.onMessage.addListener((msg, sender, reply) => {
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
      p.bypass(from.tabId, from.url).then(() => reply(true), (e: unknown) => reply(String(e)));
      return true;
    }
  });
}
