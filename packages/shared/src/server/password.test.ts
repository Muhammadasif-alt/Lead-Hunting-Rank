import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './password.js';

test('argon2id hash verifies the right password and rejects the wrong one', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('Correct horse battery staple', hash), false);
  assert.notEqual(await hashPassword('correct horse battery staple'), hash, 'salted');
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
});

test('password policy is length-based, blocks common and email-derived passwords', () => {
  assert.equal(checkPasswordPolicy('short'), 'Use at least 10 characters — a short phrase works well.');
  assert.ok(checkPasswordPolicy('password123'));
  assert.ok(checkPasswordPolicy('aaaaaaaaaaaa'));
  assert.ok(checkPasswordPolicy('johnsmith-rocks', 'johnsmith@example.com'));
  assert.equal(checkPasswordPolicy('green lawns in austin'), null);
});
