import test from 'node:test';
import assert from 'node:assert/strict';
import { AppConfig } from '../src/config';

function withConfiguration(
  values: Record<string, string | undefined>,
  check: (config: AppConfig) => void,
) {
  const keys = [
    'APP_MODE',
    'PORT',
    'WEB_ROOT',
    'FRONTEND_URL',
    'ZOHO_REDIRECT_URI',
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    for (const key of keys) {
      const value = key === 'APP_MODE' ? 'demo' : values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    check(new AppConfig());
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('development URL defaults continue to use Vite when static hosting is unset', () => {
  withConfiguration({ PORT: '3001' }, (config) => {
    assert.equal(config.frontendUrl, 'http://localhost:5173');
    assert.equal(
      config.redirectUri,
      'http://localhost:5173/api/auth/zoho/callback',
    );
  });
});

test('production static hosting defaults public URLs to the same server port', () => {
  withConfiguration({ WEB_ROOT: '/app/web', PORT: '3107' }, (config) => {
    assert.equal(config.frontendUrl, 'http://localhost:3107');
    assert.equal(
      config.redirectUri,
      'http://localhost:3107/api/auth/zoho/callback',
    );
  });
});

test('explicit public URLs and OAuth callbacks are preserved in production', () => {
  withConfiguration(
    {
      WEB_ROOT: '/app/web',
      FRONTEND_URL: 'https://mailbox.example.com/',
      ZOHO_REDIRECT_URI: 'https://mailbox.example.com/custom-callback',
    },
    (config) => {
      assert.equal(config.frontendUrl, 'https://mailbox.example.com/');
      assert.equal(
        config.redirectUri,
        'https://mailbox.example.com/custom-callback',
      );
    },
  );
  withConfiguration(
    { WEB_ROOT: '/app/web', FRONTEND_URL: 'https://mailbox.example.com/' },
    (config) => {
      assert.equal(
        config.redirectUri,
        'https://mailbox.example.com/api/auth/zoho/callback',
      );
    },
  );
});
