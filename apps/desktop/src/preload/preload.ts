import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DocEditApi, MenuCommand } from '../shared/api.js';

// Only these narrow functions reach the page; it never gets ipcRenderer or Node.
const api: DocEditApi = {
  openDialog: (multi) => ipcRenderer.invoke('docedit:open-dialog', multi),
  openDropped: (file) => ipcRenderer.invoke('docedit:open-dropped', webUtils.getPathForFile(file)),
  save: (req) => ipcRenderer.invoke('docedit:save', req),
  decrypt: (pdf, password) => ipcRenderer.invoke('docedit:decrypt', pdf, password),
  saveSplit: (req) => ipcRenderer.invoke('docedit:save-split', req),
  saveCopy: (req) => ipcRenderer.invoke('docedit:save-copy', req),
  inspect: (pdf) => ipcRenderer.invoke('docedit:inspect', pdf),
  sanitize: (pdf, remove) => ipcRenderer.invoke('docedit:sanitize', pdf, remove),
  openWritten: (path) => ipcRenderer.invoke('docedit:open-written', path),
  previewEdits: (req) => ipcRenderer.invoke('docedit:preview-edits', req),
  setDocumentState: (state) => ipcRenderer.send('docedit:document-state', state),
  closeWindowAfterSave: (saved) => ipcRenderer.send('docedit:close-after-save', saved),
  onMenu: (handler) => {
    const listener = (_e: unknown, cmd: MenuCommand) => handler(cmd);
    ipcRenderer.on('docedit:menu', listener);
    return () => { ipcRenderer.removeListener('docedit:menu', listener); };
  },
  onOpenFile: (handler) => {
    const listener = (_e: unknown, file: Parameters<typeof handler>[0]) => handler(file);
    ipcRenderer.on('docedit:open-file', listener);
    return () => { ipcRenderer.removeListener('docedit:open-file', listener); };
  },
  ready: () => ipcRenderer.send('docedit:ready'),
  openExternal: (url) => ipcRenderer.invoke('docedit:open-external', url),
  editCommand: (cmd) => ipcRenderer.send('docedit:edit-command', cmd),
  getSettings: () => ipcRenderer.invoke('docedit:settings-get'),
  recentList: () => ipcRenderer.invoke('docedit:recent-list'),
  recentOpen: (path) => ipcRenderer.invoke('docedit:recent-open', path),
  recentRemove: (path) => ipcRenderer.invoke('docedit:recent-remove', path),
  recentClear: () => ipcRenderer.invoke('docedit:recent-clear'),
  onRecent: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, list: unknown) => handler(Array.isArray(list) ? list : []);
    ipcRenderer.on('docedit:recent', listener);
    return () => { ipcRenderer.removeListener('docedit:recent', listener); };
  },
  scannerPresent: () => ipcRenderer.invoke('docedit:scanner-present'),
  onScannerPresent: (handler) => {
    const listener = (_e: Electron.IpcRendererEvent, present: boolean) => handler(present === true);
    ipcRenderer.on('docedit:scanner-present', listener);
    return () => { ipcRenderer.removeListener('docedit:scanner-present', listener); };
  },
  scanDevices: () => ipcRenderer.invoke('docedit:scan-devices'),
  scan: (req) => ipcRenderer.invoke('docedit:scan', req),
  scanClear: () => ipcRenderer.invoke('docedit:scan-clear'),
  saveExport: (req) => ipcRenderer.invoke('docedit:save-export', req),
  setSettings: (patch) => ipcRenderer.invoke('docedit:settings-set', patch),
  onSettings: (handler) => {
    const listener = (_e: unknown, s: Parameters<typeof handler>[0]) => handler(s);
    ipcRenderer.on('docedit:settings', listener);
    return () => { ipcRenderer.removeListener('docedit:settings', listener); };
  },
  printPages: (req) => ipcRenderer.invoke('docedit:print', req),
  pickFiles: (kind) => ipcRenderer.invoke('docedit:pick-files', kind),
  certSign: (req) => ipcRenderer.invoke('docedit:cert-sign', req),
  verifySignatures: (pdf) => ipcRenderer.invoke('docedit:verify-signatures', pdf),
  trustCertificate: (der, trust) => ipcRenderer.invoke('docedit:trust-cert', der, trust),
  readTextFile: (path) => ipcRenderer.invoke('docedit:read-text', path),
  listFormFields: (pdf) => ipcRenderer.invoke('docedit:list-fields', pdf),
  readImage: (path) => ipcRenderer.invoke('docedit:read-image', path),
  signaturesList: () => ipcRenderer.invoke('docedit:signatures-list'),
  signaturesSave: (sig) => ipcRenderer.invoke('docedit:signatures-save', sig),
  signaturesDelete: (id) => ipcRenderer.invoke('docedit:signatures-delete', id),
  createDocument: (req) => ipcRenderer.invoke('docedit:create', req),
  officeConverter: () => ipcRenderer.invoke('docedit:office-converter'),
  convertOffice: (path) => ipcRenderer.invoke('docedit:convert-office', path),
  cancelConvert: () => ipcRenderer.send('docedit:cancel-convert'),
  recoverySave: (snap) => ipcRenderer.invoke('docedit:recovery-save', snap),
  recoveryClear: (id) => ipcRenderer.invoke('docedit:recovery-clear', id),
  recoveryList: () => ipcRenderer.invoke('docedit:recovery-list'),
  recoveryLoad: (id) => ipcRenderer.invoke('docedit:recovery-load', id),
};

contextBridge.exposeInMainWorld('docedit', api);
