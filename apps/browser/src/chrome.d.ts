// The few extension APIs this extension uses (written here instead of adding @types/chrome).
declare namespace chrome {
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    function sendMessage(message: unknown): Promise<unknown>;
    const onInstalled: { addListener(cb: () => void): void };
    const onStartup: { addListener(cb: () => void): void };
    const onMessage: { addListener(cb: (message: unknown, sender: { id?: string; url?: string; frameId?: number; tab?: { id?: number } }, reply: (response: unknown) => void) => boolean | void): void };
  }
  namespace declarativeNetRequest {
    interface HeaderInfo { header: string; values?: string[] }
    interface Rule {
      id: number;
      priority?: number;
      action: { type: 'redirect' | 'allow'; redirect?: { regexSubstitution?: string; url?: string } };
      condition: {
        regexFilter?: string; resourceTypes?: string[]; requestMethods?: string[];
        responseHeaders?: HeaderInfo[]; excludedResponseHeaders?: HeaderInfo[]; tabIds?: number[];
      };
    }
    function updateDynamicRules(o: { removeRuleIds?: number[]; addRules?: Rule[] }): Promise<void>;
    function updateSessionRules(o: { removeRuleIds?: number[]; addRules?: Rule[] }): Promise<void>;
    function getSessionRules(): Promise<Rule[]>;
  }
  namespace webNavigation {
    const onBeforeNavigate: { addListener(cb: (d: { tabId: number; frameId: number; url: string }) => void, filter?: { url: Array<{ schemes?: string[]; pathSuffix?: string }> }): void };
    const onCommitted: { addListener(cb: (d: { tabId: number; frameId: number; url: string }) => void): void };
  }
  namespace webRequest {
    const onBeforeRedirect: { addListener(cb: (d: { tabId: number; type: string; url: string; redirectUrl: string }) => void, filter: { urls: string[]; types?: string[] }): void };
  }
  namespace tabs {
    function update(tabId: number, o: { url: string }): Promise<unknown>;
    const onRemoved: { addListener(cb: (tabId: number) => void): void };
  }
  namespace storage {
    const session: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    };
  }
}
