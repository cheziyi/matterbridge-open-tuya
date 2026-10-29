/**
 * @file src/errors.ts
 * @description This file contains the description of the errors of open-tuya for the log and the setup page.
 * @author Calvin Che
 * @created 2026-10-29
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 Calvin Che.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { TuyaError, type TuyaErrorCode } from 'open-tuya';

/**
 * Do nothing with a failure that changes nothing, such as one of a connection that is being closed anyway
 *
 * @returns {void}
 */
export function ignoreFailure(): void {
  // Intentionally empty.
}

/**
 * Describe an error in one line
 *
 * @param {unknown} error The error.
 * @returns {string} Its message, or its string form when it is not an Error.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Get the code of a failed call to a device or a cloud
 *
 * A call that failed on several routes carries the error of each in its cause: the code of the last is taken, the
 * cloud's, since the LAN is tried first.
 *
 * @param {unknown} error The error.
 * @returns {TuyaErrorCode | undefined} The `code` of a `TuyaError`, or undefined for any other error.
 */
export function getErrorCode(error: unknown): TuyaErrorCode | undefined {
  if (!(error instanceof TuyaError)) return undefined;
  if (error.code === 'ROUTES_FAILED' && error.cause instanceof AggregateError) {
    const last: unknown = error.cause.errors.at(-1);
    return getErrorCode(last) ?? error.code;
  }
  return error.code;
}

/**
 * Tell whether a call failed because the cloud no longer accepts the sign in
 *
 * @param {unknown} error The error.
 * @returns {boolean} True for a `TuyaError` with code `SESSION_EXPIRED`, on its own or as the last of several routes.
 */
export function isSignInRequired(error: unknown): boolean {
  return getErrorCode(error) === 'SESSION_EXPIRED';
}

/** What each code means for the user, and what to do about it. */
const codeDescriptions: Partial<Readonly<Record<TuyaErrorCode, string>>> = {
  CONNECTION_FAILED: 'No connection opened: check that the device is plugged in and online in the Smart Life app, and that Matterbridge reaches the internet',
  CONNECTION_LOST: 'The connection closed',
  REQUEST_TIMED_OUT: 'The device or the cloud did not answer in time',
  DECRYPTION_FAILED: 'The local key or the protocol version of the device is wrong: read the device list again, or check the version given in its options',
  SESSION_KEY_NEGOTIATION_FAILED: 'The local key or the protocol version of the device is wrong: read the device list again, or check the version given in its options',
  SESSION_EXPIRED: 'The Tuya cloud no longer accepts the sign in: sign in again',
  RATE_LIMITED: 'The Tuya cloud was asked too often: wait a minute, then try again',
  PERMISSION_DENIED: 'The Tuya developer platform refused the request: check the IoT Core plan and the API services of the cloud project',
  QR_CODE_EXPIRED: 'The QR code expired: ask for a new one',
  DISCOVERY_FAILED: 'Another program holds a port the discovery of devices on the LAN listens on',
};

/**
 * Describe a failed call in words the setup page can show
 *
 * Edge cases:
 *  - a code with a description -> the description, then the message of the error
 *  - any other error -> its own message
 *
 * @param {unknown} error The error the call rejected with.
 * @returns {string} What went wrong and what to do.
 */
export function describeError(error: unknown): string {
  const code = getErrorCode(error);
  const description = code === undefined ? undefined : codeDescriptions[code];
  const message = getErrorMessage(error);
  return description === undefined ? message : `${description} (${message})`;
}
