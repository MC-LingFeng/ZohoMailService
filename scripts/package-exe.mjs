import { build } from 'esbuild';
import { inject } from 'postject';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pinnedVersion = (await readFile(join(root, '.nvmrc'), 'utf8')).trim();
const version = pinnedVersion.replace(/^v/, '');
if (process.version !== `v${version}`) {
  throw new Error(`打包需要 Node ${version}，请先在项目根目录执行 nvm use。`);
}
const target =
  process.argv.find((value) => value.startsWith('--target='))?.split('=')[1] ||
  'win-x64';
if (!['win-x64', 'native'].includes(target))
  throw new Error('支持的目标：win-x64、native。');
const platform = target === 'native' ? process.platform : 'win32';
const arch = target === 'native' ? process.arch : 'x64';
const work = join(root, '.runtime', 'exe', `${platform}-${arch}`);
const outputDir =
  target === 'native' ? join(work, 'verification') : join(root, 'release');
await mkdir(work, { recursive: true });
await mkdir(outputDir, { recursive: true });
const webRoot = join(root, 'ZohoWeb', 'dist');
await readFile(join(webRoot, 'index.html'));
await readFile(join(root, 'ZohoService', 'dist', 'desktop.js'));

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} 退出码：${result.status}`);
}
const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('发布资源中不允许符号链接。');
    if (entry.isDirectory()) paths.push(...(await walk(item)));
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
  external: [
    '@nestjs/microservices',
    '@nestjs/websockets',
    '@nestjs/platform-socket.io',
    'class-transformer/storage',
  ],
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
await writeFile(
  seaConfig,
  JSON.stringify(
    {
      main: bundle,
      output: blob,
      assets,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: 'none',
    },
    null,
    2,
  ),
);
run(process.execPath, ['--experimental-sea-config', seaConfig]);

async function fetchChecked(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!response.ok) throw new Error(`下载失败：${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

function runtimeFromTarball(compressed) {
  const tar = gunzipSync(compressed);
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').split('\0')[0];
    if (!name) break;
    const size = Number.parseInt(
      header.subarray(124, 136).toString('ascii').replace(/\0/g, '').trim(),
      8,
    );
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > tar.length)
      throw new Error('无效的 Node 运行时压缩包。');
    if (name === 'package/bin/node.exe')
      return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('Node 运行时压缩包中没有 node.exe。');
}

const executable = join(
  outputDir,
  platform === 'win32' ? 'ZoHome-win-x64.exe' : `ZoHome-${platform}-${arch}`,
);
if (platform === 'win32' && target !== 'native') {
  const base = `https://nodejs.org/dist/v${version}`;
  const relativeBinary = 'win-x64/node.exe';
  const sums = (await fetchChecked(`${base}/SHASUMS256.txt`)).toString('utf8');
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === relativeBinary)?.[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('官方清单中缺少 Windows Node SHA256。');
  const cached = join(work, `node-v${version}-win-x64.exe`);
  let content = await readFile(cached).catch(() => null);
  if (!content || hash(content) !== expected) {
    console.log(`正在下载官方 Node ${version} Windows x64 运行时…`);
    // npm is a faster distribution mirror in some regions. The extracted binary
    // must still match Node's official checksum, independently of this mirror.
    try {
      const mirror = `https://registry.npmjs.org/node-win-x64/-/node-win-x64-${version}.tgz`;
      content = runtimeFromTarball(await fetchChecked(mirror));
    } catch (error) {
      console.warn(`镜像下载未完成，改用 Node 官方站点：${error.message}`);
      content = await fetchChecked(`${base}/${relativeBinary}`);
    }
    if (hash(content) !== expected)
      throw new Error('Windows Node 运行时 SHA256 校验失败。');
    await writeFile(cached, content);
  }
  await copyFile(cached, executable);
} else {
  await copyFile(process.execPath, executable);
}

