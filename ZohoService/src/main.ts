import 'reflect-metadata';
import { loadRuntimeEnvironment } from './runtime-env';
import { createApp } from './bootstrap';
import { AppConfig } from './config';

loadRuntimeEnvironment();

async function main() {
  // Production serves the built web app from the same process; development keeps the Vite proxy flow.
  const app = await createApp({ webRoot: process.env.WEB_ROOT || undefined });
  const config = app.get(AppConfig);
  await app.listen(config.port, config.host);
  console.log(
    `ZoHome Service (${config.mode}): http://${config.host}:${config.port}/api/status`,
  );
}
void main().catch((error: unknown) => {
  console.error(
    'ZoHome 启动失败：',
    error instanceof Error ? error.message : '请检查服务端配置',
  );
  process.exitCode = 1;
});
