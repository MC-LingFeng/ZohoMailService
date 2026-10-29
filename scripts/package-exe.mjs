import { build } from 'esbuild';
import { inject } from 'postject';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { chmod, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinnedVersion = (await readFile(join(root, '.nvmrc'), 'utf8')).trim();
const version = pinnedVersion.replace(/^v/, '');
if (process.version !== `v${version}`) {
  throw new Error(`打包需要 Node ${version}，请先在项目根目录执行 nvm use。`);
}
const target = process.argv.find((value) => value.startsWith('--target='))?.split('=')[1] || 'win-x64';
if (!['win-x64', 'native'].includes(target)) throw new Error('支持的目标：win-x64、native。');
const platform = target === 'native' ? process.platform : 'win32';
const arch = target === 'native' ? process.arch : 'x64';
const work = join(root, '.runtime', 'exe', `${platform}-${arch}`);
const outputDir = join(root, 'release');
await mkdir(work, { recursive: true });
await mkdir(outputDir, { recursive: true });
const webRoot = join(root, 'ZohoWeb', 'dist');
await readFile(join(webRoot, 'index.html'));
await readFile(join(root, 'ZohoService', 'dist', 'desktop.js'));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 退出码：${result.status}`);
}
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('发布资源中不允许符号链接。');
    if (entry.isDirectory()) paths.push(...await walk(item));
    else if (entry.isFile()) paths.push(item);
  }
  return paths.sort();
}

console.log('正在打包 NestJS 服务与桌面启动器…');
const bundle = join(work, 'bundle.cjs');
await build({
  entryPoints: [join(root, 'scripts', 'desktop-entry.cjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  keepNames: true,
  sourcemap: false,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['@nestjs/microservices', '@nestjs/websockets', '@nestjs/platform-socket.io', 'class-transformer/storage'],
});

const assets = {};
const files = [];
for (const file of await walk(webRoot)) {
  const name = relative(webRoot, file).split(sep).join('/');
  const content = await readFile(file);
  files.push({ path: name, sha256: hash(content) });
  assets[`web/${name}`] = file;
}
const manifest = { hash: hash(JSON.stringify(files)), files };
const manifestFile = join(work, 'web-manifest.json');
await writeFile(manifestFile, JSON.stringify(manifest));
assets['web-manifest'] = manifestFile;
const blob = join(work, 'sea-prep.blob');
const seaConfig = join(work, 'sea-config.json');
await writeFile(seaConfig, JSON.stringify({
  main: bundle, output: blob, assets,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: 'none',
}, null, 2));
run(process.execPath, ['--experimental-sea-config', seaConfig]);

async function fetchChecked(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`下载失败：${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const executable = join(outputDir, platform === 'win32' ? 'ZoHome-win-x64.exe' : `ZoHome-${platform}-${arch}`);
if (platform === 'win32' && target !== 'native') {
  const base = `https://nodejs.org/dist/v${version}`;
  const relativeBinary = 'win-x64/node.exe';
  const sums = (await fetchChecked(`${base}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).find((parts) => parts[1] === relativeBinary)?.[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new Error('官方清单中缺少 Windows Node SHA256。');
  const cached = join(work, `node-v${version}-win-x64.exe`);
  let content = await readFile(cached).catch(() => null);
  if (!content || hash(content) !== expected) {
    console.log(`正在下载官方 Node ${version} Windows x64 运行时…`);
    content = await fetchChecked(`${base}/${relativeBinary}`);
    if (hash(content) !== expected) throw new Error('Windows Node 运行时 SHA256 校验失败。');
    await writeFile(cached, content);
  }
  await copyFile(cached, executable);
} else {
  await copyFile(process.execPath, executable);
}

if (platform === 'darwin') run('/usr/bin/codesign', ['--remove-signature', executable]);
await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (platform !== 'win32') await chmod(executable, 0o755);
if (platform === 'darwin') run('/usr/bin/codesign', ['--force', '--sign', '-', executable]);

const checksum = hash(await readFile(executable));
await writeFile(`${executable}.sha256`, `${checksum}  ${executable.split(sep).at(-1)}\n`);
// Preserve runtime and bundled dependency licenses with the distribution.
const nodeLicenseFile = join(root, '.runtime', 'exe', `node-v${version}-LICENSE`);
let nodeLicense = await readFile(nodeLicenseFile, 'utf8').catch(() => null);
if (!nodeLicense) {
  nodeLicense = (await fetchChecked(`https://nodejs.org/dist/v${version}/LICENSE`)).toString('utf8');
  await writeFile(nodeLicenseFile, nodeLicense);
}
const notice = [
  'ZoHome runtime and bundled dependency license notices',
  `\n--- Node.js ${version} ---\n${nodeLicense}`,
];
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
for (const [packagePath, details] of Object.entries(lock.packages || {})) {
  if (details.dev || details.link || !(packagePath.startsWith('node_modules/') || packagePath.includes('/node_modules/'))) continue;
  try {
    const packageDir = join(root, packagePath);
    const info = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
    const license = (await readdir(packageDir)).find((name) => /^licen[cs]e(?:\.|$)/i.test(name));
    if (license) notice.push(`\n--- ${info.name} ${info.version} ---\n${await readFile(join(packageDir, license), 'utf8')}`);
    else notice.push(`\n${info.name} ${info.version}: ${info.license || 'see upstream package license'}`);
  } catch { /* Optional platform-specific dependencies may not be installed on this build host. */ }
}
await writeFile(join(outputDir, 'THIRD-PARTY-NOTICES.txt'), notice.join('\n'));
console.log(`已生成：${relative(root, executable)} (${((await readFile(executable)).length / 1024 / 1024).toFixed(1)} MB)`);
console.log(`SHA256：${checksum}`);
