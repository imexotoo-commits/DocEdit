// Builds release/Oakqueill-Portable-<version>.exe from an unpacked app folder (default: release/win-unpacked).
//
// electron-builder's own portable target shows only a still image while it unpacks. This wrapper (build/portable.nsi)
// unpacks with progress and shows the splash animation from portable-splash.mjs: the quill writes a line of ink as
// the app unpacks. It uses the same NSIS, plugins and 7-Zip electron-builder downloads, and runs the app the same way.
//
//   node scripts/build-portable.mjs [--app <unpacked app folder>]
// The release workflow passes --app with the signed program, so the portable exe carries the signed Oakqueill.exe.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_COUNT, writeSplashFrames } from './portable-splash.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const builderLib = dirname(require.resolve('app-builder-lib/package.json'));
const { getMakeNsisPath, getNsisPluginsPath } = await import(pathToUrl(join(builderLib, 'out/toolsets/windows.js')));
const { getPath7za } = await import(pathToUrl(join(builderLib, 'out/toolsets/7zip.js')));

const args = process.argv.slice(2);
const appArg = args.indexOf('--app');
const appDir = resolve(root, appArg >= 0 ? args[appArg + 1] : 'release/win-unpacked');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const outFile = join(root, 'release', `Oakqueill-Portable-${version}.exe`);
const icon = join(root, 'release/.icon-ico/icon.ico');

if (!existsSync(join(appDir, 'Oakqueill.exe'))) throw new Error(`No Oakqueill.exe in ${appDir}; build the app first (electron-builder --dir).`);
if (!existsSync(icon)) throw new Error(`No ${icon}; electron-builder writes it while building the app or installer.`);

const work = mkdtempSync(join(tmpdir(), 'oakq-portable-'));
try {
  // the app, as one 7z archive (the contents of the folder, not the folder)
  const archive = join(work, 'app.7z');
  execFileSync(await getPath7za(), ['a', '-t7z', '-mx=7', '-mmt=on', '-bd', '-bso0', archive, '.'], { cwd: appDir, stdio: 'inherit' });

  const frames = join(work, 'splash');
  mkdirSync(frames);
  writeSplashFrames(frames, join(root, 'build/portable-splash-base.bmp'));

  // electron-builder's defaults: no toolset version set, so the bundled NSIS 3.0.4.1 and its resources
  const makensis = await getMakeNsisPath(undefined, undefined);
  const plugins = join(await getNsisPluginsPath(undefined, undefined), 'x86-unicode');
  mkdirSync(dirname(outFile), { recursive: true });
  rmSync(outFile, { force: true });
  const define = (k, v) => `-D${k}=${v}`;
  execFileSync(makensis.path, [
    '-V2', '-WX', '-INPUTCHARSET', 'UTF8',
    define('OUT_FILE', outFile), define('APP_ARCHIVE', archive), define('FRAMES_DIR', frames), define('ICON', icon),
    define('FRAME_COUNT', FRAME_COUNT), define('LAST_FRAME', String(FRAME_COUNT - 1).padStart(2, '0')),
    define('VERSION', version), define('VERSION_4', `${version.replace(/[^0-9.].*$/, '')}.0`.split('.').slice(0, 4).join('.')),
    define('PLUGINS_DIR', plugins),
    join(root, 'build/portable.nsi'),
  ], { stdio: 'inherit', env: { ...process.env, ...makensis.env } });
  console.log(`portable build ok: ${outFile}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

function pathToUrl(p) { return new URL(`file:///${p.replace(/\\/g, '/')}`).href; }
