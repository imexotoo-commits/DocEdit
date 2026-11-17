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
  /** Where the user saves PDFs exported from reMarkable; null until chosen. */
  remarkableFolder: string | null;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', defaultZoom: 'fit-width', redaction: 'copy', recovery: true, openTab: 'comment', remarkableFolder: null };
