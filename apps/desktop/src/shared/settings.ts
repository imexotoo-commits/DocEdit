/** Preferences the user can change in Settings. */
export interface Settings {
  /** Light, dark, or follow Windows. */
  theme: 'system' | 'light' | 'dark';
  /** How a newly opened document is sized. */
  defaultZoom: 'fit-width' | 'fit-page' | 'actual';
  /** Apply redactions into a new copy (the original stays as it is), or straight into the open document. */
  redaction: 'copy' | 'in-place';
  /** Keep crash-recovery snapshots of unsaved changes. */
  recovery: boolean;
  /** The tool tab shown when a document opens. */
  openTab: 'comment' | 'pages' | 'protect' | 'document';
  /** Keep a list of recently opened files (File › Open Recent, the start screen and the Windows jump list). */
  rememberRecent: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', defaultZoom: 'fit-width', redaction: 'copy', recovery: true, openTab: 'comment', rememberRecent: true };
