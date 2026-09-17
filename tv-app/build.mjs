// Builds tv-app/dist/ — the tree that coopcentric-tenant deploys into every tenant's
// procentric/application/. Static files are copied verbatim; src/main.js is bundled to
// dist/app.js targeting ES2015 (older HCAP-only sets run old Chromium).
import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, createHash } from './buildutil.mjs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

let version = 'dev';
try { version = execSync('git describe --always --dirty', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
version += '-' + new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const f of ['index.html', 'probe.html', 'lib', 'fonts']) cpSync(join(root, f), join(dist, f), { recursive: true });
cpSync(join(root, '..', 'shared', 'zones.css'), join(dist, 'zones.css'));   // shared with the admin preview
writeFileSync(join(dist, 'version.txt'), version + '\n');

const opts = {
  entryPoints: [join(root, 'src/main.js')],
  bundle: true,
  outfile: join(dist, 'app.js'),      // renamed to app.<hash>.js after the build (long-cacheable)
  target: ['es2015'],
  format: 'iife',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  logLevel: 'info',
};
if (watch) { const ctx = await context(opts); await ctx.watch(); console.log('watching…'); }
else {
  await build(opts);
  // Content-hash the bundle so nginx can cache it for a long time while index.html stays no-store.
  const js = readFileSync(join(dist, 'app.js'));
  const hash = createHash('sha256').update(js).digest('hex').slice(0, 12);
  const hashed = `app.${hash}.js`;
  writeFileSync(join(dist, hashed), js);
  rmSync(join(dist, 'app.js'));
  const html = readFileSync(join(dist, 'index.html'), 'utf8').replace('./app.js', './' + hashed);
  writeFileSync(join(dist, 'index.html'), html);
  console.log(`built tv-app ${version} -> ${dist} (${hashed})`);
}
