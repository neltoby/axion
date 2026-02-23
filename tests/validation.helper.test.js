const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ensureEmail,
  ensurePassword,
  ensurePositiveInteger,
  ensureArrayOfStrings,
} = require('../managers/_common/validation.helper');

test('ensureEmail validates email format', () => {
  assert.equal(ensureEmail({ value: 'john@example.com' }), null);
  assert.match(String(ensureEmail({ value: 'invalid' })), /invalid/i);
});

test('ensurePassword enforces complexity and length', () => {
  assert.equal(ensurePassword({ value: 'StrongPass123' }), null);
  assert.match(String(ensurePassword({ value: 'weakpass' })), /uppercase/i);
});

test('ensurePositiveInteger validates range', () => {
  assert.equal(ensurePositiveInteger({ value: 10, field: 'capacity', min: 1, max: 20 }), null);
  assert.match(String(ensurePositiveInteger({ value: -1, field: 'capacity' })), /between/i);
});

test('ensureArrayOfStrings validates each element', () => {
  assert.equal(
    ensureArrayOfStrings({ value: ['projector', 'ac'], field: 'resources', required: false }),
    null
  );
  assert.match(
    String(ensureArrayOfStrings({ value: ['ok', 1], field: 'resources', required: false })),
    /must be a string/i
  );
});
