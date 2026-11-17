/**
 * Scanning through Windows Image Acquisition (WIA), the scanner support built into Windows. Works with the
 * scanners and multifunction printers Windows itself can scan from; nothing extra is installed.
 *
 * The scripts are fixed text. Everything chosen in the app (device, resolution, colour, source, output folder)
 * reaches them only as environment variables, validated here first, so nothing typed or read can become code.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export interface ScanDevice { id: string; name: string }
export interface ScanRequest { deviceId: string; dpi: number; mode: 'color' | 'gray' | 'bw'; feeder: boolean }
/** `partial`: pages saved before the scanner stopped with an error, offered separately (never as a finished scan). */
export type ScanResult = { ok: true; files: string[] } | { ok: false; message: string; partial?: string[] };

/** WIA_ERROR_PAPER_EMPTY: the feeder has no (more) paper. */
const PAPER_EMPTY = 0x80210003;

type Runner = (script: string, env: Record<string, string>, timeoutMs: number) => Promise<string>;

const LIST = `$ErrorActionPreference = 'Stop'
$dm = New-Object -ComObject WIA.DeviceManager
$list = @($dm.DeviceInfos | Where-Object { $_.Type -eq 1 } | ForEach-Object { [pscustomobject]@{ id = [string]$_.DeviceID; name = [string]$_.Properties.Item('Name').Value } })
ConvertTo-Json -InputObject $list -Compress`;

// Reports what happened, decides nothing: the pages saved, and the error (message and HRESULT) it stopped on, if any.
const SCAN = `$ErrorActionPreference = 'Stop'
$result = [ordered]@{ files = @(); error = $null; hresult = $null }
function Note-Error($e) { $result.error = [string]$e.Exception.Message; $result.hresult = ('0x{0:X8}' -f $e.Exception.HResult) }
try {
  $png = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}'
  $dm = New-Object -ComObject WIA.DeviceManager
  $info = $dm.DeviceInfos | Where-Object { $_.DeviceID -eq $env:OAKQ_DEVICE } | Select-Object -First 1
  if (-not $info) { throw 'OAKQ_NO_DEVICE' }
  $dev = $info.Connect()
  $feeder = $env:OAKQ_FEEDER -eq '1'
  # document handling select: 1 feeder, 2 flatbed (not every scanner has it)
  try { $dev.Properties.Item('3088').Value = $(if ($feeder) { 1 } else { 2 }) } catch {}
  $item = $dev.Items.Item(1)
  function Set-Prop($id, $value) { try { $item.Properties.Item([string]$id).Value = $value } catch {} }
  Set-Prop 6146 ([int]$env:OAKQ_INTENT)
  Set-Prop 6147 ([int]$env:OAKQ_DPI)
  Set-Prop 6148 ([int]$env:OAKQ_DPI)
  $cd = New-Object -ComObject WIA.CommonDialog
  $max = $(if ($feeder) { 200 } else { 1 })
  for ($i = 1; $i -le $max; $i++) {
    try { $img = $cd.ShowTransfer($item, $png, $false) } catch { Note-Error $_; break }
    if (-not $img) { break }
    if ($img.FormatID -ne $png) {
      $ip = New-Object -ComObject WIA.ImageProcess
      $ip.Filters.Add($ip.FilterInfos.Item('Convert').FilterID)
      $ip.Filters.Item(1).Properties.Item('FormatID').Value = $png
      $img = $ip.Apply($img)
    }
    $path = Join-Path $env:OAKQ_OUT ('page-{0:D3}.png' -f $i)
    $img.SaveFile($path)
    $result.files += $path
  }
} catch { Note-Error $_ }
ConvertTo-Json -InputObject $result -Compress`;

const powershell: Runner = (script, env, timeoutMs) => {
  return new Promise((done, fail) => {
    // the fixed script as an encoded command (UTF-16LE, base64); values only through the environment
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Sta', '-EncodedCommand', encoded], { env: { ...process.env, ...env }, timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) fail(new Error(String(stderr || err.message))); else done(stdout.trim());
    });
  });
}

