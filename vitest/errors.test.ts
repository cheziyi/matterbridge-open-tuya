/**
 * @file vitest/errors.test.ts
 * @description This file contains the tests for the description of the errors of open-tuya.
 * @author Calvin Che
 */

import { TuyaError } from 'open-tuya';

import { describeError, getErrorCode, getErrorMessage, ignoreFailure, isSignInRequired } from '../src/errors.js';

describe('errors', () => {
  test('should describe any error in one line', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage('boom')).toBe('boom');
    expect(ignoreFailure()).toBeUndefined();
  });

  test('should read the code of a TuyaError, and the last route of several', () => {
    expect(getErrorCode(new TuyaError('RATE_LIMITED', 'slow down'))).toBe('RATE_LIMITED');
    expect(getErrorCode(new Error('boom'))).toBeUndefined();
    const failed = new TuyaError('ROUTES_FAILED', 'every route failed', {
      cause: new AggregateError([new TuyaError('CONNECTION_FAILED', 'lan'), new TuyaError('SESSION_EXPIRED', 'cloud')]),
    });
    expect(getErrorCode(failed)).toBe('SESSION_EXPIRED');
    expect(isSignInRequired(failed)).toBe(true);
    // A route that failed with something else than a TuyaError leaves the code of the whole.
    const plain = new TuyaError('ROUTES_FAILED', 'every route failed', { cause: new AggregateError([new Error('boom')]) });
    expect(getErrorCode(plain)).toBe('ROUTES_FAILED');
    expect(getErrorCode(new TuyaError('ROUTES_FAILED', 'no cause'))).toBe('ROUTES_FAILED');
    expect(isSignInRequired(new TuyaError('CONNECTION_FAILED', 'lan'))).toBe(false);
  });

  test('should describe a code in words the setup page can show, and keep the message', () => {
    expect(describeError(new TuyaError('QR_CODE_EXPIRED', 'expired'))).toBe('The QR code expired: ask for a new one (expired)');
    expect(describeError(new TuyaError('MALFORMED_FRAME', 'garbage'))).toBe('garbage');
    expect(describeError(new Error('boom'))).toBe('boom');
  });
});
