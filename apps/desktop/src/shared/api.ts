import type { Settings } from './settings.js';
/** The bridge between the sandboxed renderer and the main process (exposed by the preload as window.docedit). */

/** A file on the recent list. */
export interface RecentFile { path: string; name: string; folder: string; openedAt: number }

export interface ScanDevice { id: string; name: string }

export interface OpenedFile {
  /** absolute path, or null for a document that has never been saved */
  path: string | null;
  name: string;
  bytes: Uint8Array;
}

/** Mirrors @docedit/core PageSlot; kept here so the renderer does not import the core. */
export type SaveSlot =
  | { source: number; page: number; rotate?: number; crop?: { x: number; y: number; width: number; height: number } }
  | { blank: [number, number] };

export interface SaveRequest {
  sources: Uint8Array[];
  slots: SaveSlot[];
  /** content edits for the final page order (core DocEdit objects) */
  edits?: unknown[];
  /** null = ask the user where to save */
  path: string | null;
  /** encrypt the saved file (passwords are used for this call only) */
  protect?: { userPassword?: string; ownerPassword?: string; permissions?: Record<string, unknown> } | null;
  suggestedName: string;
}

export interface SplitRequest { sources: Uint8Array[]; parts: SaveSlot[][]; baseName: string; protect?: SaveRequest['protect'] }
export type SplitResult = { ok: true; folder: string; files: string[] } | { ok: false; cancelled: true } | { ok: false; cancelled: false; message: string };

export type SaveResult =
  /** `file.bytes` is what was written; `editBytes` the unencrypted version to keep editing from */
  | { ok: true; file: OpenedFile; editBytes: Uint8Array }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

export interface PrintRequest {
  title: string;
  /** page images in print order, with the size each page should have on paper when not fitted */
  pages: Array<{ png: Uint8Array; widthPt: number; heightPt: number }>;
  /** true = scale each page to fit the paper, false = actual size */
  fit: boolean;
  /** auto = each page portrait or landscape by its own shape */
  orientation: 'auto' | 'portrait' | 'landscape';
}
export type PrintResult = { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; message: string };

export interface PickedFile { path: string; name: string; size: number }
export interface SavedSignature { id: string; name: string; createdAt: number; image?: { base64: string; format: 'png' | 'jpg' }; typedName?: string; /** missing on signatures saved before initials existed */ kind?: 'signature' | 'initials' }

export type CreateRequest =
  | { kind: 'blank'; count: number; size: [number, number] }
  | { kind: 'images'; paths: string[]; options: { pageSize: 'image' | [number, number]; margin: number; fit: 'contain' | 'cover' | 'stretch'; orientation: 'auto' | 'portrait' | 'landscape' } }
  | { kind: 'text'; text: string; name?: string; options: { pageSize: [number, number]; margin: number; fontSize: number } };

export type CreateResult =
  | { ok: true; file: OpenedFile; missingCharacters?: string[] }
  | { ok: false; message: string };

export interface RecoverySnapshot {
  id: string; title: string; path: string | null; pages: unknown[]; edits?: unknown[]; outline?: unknown;
  /** sources not sent before for this id, starting at index firstNewSource */
  newSources: Uint8Array[]; firstNewSource: number;
}
export interface RecoverySummary { id: string; title: string; path: string | null; updatedAt: number; pageCount: number }
export interface RecoveredDocument { id: string; title: string; path: string | null; pages: unknown[]; edits?: unknown[]; outline?: unknown; sources: Uint8Array[]; originalChanged: boolean }

/** Commands sent from the native menu to the renderer. */
export type MenuCommand =
  | 'new-blank' | 'new-images' | 'new-text' | 'new-office'
  | 'open' | 'insert-file' | 'save' | 'save-as' | 'print' | 'close-document'
  | 'undo' | 'redo' | 'find' | 'find-next' | 'find-prev'
  | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'fit-width' | 'fit-page'
  | 'rotate-left' | 'rotate-right' | 'delete-pages' | 'duplicate-pages' | 'insert-blank' | 'crop' | 'extract' | 'split'
  | 'properties' | 'furniture' | 'sanitize' | 'protect' | 'cert-sign'
  | 'save-then-close-window' | 'settings' | 'export' | 'new-scan' | 'new-tab' | 'next-tab' | 'prev-tab';

