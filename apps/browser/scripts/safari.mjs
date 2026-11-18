// Makes the Safari app and extension: builds the web extension for Safari, has Apple's converter wrap it in an Xcode
// project (macOS only) under apps/browser/safari/, and builds that project.
//
//   node scripts/safari.mjs            convert and build (unsigned; for your own Mac you then enable it in Safari)
//   node scripts/safari.mjs --open     also open the project in Xcode (to sign, archive and distribute)
//
// The Xcode project is generated every time and is not committed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'Oakqueill PDF Viewer';
const BUNDLE_ID = 'app.docedit.safari';
const run = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts }); if (r.status !== 0) { console.error(`${cmd} failed (exit ${r.status})`); process.exit(r.status ?? 1); } };

if (process.platform !== 'darwin') { console.error('The Safari extension is built on a Mac with Xcode.'); process.exit(1); }
run('node', ['scripts/build.mjs', '--target', 'safari']);
rmSync(join(root, 'safari'), { recursive: true, force: true });
run('xcrun', ['safari-web-extension-converter', 'dist-safari', '--project-location', 'safari', '--app-name', APP, '--bundle-identifier', BUNDLE_ID, '--macos-only', '--no-open', '--no-prompt', '--force']);
const project = join(root, 'safari', APP, `${APP}.xcodeproj`);
if (!existsSync(project)) { console.error(`The converter did not produce ${project}`); process.exit(1); }
// The converter names the extension "<id>.Extension" but derives a different id for the app from its name; an extension's id
// must start with its app's id, so set the app's id to the one asked for. (Xcode 27 writes project.xcproj, older ones project.pbxproj.)
for (const file of ['project.xcproj', 'project.pbxproj']) {
  const f = join(project, file);
  if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('app.docedit.Oakqueill-PDF-Viewer', BUNDLE_ID));
}
run('xcodebuild', ['-project', project, '-scheme', APP, '-configuration', 'Debug', '-derivedDataPath', join(root, 'safari', 'build'), 'CODE_SIGNING_ALLOWED=NO', 'build']);
console.log(`\nBuilt: ${join(root, 'safari', 'build', 'Build', 'Products', 'Debug', `${APP}.app`)}`);
if (process.argv.includes('--open')) run('open', [project]);
