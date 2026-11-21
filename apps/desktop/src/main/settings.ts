import { BrowserWindow, nativeTheme } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_SETTINGS, type Settings } from '../shared/settings.js';

/** App preferences in settings.json in the profile folder. Unknown or malformed values fall back to the defaults. */
export class SettingsStore {
  private value: Settings;
  constructor(private file: string) {
    let raw: unknown = {};
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch { /* first start, or unreadable: defaults */ }
    this.value = clean(raw);
    nativeTheme.themeSource = this.value.theme;
  }
  get(): Settings { return this.value; }
  set(patch: unknown): Settings {
    const p = { ...(patch && typeof patch === 'object' ? patch : {}) } as Record<string, unknown>;
    return this.write({ ...this.value, ...p });
  }
  private write(next: unknown): Settings {
    this.value = clean(next);
    nativeTheme.themeSource = this.value.theme;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.value, null, 2));
    renameSync(this.file + '.tmp', this.file);
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('docedit:settings', this.value);
    return this.value;
  }
}

function clean(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <K extends keyof Settings>(k: K, allowed: readonly Settings[K][]): Settings[K] => (allowed.includes(r[k] as Settings[K]) ? (r[k] as Settings[K]) : DEFAULT_SETTINGS[k]);
  return {
    theme: pick('theme', ['system', 'light', 'dark']),
    defaultZoom: pick('defaultZoom', ['fit-width', 'fit-page', 'actual']),
    redaction: pick('redaction', ['copy', 'in-place']),
    recovery: pick('recovery', [true, false]),
    openTab: pick('openTab', ['comment', 'pages', 'protect', 'document']),
  };
}
