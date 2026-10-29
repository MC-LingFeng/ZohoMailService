const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sea = require('node:sea');
const { resolveDesktopHome, startDesktop } = require('../ZohoService/dist/desktop');

function extractWebAssets() {
  const manifest = JSON.parse(sea.getAsset('web-manifest', 'utf8'));
  if (!/^[a-f0-9]{64}$/.test(manifest.hash) || !Array.isArray(manifest.files)) {
    throw new Error('内置页面资源清单无效，请重新构建 ZoHome。');
  }
  const root = path.join(resolveDesktopHome(), 'web', manifest.hash.slice(0, 16));
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || file.path.includes('\\') || file.path.split('/').some((part) => !part || part === '.' || part === '..')) {
      throw new Error('内置页面资源路径无效。');
    }
    const output = path.resolve(root, file.path);
    if (!output.startsWith(`${root}${path.sep}`)) throw new Error('无效的内置资源路径。');
    const content = Buffer.from(sea.getAsset(`web/${file.path}`));
    if (crypto.createHash('sha256').update(content).digest('hex') !== file.sha256) {
      throw new Error('内置页面资源校验失败，请重新获取 ZoHome。');
    }
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    const temporary = `${output}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, content, { mode: 0o600 });
    try { fs.renameSync(temporary, output); }
    catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  }
  return root;
}

async function main() {
  process.env.ZOHOME_WEB_DIR = sea.isSea()
    ? extractWebAssets()
    : process.env.ZOHOME_WEB_DIR || path.resolve(__dirname, '../ZohoWeb/dist');
  await startDesktop();
}

void main().catch((error) => {
  console.error(`ZoHome 启动失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
});
