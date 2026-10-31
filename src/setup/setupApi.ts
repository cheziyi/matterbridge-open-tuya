/**
 * @file src/setup/setupApi.ts
 * @description This file contains the REST API of the guided setup page, which Matterbridge serves through onFetch.
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

import { isValidObject, isValidString } from 'matterbridge/utils';
import type { ControlValues, DeveloperDataCenter } from 'open-tuya';

import type { DeviceRoute } from '../accessory/tuyaAccessory.js';
import { DATA_CENTERS, isMember, isValidDeviceId, normalizeHost, parseDeviceConfig, type TuyaDeviceConfig } from '../config.js';
import { getErrorMessage } from '../errors.js';
import type { DeviceFeatures } from '../features.js';
import type { LanAddress } from '../platform/addressStore.js';
import type { DeviceSupport, ProbeResult } from './probe.js';

/** A stored device as the setup page sees it, with how it is doing: never its local key. */
export type SetupDevice = Omit<TuyaDeviceConfig, 'localKey'> & {
  /** `online`, `connecting` until its first read ends and `offline` for a running device, `stopped` for one that could not be started. */
  status: 'online' | 'connecting' | 'offline' | 'stopped';
  /** The route the device answers through while it is online. */
  route?: DeviceRoute;
  /** Whether the device has a route on the LAN to try first. */
  hasLan: boolean;
  error?: string;
  /** Whether the stored options reach Matter at the next start of Matterbridge: until then the device keeps the ones it was built with. */
  needsRestart: boolean;
  /** What the device can show in Matter, from its catalog entry, unless the catalog of this version has no entry from its file. */
  features?: DeviceFeatures;
  /** The name the product is sold under, as the catalog names it. */
  productName?: string;
  /** The controls the device last reported, while it runs. */
  values?: ControlValues;
};

/** The account as the setup page sees it: never its session or its secret. */
export type SetupAccount = ({ type: 'smartLife'; userCode: string } | { type: 'developer'; accessId: string; dataCenter: DeveloperDataCenter }) & {
  /** The cloud no longer accepts the account, which has to be signed in again. */
  needsSignIn: boolean;
};

/** What the setup page shows of the plugin: the account, the stored devices each with how it is doing, and whether the LAN is listened to. */
export interface SetupState {
  /** The account the devices are listed and reached through, or undefined when none is signed in. */
  account?: SetupAccount;
  devices: SetupDevice[];
  /** Why the plugin does not listen for devices on the LAN, while it does not. */
  discoveryError?: string;
}

/** A device of the account, as the setup page sees it: never its local key. */
export interface FoundDevice {
  deviceId: string;
  /** Its name in the Smart Life app. */
  name: string;
  productKey: string;
  category: string;
  /** Whether the cloud says it is online. */
  online: boolean;
  nodeId?: string;
  /** The gateway a device with a node ID is reached through on the LAN. */
  gatewayId?: string;
  /** The device is that of a stored device. */
  isConfigured: boolean;
  /** Whether the plugin can control it, or why not. */
  support: DeviceSupport;
  /** Whether the cloud gave its local key, which the LAN needs. */
  hasLocalKey: boolean;
  /** Where the plugin heard it, or its gateway, on the LAN. */
  lan?: LanAddress;
}

/** The sign in by QR code, as the setup page follows it. */
export interface QrLoginState {
  /** `waiting` for the scan, `signedIn` once the account is stored, `expired` once the QR code is no longer good, `failed` with the message, and `idle` with no sign in going on. */
  status: 'idle' | 'waiting' | 'signedIn' | 'expired' | 'failed';
  /** The text to show as a QR code, while the status is `waiting`. */
  qrCode?: string;
  message?: string;
}

/** What the developer platform sign in takes. */
export interface DeveloperSignInRequest {
  accessId: string;
  accessSecret: string;
  dataCenter: DeveloperDataCenter;
}

/**
 * What each request carries back when it worked, by its method and its path. The setup page reads its replies by it.
 *
 * Every request is a GET or a POST: Matterbridge answers a DELETE with 204 and no body, whatever the plugin returns,
 * which would hide a failure from the page.
 */
export interface SetupReplies {
  'GET state': { state: SetupState };
  'POST qr-code': { login: QrLoginState };
  'GET qr-login': { login: QrLoginState; state: SetupState };
  /** Nothing but that it worked. */
  'POST cancel-qr-code': object;
  'POST developer-login': { state: SetupState };
  'POST sign-out': object;
  'POST devices': { devices: FoundDevice[] };
  /** The state once the device list of the account was read again, as the page asks when it opens. */
  'POST sync': { state: SetupState };
  'POST probe': { result: ProbeResult };
  'POST device': { state: SetupState };
  'POST remove-device': object;
}

/** Every reply says whether the request worked, so the page never has to read an HTTP status. */
export type SetupReply = ({ ok: true } & SetupReplies[keyof SetupReplies]) | { ok: false; error: string };

/** The part of the platform the setup page reaches. */
export interface SetupPlatform {
  getSetupState: () => Promise<SetupState>;
  startQrLogin: (userCode: string) => Promise<QrLoginState>;
  getQrLogin: () => QrLoginState;
  cancelQrLogin: () => void;
  signInDeveloper: (request: DeveloperSignInRequest) => Promise<void>;
  signOut: () => Promise<void>;
  listDevices: () => Promise<FoundDevice[]>;
  syncDevices: () => Promise<void>;
  probe: (deviceId: string) => Promise<ProbeResult>;
  saveDevice: (device: TuyaDeviceConfig) => Promise<void>;
  removeDevice: (deviceId: string) => Promise<boolean>;
}