/** Friendly words for the WIA errors people actually meet. */
function explain(raw: string): string {
  const m = raw.toUpperCase();
  if (m.includes('OAKQ_NO_DEVICE') || m.includes('80210015')) return 'The scanner was not found. Check that it is switched on and connected, then refresh the list.';
  if (m.includes('80210003')) return 'The document feeder is empty. Put the pages in the feeder, or choose the flatbed.';
  if (m.includes('80210006')) return 'The scanner is busy. Wait for it to finish, then try again.';
  if (m.includes('80210005') || m.includes('8021000C') || m.includes('80210016')) return 'The scanner is offline or not ready. Check it, then try again.';
  if (m.includes('80210064') || m.includes('CANCEL')) return 'Scanning was cancelled.';
  if (m.includes('80210002')) return 'The paper is jammed in the scanner.';
  if (m.includes('80210001')) return 'The scanner reported a general error. Check the scanner, then try again.';
  if (m.includes('WIA.DEVICEMANAGER') || m.includes('80040154')) return 'Windows scanning (WIA) is not available on this computer.';
  return `Scanning failed: ${raw.split(/\r?\n/).find((l) => l.trim())?.slice(0, 200) ?? 'unknown error'}`;
}

export async function listScanners(): Promise<{ ok: true; devices: ScanDevice[] } | { ok: false; message: string }> {
  if (process.platform !== 'win32') return { ok: false, message: 'Scanning is available on Windows.' };
  try {
    const out = await powershell(LIST, {}, 30_000);
    const list = (out ? JSON.parse(out) : []) as unknown;
    const devices = (Array.isArray(list) ? list : []).flatMap((d) => (d && typeof d.id === 'string' && typeof d.name === 'string' ? [{ id: d.id, name: d.name }] : []));
    return { ok: true, devices };
  } catch (err) { return { ok: false, message: explain(err instanceof Error ? err.message : String(err)) }; }
}

/** Temporary folders this app created for scans; only these may be removed again. */
const scanDirs = new Set<string>();

export async function scan(req: ScanRequest, run: Runner = powershell): Promise<ScanResult> {
  if (process.platform !== 'win32') return { ok: false, message: 'Scanning is available on Windows.' };
  const dpi = [100, 150, 200, 300, 400, 600].includes(req.dpi) ? req.dpi : 200;
  const intent = { color: 1, gray: 2, bw: 4 }[req.mode] ?? 1;
  if (typeof req.deviceId !== 'string' || !req.deviceId || req.deviceId.length > 300) return { ok: false, message: 'Choose a scanner.' };
  const out = mkdtempSync(join(tmpdir(), 'oakqueill-scan-'));
  scanDirs.add(out);
  const discard = () => { scanDirs.delete(out); try { rmSync(out, { recursive: true, force: true }); } catch { /* left for the system */ } };
  let report: { files?: unknown; error?: unknown; hresult?: unknown };
  try {
    const raw = await run(SCAN, { OAKQ_DEVICE: req.deviceId, OAKQ_DPI: String(dpi), OAKQ_INTENT: String(intent), OAKQ_FEEDER: req.feeder ? '1' : '0', OAKQ_OUT: out }, 10 * 60_000);
    report = JSON.parse(raw || '{}');
  } catch (err) { discard(); return { ok: false, message: explain(err instanceof Error ? err.message : String(err)) }; }
  const files = (Array.isArray(report.files) ? report.files : []).filter((f): f is string => typeof f === 'string' && resolve(f).startsWith(out + sep));
  if (!report.error) {
    if (files.length) return { ok: true, files };
    discard(); return { ok: false, message: 'Scanning was cancelled.' };
  }
  const code = parseInt(String(report.hresult ?? ''), 16) >>> 0;
  // the feeder running out of paper after some pages is how a feeder scan normally ends
  if (req.feeder && files.length && code === PAPER_EMPTY) return { ok: true, files };
  const message = explain(`${String(report.hresult ?? '')} ${String(report.error)}`);
  if (!files.length) { discard(); return { ok: false, message }; }
  return { ok: false, message: `${message} ${files.length} page${files.length === 1 ? ' was' : 's were'} scanned before that.`, partial: files };
}

/** Remove the temporary scan folders (after the PDF is made, or when scanning is abandoned). */
export function clearScans(): void {
  for (const d of scanDirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* in use: left for the system to clean */ } }
  scanDirs.clear();
}
