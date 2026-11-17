// Stand-in for LibreOffice in tests. Behaviour comes from FAKE_SOFFICE_MODE: ok | fail | hang | nothing.
// It records its arguments and the profile settings it was given to FAKE_SOFFICE_LOG.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const mode = process.env.FAKE_SOFFICE_MODE ?? 'ok';
const outDir = args[args.indexOf('--outdir') + 1];
const input = args.at(-1);
const profileArg = args.find((a) => a.startsWith('-env:UserInstallation='));
const profile = profileArg ? fileURLToPath(profileArg.slice('-env:UserInstallation='.length)) : null;
if (process.env.FAKE_SOFFICE_LOG) {
  writeFileSync(process.env.FAKE_SOFFICE_LOG, JSON.stringify({
    args, inputContent: readFileSync(input, 'utf8'),
    settings: profile ? readFileSync(join(profile, 'user', 'registrymodifications.xcu'), 'utf8') : null,
  }));
}
if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'fail') { process.stderr.write('Error: source file could not be loaded'); process.exit(1); }
else if (mode === 'nothing') process.exit(0);
else { writeFileSync(join(outDir, basename(input).replace(/\.[^.]+$/, '.pdf')), '%PDF-1.7\n% converted\n'); process.exit(0); }
