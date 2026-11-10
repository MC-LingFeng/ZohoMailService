import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Request, Response } from 'express';
import { AppConfig } from '../src/config';
import { decryptToken, encryptToken, SessionService } from '../src/security';

test('refresh credentials are authenticated ciphertext and reject tampering', () => {
  const key = 'ab'.repeat(32);
  const encrypted = encryptToken('private-refresh-token', key);
  assert.notEqual(encrypted, 'private-refresh-token');
  assert.equal(encrypted.includes('private-refresh-token'), false);
  assert.equal(decryptToken(encrypted, key), 'private-refresh-token');
  assert.throws(() => decryptToken(encrypted, 'cd'.repeat(32)));
  const parts = encrypted.split('.');
  parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => decryptToken(parts.join('.'), key));
});

test('OAuth state is bound to the logged in session, one-use and invalid after logout', () => {
  const config = new AppConfig();
  const sessions = new SessionService(config);
  let cookie = '';
  const res = {
    cookie: (_name: string, value: string) => {
      cookie = value;
    },
    clearCookie: () => undefined,
  } as unknown as Response;
  const req = { cookies: {}, ip: '127.0.0.1' } as unknown as Request;
  sessions.login(req, res, '');
  const loggedIn = {
    ...req,
    cookies: { zohome_session: cookie },
  } as unknown as Request;
  const state = sessions.createState(loggedIn);
  assert.equal(sessions.consumeState(state, loggedIn), true);
  assert.equal(sessions.consumeState(state, loggedIn), false);
  const wrongSessionState = sessions.createState(loggedIn);
  assert.equal(sessions.consumeState(wrongSessionState, req), false);
  assert.equal(sessions.consumeState(wrongSessionState, loggedIn), false);
  const logoutState = sessions.createState(loggedIn);
  sessions.logout(loggedIn, res);
  assert.equal(sessions.consumeState(logoutState, loggedIn), false);
});

test('login limits normalized usernames and caps random-name attempts per IP before further password hashing', () => {
  const config = Object.assign(new AppConfig(), { mode: 'live', password: 'synthetic-login-password' });
  const sessions = new SessionService(config);
  const req = { cookies: {}, ip: 'normalized-ip' } as unknown as Request;
  const response = { cookie: () => undefined, clearCookie: () => undefined } as unknown as Response;
  for (let attempt = 0; attempt < 10; attempt++) {
    assert.throws(() => sessions.login(req, response, 'wrong password', `${' '.repeat(attempt)}AdMiN `), /用户名或密码不正确/);
  }
  assert.throws(() => sessions.login(req, response, config.password, ' admin '), /尝试次数过多/);
  const other = { cookies: {}, ip: 'random-name-ip' } as unknown as Request;
  for (let attempt = 0; attempt < 50; attempt++) {
    assert.throws(() => sessions.login(other, response, 'wrong password', `random-${attempt}`), /用户名或密码不正确/);
  }
  assert.throws(() => sessions.login(other, response, config.password, 'new-random-name'), /尝试次数过多/);
  const separate = { cookies: {}, ip: 'unblocked-ip' } as unknown as Request;
  assert.deepEqual(sessions.login(separate, response, config.password, ' ADMIN '), { success: true });
});