// The User Code of the app: letters and digits, case-sensitive.
const userCodePattern = /^[A-Za-z0-9]{4,32}$/;

/**
 * Build the reply of a request that could not be served
 *
 * @param {string} error What was wrong, in words the page can show.
 * @returns {SetupReply} The failed reply.
 */
function fail(error: string): SetupReply {
  return { ok: false, error };
}

/**
 * Read a request body as a record
 *
 * @param {unknown} body The parsed JSON body.
 * @returns {Record<string, unknown>} The body, or an empty record when it is not an object.
 */
function toRecord(body: unknown): Record<string, unknown> {
  return isValidObject(body) ? { ...body } : {};
}

/**
 * Read a developer platform sign in request
 *
 * @param {Record<string, unknown>} body The request body.
 * @returns {DeveloperSignInRequest | string} The request, or what is wrong with it.
 */
function parseDeveloperSignIn(body: Record<string, unknown>): DeveloperSignInRequest | string {
  const accessId = typeof body.accessId === 'string' ? body.accessId.trim() : '';
  const accessSecret = typeof body.accessSecret === 'string' ? body.accessSecret.trim() : '';
  if (!isValidString(accessId, 1, 128)) return 'Enter the Access ID of your cloud project';
  if (!isValidString(accessSecret, 1, 128)) return 'Enter the Access Secret of your cloud project';
  if (!isMember(DATA_CENTERS, body.dataCenter)) return 'Pick the data center of your cloud project';
  return { accessId, accessSecret, dataCenter: body.dataCenter };
}

/**
 * Serve one POST request of the setup page
 *
 * @param {SetupPlatform} platform The platform.
 * @param {string} path The path after `api/`.
 * @param {Record<string, unknown>} body The request body.
 * @returns {Promise<SetupReply | undefined>} The reply, or undefined for a path that is not served.
 */
async function handlePost(platform: SetupPlatform, path: string, body: Record<string, unknown>): Promise<SetupReply | undefined> {
  if (path === 'qr-code') {
    const userCode = typeof body.userCode === 'string' ? body.userCode.trim() : '';
    if (!userCodePattern.test(userCode)) return fail('Enter the User Code the Smart Life app shows under Settings > Account and Security');
    return { ok: true, login: await platform.startQrLogin(userCode) };
  }
  if (path === 'cancel-qr-code') {
    platform.cancelQrLogin();
    return { ok: true };
  }
  if (path === 'developer-login') {
    const request = parseDeveloperSignIn(body);
    if (typeof request === 'string') return fail(request);
    await platform.signInDeveloper(request);
    return { ok: true, state: await platform.getSetupState() };
  }
  if (path === 'sign-out') {
    await platform.signOut();
    return { ok: true };
  }
  if (path === 'devices') return { ok: true, devices: await platform.listDevices() };
  if (path === 'sync') {
    await platform.syncDevices();
    return { ok: true, state: await platform.getSetupState() };
  }
  if (path === 'probe') {
    if (!isValidDeviceId(body.deviceId)) return fail('The device has no valid device ID');
    return { ok: true, result: await platform.probe(body.deviceId) };
  }
  if (path === 'device') {
    const device = parseDeviceConfig(body.device);
    if (device === undefined) return fail('The device needs a name of at most 32 characters, its device ID, its product key and its catalog entry');
    const { host } = toRecord(body.device);
    if (host !== undefined && (normalizeHost(host) === undefined || device.version === undefined))
      return fail(`Enter a host name or an IPv4 address and the protocol version for ${device.name}, or leave the host empty to find it on your network`);
    await platform.saveDevice(device);
    return { ok: true, state: await platform.getSetupState() };
  }
  if (path === 'remove-device') {
    const { deviceId } = body;
    if (!isValidDeviceId(deviceId)) return fail('Give the device ID of the device to remove');
    return (await platform.removeDevice(deviceId)) ? { ok: true } : fail(`No device has the device ID ${deviceId}`);
  }
  return undefined;
}

/**
 * Serve one request of the setup page
 *
 * Paths: `GET state`, `POST qr-code`, `GET qr-login`, `POST cancel-qr-code`, `POST developer-login`, `POST sign-out`,
 * `POST devices`, `POST sync`, `POST probe`, `POST device` and `POST remove-device`. The session of an account, the
 * secret of a cloud project and the local key of a device are never returned.
 *
 * Edge cases:
 *  - a path that is not served -> undefined, which Matterbridge answers with 404
 *  - a request that fails -> `{ ok: false, error }`, never a thrown error
 *
 * @param {SetupPlatform} platform The platform.
 * @param {string} method The HTTP method.
 * @param {string} [path] The path after `api/`.
 * @param {unknown} [body] The parsed JSON body.
 * @returns {Promise<SetupReply | undefined>} The reply.
 */
export async function handleSetupRequest(platform: SetupPlatform, method: string, path?: string, body?: unknown): Promise<SetupReply | undefined> {
  try {
    if (method === 'GET' && path === 'state') return { ok: true, state: await platform.getSetupState() };
    if (method === 'GET' && path === 'qr-login') return { ok: true, login: platform.getQrLogin(), state: await platform.getSetupState() };
    if (method === 'POST' && path !== undefined) return await handlePost(platform, path, toRecord(body));
    return undefined;
  } catch (error) {
    return fail(getErrorMessage(error));
  }
}
