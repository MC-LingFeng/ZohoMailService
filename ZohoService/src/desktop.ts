import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { INestApplication } from '@nestjs/common';
import { createApp } from './bootstrap';
import { loadDesktopConfiguration } from './desktop-config';
export {
  desktopHome as resolveDesktopHome,
  desktopHome,
} from './desktop-config';

export interface DesktopRuntime {
  app: INestApplication;
  url: string;
  configPath: string;
  close: () => Promise<void>;
}

export interface DesktopOptions {
  home?: string;
  webRoot?: string;
  openBrowser?: boolean;
}

function launchBrowser(url: string) {
  const command =
    process.platform === 'win32'
      ? 'rundll32.exe'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open';
  const args =
    process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, {
    windowsHide: true,
    detached: false,
    stdio: 'ignore',
    shell: false,
  });
  child.once('error', () =>
    console.warn(`浏览器未能自动打开，请手动访问 ${url}`),
  );
  child.unref();
}

export async function startDesktop(
  options: DesktopOptions = {},
): Promise<DesktopRuntime> {
  const configuredRoot = options.webRoot || process.env.ZOHOME_WEB_DIR;
  if (
    !configuredRoot ||
    !existsSync(join(resolve(configuredRoot), 'index.html'))
  ) {
    throw new Error('ZoHome 前端资源缺失，请重新解压或下载完整程序');
  }
  const configuration = loadDesktopConfiguration(options.home);
  // This entry deliberately does not load dotenv/config or any workspace environment file.
  Object.assign(process.env, configuration.env);
  const app = await createApp({
    webRoot: configuredRoot,
    shutdownHooks: false,
    settingsFile: configuration.configPath,
    desktopSettings: true,
  });
  const listeners = new Map<NodeJS.Signals, () => void>();
  let closing: Promise<void> | undefined;
  let stopping = false;
  const close = () => {
    if (!closing) {
      closing = (async () => {
        for (const [signal, listener] of listeners)
          process.removeListener(signal, listener);
        listeners.clear();
        await app.close();
      })();
    }
    return closing;
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log('\nZoHome 正在关闭，网页服务和后台服务将一起停止。');
    const timeout = setTimeout(() => process.exit(0), 8_000);
    timeout.unref();
    void close().then(
      () => {
        clearTimeout(timeout);
        process.exit(0);
      },
      () => {
        clearTimeout(timeout);
        process.exit(1);
      },
    );
  };
  for (const signal of [
    'SIGINT',
    'SIGTERM',
    'SIGHUP',
    ...(process.platform === 'win32' ? ['SIGBREAK'] : []),
  ] as NodeJS.Signals[]) {
    const listener = () => stop();
    listeners.set(signal, listener);
    process.on(signal, listener);
  }
  try {
    await app.listen(Number(configuration.env.PORT), configuration.env.HOST);
  } catch (error) {
    await close();
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
    ) {
      throw new Error(
        `端口 ${configuration.env.PORT} 已被使用。请关闭已有 ZoHome 窗口，或在 ${configuration.configPath} 修改 PORT。`,
      );
    }
    throw error;
  }
  const url = configuration.env.FRONTEND_URL;
  console.log(
    `\nZoHome 已启动（${configuration.env.APP_MODE === 'demo' ? '演示模式' : '真实邮箱模式'}）\n访问地址：${url}\n配置文件：${configuration.configPath}\n数据目录：${configuration.env.DATA_DIR}\n关闭此控制台窗口或按 Ctrl+C，ZoHome 服务将同时停止。\n`,
  );
  if (options.openBrowser !== false && process.env.ZOHOME_NO_BROWSER !== '1')
    launchBrowser(url);
  return { app, url, configPath: configuration.configPath, close };
}
