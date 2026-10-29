import 'reflect-metadata';
import 'dotenv/config';
import { createApp } from './bootstrap';
import { AppConfig } from './config';

async function main() {
  const app = await createApp();
  const config = app.get(AppConfig);
  await app.listen(config.port, config.host);
  console.log(
    `ZoHome Service (${config.mode}): http://${config.host}:${config.port}/api/status`,
  );
}
void main().catch(() => {
  console.error('ZoHome 启动失败。请检查配置和上方错误信息。');
  process.exitCode = 1;
});