export interface DocEditApi {
  /** Shows the native open dialog. Resolves null when cancelled. */
  openDialog(multi: boolean): Promise<OpenedFile[] | null>;
  /** Reads a PDF the user dropped onto the window. */
  openDropped(file: File): Promise<OpenedFile>;
  save(req: SaveRequest): Promise<SaveResult>;
  /** Decrypt a protected file for editing. The password is used for this call only. */
  decrypt(pdf: Uint8Array, password: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; code: string; message: string }>;
  /** Hidden-information report for a document (core inspectDocument). */
  inspect(pdf: Uint8Array): Promise<unknown[]>;
  /** Remove the chosen categories; the result is re-inspected and refused if anything chosen is still there. */
  sanitize(pdf: Uint8Array, remove: string[]): Promise<{ ok: true; bytes: Uint8Array; remaining: unknown[] } | { ok: false; message: string }>;
  /** Ask where to save finished bytes (e.g. a redacted copy). Refuses the paths in `notOver`. */
  saveCopy(req: { bytes: Uint8Array; suggestedName: string; notOver: string[]; protect?: SaveRequest['protect'] }): Promise<{ ok: true; path: string } | { ok: false; cancelled: boolean; message?: string }>;
  /** Open a file by path that this app wrote in this session (e.g. the redacted copy). */
  openWritten(path: string): Promise<OpenedFile>;
  /** The document as it would be saved, without writing it (for previews). */
  previewEdits(req: { sources: Uint8Array[]; slots: SaveSlot[]; edits: unknown[] }): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }>;
  /** Asks for a folder and writes each part as its own PDF. */
  saveSplit(req: SplitRequest): Promise<SplitResult>;
  /** Tells main whether there are unsaved changes and what to show in the title bar. */
  /** The active tab's title and unsaved state, and how many tabs have unsaved changes (for the window title and the close question). */
  setDocumentState(state: { title: string; dirty: boolean; unsaved: number }): void;
  /** Main asks before closing a dirty window; the renderer answers through this after saving. */
  closeWindowAfterSave(saved: boolean): void;
  onMenu(handler: (cmd: MenuCommand) => void): () => void;
  /** A file the app was launched with (command line, "Open with"), or an error reading it. */
  onOpenFile(handler: (file: OpenedFile | { error: string }) => void): () => void;
  /**
   * Asks the user (in a native dialog showing the full address) whether to open a web or mail link,
   * then opens it in their default program. Other kinds of address are refused. Resolves true if opened.
   */
  openExternal(url: string): Promise<boolean>;
  /** Cut, copy, paste or select all in the focused page, like the keyboard shortcuts. */
  editCommand(cmd: 'cut' | 'copy' | 'paste' | 'selectAll'): void;
  /** Native picker for images or a text file; only picked paths can be read afterwards. */
  pickFiles(kind: 'images' | 'text' | 'office' | 'certificate'): Promise<PickedFile[] | null>;
  /** Sign with a .p12/.pfx picked in this session; the password is used for this call only. Returns the signed bytes. */
  certSign(req: { pdf: Uint8Array; p12Path: string; password: string; reason?: string; location?: string; page: number; rect?: { x: number; y: number; width: number; height: number } }): Promise<{ ok: true; bytes: Uint8Array; signer: string } | { ok: false; message: string }>;
  /** Verify certificate signatures against the certificates the user trusts. */
  verifySignatures(pdf: Uint8Array): Promise<unknown[]>;
  /** trusting asks the user first (in the main process); resolves true when the trust list changed */
  trustCertificate(der: Uint8Array, trust: boolean): Promise<boolean>;
  /** Whether an office-document converter (LibreOffice) is installed. */
  officeConverter(): Promise<{ available: boolean; path: string | null }>;
  /** Converts a picked office document to a new, unsaved PDF. */
  convertOffice(path: string): Promise<CreateResult>;
  cancelConvert(): void;
  readTextFile(path: string): Promise<string>;
  /** Form fields as the core library sees them (names, kinds, values, choices). */
  listFormFields(pdf: Uint8Array): Promise<Array<{ name: string; kind: string; value: string | boolean | string[] | null; options?: string[]; readOnly: boolean }>>;
  /** A picked JPEG/PNG as base64 (for signatures and stamps). */
  readImage(path: string): Promise<{ base64: string; format: 'png' | 'jpg' }>;
  signaturesList(): Promise<SavedSignature[]>;
  signaturesSave(sig: Omit<SavedSignature, 'id' | 'createdAt'>): Promise<SavedSignature>;
  signaturesDelete(id: string): Promise<void>;
  /** Builds a new, unsaved document. */
  createDocument(req: CreateRequest): Promise<CreateResult>;
  /** Shows the system print dialog for the given page images. */
  printPages(req: PrintRequest): Promise<PrintResult>;
  /** Crash recovery: keep, list, restore and drop snapshots of unsaved work. */
  recoverySave(snap: RecoverySnapshot): Promise<void>;
  recoveryClear(id: string): Promise<void>;
  getSettings(): Promise<Settings>;
  /** Recently opened files, newest first (empty when the setting is off). */
  recentList(): Promise<RecentFile[]>;
  /** Open a file from the recent list (only paths on it); a file that has gone is taken off the list and rejects. */
  recentOpen(path: string): Promise<OpenedFile>;
  recentRemove(path: string): Promise<void>;
  recentClear(): Promise<void>;
  /** Called when the recent list changes. */
  onRecent(handler: (list: RecentFile[]) => void): () => void;
  /** Whether Windows sees a scanner (checked in the background; false until the first check has finished). */
  scannerPresent(): Promise<boolean>;
  /** Called when a scanner appears or disappears. */
  onScannerPresent(handler: (present: boolean) => void): () => void;
  /** Scanners Windows can scan from (WIA). */
  scanDevices(): Promise<{ ok: true; devices: ScanDevice[] } | { ok: false; message: string }>;
  /** Scan with the chosen scanner; resolves with the page images (temporary files). */
  scan(req: { deviceId: string; dpi: number; mode: 'color' | 'gray' | 'bw'; feeder: boolean }): Promise<{ ok: true; files: string[] } | { ok: false; message: string; /** pages saved before the scanner stopped with an error */ partial?: string[] }>;
  /** Remove the temporary scan images. */
  scanClear(): Promise<void>;
  /** Save exported files (Word, text, images): one file through the Save dialog, several into a chosen folder. */
  saveExport(req: { files: Array<{ name: string; bytes: Uint8Array }>; kind: 'docx' | 'txt' | 'png' | 'jpg' }): Promise<{ ok: true; paths: string[] } | { ok: false; cancelled: true } | { ok: false; cancelled: false; message: string }>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Settings changed (in this or another window). Returns an unsubscribe function. */
  onSettings(handler: (s: Settings) => void): () => void;
  recoveryList(): Promise<RecoverySummary[]>;
  recoveryLoad(id: string): Promise<RecoveredDocument>;
  /** Tells main the page is ready to receive onOpenFile events. */
  ready(): void;
}

declare global {
  interface Window { docedit: DocEditApi }
}