if (platform === 'win32') {
  // The repackaged executable is a new, unsigned application. Do not retain
  // the original runtime's Authenticode signature after changing its bytes.
  // PE32+/PE32 certificate directory offsets follow Microsoft's PE format.
  let binary = await readFile(executable);
  if (binary.toString('ascii', 0, 2) !== 'MZ')
    throw new Error('Windows 运行时不是有效 PE 文件。');
  const pe = binary.readUInt32LE(0x3c);
  if (binary.readUInt32LE(pe) !== 0x4550)
    throw new Error('Windows 运行时 PE 签名无效。');
  const optional = pe + 24;
  const magic = binary.readUInt16LE(optional);
  const certificate =
    optional +
    (magic === 0x20b
      ? 112
      : magic === 0x10b
        ? 96
        : (() => {
            throw new Error('不支持的 PE 格式。');
          })()) +
    4 * 8;
  const certificateOffset = binary.readUInt32LE(certificate);
  const certificateSize = binary.readUInt32LE(certificate + 4);
  binary.writeUInt32LE(0, certificate);
  binary.writeUInt32LE(0, certificate + 4);
  if (
    certificateOffset > 0 &&
    certificateOffset + certificateSize === binary.length
  )
    binary = binary.subarray(0, certificateOffset);
  await writeFile(executable, binary);
}
if (platform === 'darwin')
  run('/usr/bin/codesign', ['--remove-signature', executable]);
await inject(executable, 'NODE_SEA_BLOB', await readFile(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
});
if (platform !== 'win32') await chmod(executable, 0o755);
if (platform === 'darwin')
  run('/usr/bin/codesign', ['--force', '--sign', '-', executable]);

const checksum = hash(await readFile(executable));
await writeFile(
  `${executable}.sha256`,
  `${checksum}  ${executable.split(sep).at(-1)}\n`,
);
// Preserve runtime and bundled dependency licenses with the distribution.
const nodeLicenseFile = join(
  root,
  '.runtime',
  'exe',
  `node-v${version}-LICENSE`,
);
let nodeLicense = await readFile(nodeLicenseFile, 'utf8').catch(() => null);
if (!nodeLicense) {
  nodeLicense = await readFile(
    resolve(dirname(process.execPath), '..', 'LICENSE'),
    'utf8',
  ).catch(() => null);
  if (!nodeLicense)
    nodeLicense = (
      await fetchChecked(
        `https://raw.githubusercontent.com/nodejs/node/v${version}/LICENSE`,
      )
    ).toString('utf8');
  await writeFile(nodeLicenseFile, nodeLicense);
}
const notice = [
  'ZoHome runtime and bundled dependency license notices',
  `\n--- Node.js ${version} ---\n${nodeLicense}`,
];
const lock = JSON.parse(
  await readFile(join(root, 'package-lock.json'), 'utf8'),
);
for (const [packagePath, details] of Object.entries(lock.packages || {})) {
  if (
    details.dev ||
    details.link ||
    !(
      packagePath.startsWith('node_modules/') ||
      packagePath.includes('/node_modules/')
    )
  )
    continue;
  try {
    const packageDir = join(root, packagePath);
    const info = JSON.parse(
      await readFile(join(packageDir, 'package.json'), 'utf8'),
    );
    const license = (await readdir(packageDir)).find((name) =>
      /^licen[cs]e(?:\.|$)/i.test(name),
    );
    if (license)
      notice.push(
        `\n--- ${info.name} ${info.version} ---\n${await readFile(join(packageDir, license), 'utf8')}`,
      );
    else
      notice.push(
        `\n${info.name} ${info.version}: ${info.license || 'see upstream package license'}`,
      );
  } catch {
    /* Optional platform-specific dependencies may not be installed on this build host. */
  }
}
await writeFile(join(outputDir, 'THIRD-PARTY-NOTICES.txt'), notice.join('\n'));
await copyFile(
  join(root, 'docs', 'windows-exe.md'),
  join(outputDir, 'README.md'),
);
for (const name of ['google-ads.md', 'outlook.md']) {
  await copyFile(join(root, 'docs', name), join(outputDir, name));
}
console.log(
  `已生成：${relative(root, executable)} (${((await readFile(executable)).length / 1024 / 1024).toFixed(1)} MB)`,
);
console.log(`SHA256：${checksum}`);
