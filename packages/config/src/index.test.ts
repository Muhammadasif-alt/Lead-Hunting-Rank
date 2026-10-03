import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from './index.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6380',
};

test('applies defaults', () => {
  const cfg = parseConfig(base);
  assert.equal(cfg.APP_ENV, 'development');
  assert.equal(cfg.API_PORT, 4000);
  assert.equal(cfg.LOG_LEVEL, 'info');
  assert.equal(cfg.LOG_PRETTY, true);
});

test('pretty logs default off outside development', () => {
  assert.equal(parseConfig({ ...base, APP_ENV: 'staging' }).LOG_PRETTY, false);
});

test('fails clearly when required values are missing', () => {
  assert.throws(() => parseConfig({}), /DATABASE_URL[\s\S]*REDIS_URL/);
});

test('empty strings count as unset', () => {
  assert.equal(parseConfig({ ...base, LLM_API_KEY: '' }).LLM_API_KEY, undefined);
});

test('production requires an encryption key', () => {
  assert.throws(() => parseConfig({ ...base, APP_ENV: 'production' }), /ENCRYPTION_KEY: required in production/);
  const key = Buffer.alloc(32, 1).toString('base64');
  assert.equal(parseConfig({ ...base, APP_ENV: 'production', ENCRYPTION_KEY: key }).ENCRYPTION_KEY, key);
});

test('real LLM provider requires an API key', () => {
  assert.throws(() => parseConfig({ ...base, LLM_PROVIDER: 'anthropic' }), /LLM_API_KEY/);
});
