/**
 * @file src/config.ts
 * @description This file contains the plugin configuration model and its validation.
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

import type { BasePlatformConfig } from 'matterbridge';
import { isValidBoolean, isValidNumber, isValidObject, isValidString } from 'matterbridge/utils';
import { type AppCloudSession, type DEVELOPER_DATA_CENTERS, type DeveloperDataCenter, PROTOCOL_VERSIONS, type ProtocolVersion } from 'open-tuya';

/** The data centers of the Tuya developer platform, such as `eu`. */
export const DATA_CENTERS = ['cn', 'us', 'us-e', 'eu', 'eu-w', 'in', 'sg'] as const satisfies readonly (keyof typeof DEVELOPER_DATA_CENTERS)[];

/** The protocol versions a device on the LAN speaks, such as `3.3`. */
export const LAN_VERSIONS: readonly ProtocolVersion[] = PROTOCOL_VERSIONS;

/** How often, in seconds, the state and the readings of each device are read unless the configuration says otherwise. */
export const defaultPollIntervalInSeconds = 30;
/** The shortest poll interval accepted, in seconds. */
export const minPollIntervalInSeconds = 10;
/** The longest poll interval accepted, in seconds. */
export const maxPollIntervalInSeconds = 3600;

/** The longest device name accepted, which is also the longest Matter node label. */
export const maxDeviceNameLength = 32;

/** An account of the cloud the Smart Life and Tuya Smart apps sign in to, signed in by scanning a QR code with the app. */
export interface SmartLifeAccountConfig {
  type: 'smartLife';
  /** The User Code the app shows under Settings > Account and Security, which the sign in was asked with. */
  userCode: string;
  /** The session the scan gave, as the account last refreshed it: its refresh token works once. */
  session: AppCloudSession;
}

/** A cloud project of the Tuya developer platform, with the app account linked to it. */
export interface DeveloperAccountConfig {
  type: 'developer';
  accessId: string;
  accessSecret: string;
  dataCenter: DeveloperDataCenter;
}

/** The account the devices are listed and reached through: one of the two clouds. */
export type TuyaAccountConfig = SmartLifeAccountConfig | DeveloperAccountConfig;

/** How a device appears in Matter. */
export interface TuyaDeviceExposure {
  /**
   * The features shown by default that are left out, by their `id`, such as `device.outlet2`: an outlet, a sensor, or
   * `meter` for the power and the energy of the main outlet. The first outlet, or the first sensor of a device without
   * one, is the device itself and always shown.
   */
  hiddenFeatures: string[];
  /** The setting switches that are shown, by their `id`, such as `backlight.on`: none is shown unless chosen. */
  addedFeatures: string[];
  /** Whether the other outlets, the sensors and the switches are parts of the main device in Matter, instead of devices of their own: what Matter calls a composed device. */
  isComposed: boolean;
}

/**
 * The stored configuration of one device.
 *
 * The device is identified by its Tuya device ID, which neither a new name nor a new address changes.
 */
export interface TuyaDeviceConfig extends TuyaDeviceExposure {
  /** The name of the device in Matter, given in the setup page: no two stored devices share one. */
  name: string;
  /** The ID the Tuya cloud gives the device. It is also its serial number in Matter. */
  deviceId: string;
  /** The ID of the product, which the catalog matches the device by. */
  productKey: string;
  /** The tuya-local file the catalog entry the controls are named by was converted from, such as `smartplugv1.yaml`. */
  catalogFile: string;
  /** The name of the device in the Smart Life app, as the cloud lists it now. The setup page shows it to tell the device apart, and Matter never sees it. */
  cloudName?: string;
  /** Tuya's code for the kind of device, such as `cz` for a plug. */
  category?: string;
  /** The address of a device behind a gateway, such as a Zigbee device, on that gateway. */
  nodeId?: string;
  /** The device ID of the gateway a device with a `nodeId` is reached through on the LAN. */
  gatewayId?: string;
  /** The host name or IPv4 address the device is reached at on the LAN, for a network the discovery does not hear it on. Given with `version`. */
  host?: string;
  /** The protocol version the device speaks at `host`. */
  version?: ProtocolVersion;
  /** Whether the device is reached through the cloud alone, never on the LAN. */
  isCloudOnly?: boolean;
  /** The key the device encrypts its traffic on the LAN with, as the cloud lists it. The setup page never sees it. */
  localKey?: string;
}

/** The configuration of the platform as Matterbridge stores it: the account, the devices and the revision are written by the plugin itself, the poll interval in the config editor. */
export type TuyaPlatformConfig = BasePlatformConfig & {
  /** A `TuyaAccountConfig`, or what another version or an edit by hand left there: see `parseAccountConfig`. */
  account?: object | string | number | boolean | null;
  /** Each a `TuyaDeviceConfig`, or what another version or an edit by hand left there: see `parseDeviceConfigs`. */
  devices?: unknown[];
  pollIntervalInSeconds?: number;
  /** Counts the times the plugin itself stored the account or the devices: see `TuyaPlatform.onConfigChanged`. */
  setupRevision?: number;
};

/** What a stored device without a setting falls back to. */
export const defaultExposure: Readonly<TuyaDeviceExposure> = { hiddenFeatures: [], addedFeatures: [], isComposed: true };

/** The id of the meter of the main outlet, in `hiddenFeatures`. */
export const meterFeatureId = 'meter';

const deviceIdPattern = /^[A-Za-z0-9_-]{1,32}$/;
const productKeyPattern = /^[A-Za-z0-9_-]{1,64}$/;
const catalogFilePattern = /^[A-Za-z0-9_.-]{1,128}\.yaml$/;
const featureIdPattern = /^[A-Za-z0-9_]{1,64}(?:\.[A-Za-z0-9_]{1,64})?$/;
// Dot-separated labels of letters, digits and inner dashes, which an IPv4 address is too.
const hostPattern = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const maxFieldLength = 128;
const maxSecretLength = 4096;

/**
 * Check whether a value is one of the members of a literal list
 *
 * @param {readonly T[]} members The accepted values.
 * @param {unknown} value The value to check.
 * @returns {boolean} True when the value is a member.
 */
export function isMember<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

/**
 * Check whether a value is a Tuya device ID
 *
 * It is also the serial number in Matter, which takes 32 characters at most.
 *
 * @param {unknown} value The value to check.
 * @returns {boolean} True when the value is letters, digits, dashes and underscores, 32 at most.
 */
export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && deviceIdPattern.test(value);
}

/**
 * Normalize a device name
 *
 * @param {unknown} value The value to normalize.
 * @returns {string | undefined} The trimmed name, or undefined when it is empty or longer than 32 characters.
 */
export function normalizeDeviceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  return name.length > 0 && name.length <= maxDeviceNameLength ? name : undefined;
}

/**
 * Normalize the host a device is reached at on the LAN
 *
 * @param {unknown} value The value to normalize.
 * @returns {string | undefined} The trimmed host name or IPv4 address, or undefined when it is empty or not one.
 */
export function normalizeHost(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const host = value.trim();
  return hostPattern.test(host) ? host : undefined;
}

/**
 * Normalize the poll interval
 *
 * Edge cases:
 *  - not a finite number -> the default of 30 seconds
 *  - clamps to 10..3600 seconds
 *
 * @param {unknown} value The configured interval in seconds.
 * @returns {number} The interval in seconds.
 */
export function normalizePollInterval(value: unknown): number {
  if (!isValidNumber(value)) return defaultPollIntervalInSeconds;
  return Math.min(Math.max(Math.round(value), minPollIntervalInSeconds), maxPollIntervalInSeconds);
}

/**
 * Read a stored Smart Life session
 *
 * @param {unknown} value The stored value.
 * @returns {AppCloudSession | undefined} The session, or undefined when a field is missing or not valid.
 */
function parseSession(value: unknown): AppCloudSession | undefined {
  if (!isValidObject(value)) return undefined;
  const raw: Record<string, unknown> = { ...value };
  const { endpoint, accessToken, refreshToken, expiresAtInMs } = raw;
  if (!isValidString(endpoint, 1, maxFieldLength * 2) || !isValidString(accessToken, 1, maxSecretLength) || !isValidString(refreshToken, 1, maxSecretLength)) return undefined;
  if (!isValidNumber(expiresAtInMs)) return undefined;
  return { endpoint, accessToken, refreshToken, expiresAtInMs };
}

/**
 * Parse the stored account
 *
 * Edge cases:
 *  - a field that is missing or not valid -> undefined: the account has to be signed in again
 *
 * @param {unknown} value The stored value.
 * @returns {TuyaAccountConfig | undefined} The account, or undefined when there is none or it cannot be read.
 */
export function parseAccountConfig(value: unknown): TuyaAccountConfig | undefined {
  if (!isValidObject(value)) return undefined;
  const raw: Record<string, unknown> = { ...value };
  if (raw.type === 'smartLife') {
    const session = parseSession(raw.session);
    if (!isValidString(raw.userCode, 1, maxFieldLength) || session === undefined) return undefined;
    return { type: 'smartLife', userCode: raw.userCode, session };
  }
  if (raw.type === 'developer') {
    const { accessId, accessSecret, dataCenter } = raw;
    if (!isValidString(accessId, 1, maxFieldLength) || !isValidString(accessSecret, 1, maxFieldLength) || !isMember(DATA_CENTERS, dataCenter)) return undefined;
    return { type: 'developer', accessId, accessSecret, dataCenter };
  }
  return undefined;
}

/**
 * Read a stored list of feature ids
 *
 * @param {unknown} value The stored value.
 * @returns {string[] | undefined} The ids that are valid, each once, or undefined when the value is not an array.
 */
function parseFeatureIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && featureIdPattern.test(id)))];
}

/**
 * Parse one stored device
 *
 * A device needs a name, a device ID, a product key and a catalog file, and every other field falls back to its
 * default. A setting added later is never required, and its default is what the plugin did before it existed.
 *
 * Edge cases:
 *  - a setting that is stored but not valid falls back like one that is missing, and is reported
 *  - a host without a valid version, or a version without a host, is dropped and reported: the discovery finds the device
 *  - a gateway without a node ID, or a node ID without a gateway, is dropped
 *
 * @param {unknown} value The stored value.
 * @param {(message: string) => void} [report] Called once for each setting that is stored but not valid.
 * @returns {TuyaDeviceConfig | undefined} The device, or undefined when one of those four is missing or not valid.
 */
export function parseDeviceConfig(value: unknown, report?: (message: string) => void): TuyaDeviceConfig | undefined {
  if (!isValidObject(value)) return undefined;
  const raw: Record<string, unknown> = { ...value };
  const name = normalizeDeviceName(raw.name);
  if (name === undefined || !isValidDeviceId(raw.deviceId)) return undefined;
  if (typeof raw.productKey !== 'string' || !productKeyPattern.test(raw.productKey) || typeof raw.catalogFile !== 'string' || !catalogFilePattern.test(raw.catalogFile))
    return undefined;
  const features = (key: 'hiddenFeatures' | 'addedFeatures'): string[] => {
    const ids = parseFeatureIds(raw[key]);
    if (ids === undefined && raw[key] !== undefined) report?.(`"${name}" has the ${key} ${JSON.stringify(raw[key])}, which is not valid: none is used instead`);
    return ids ?? [];
  };
  let isComposed = defaultExposure.isComposed;
  if (isValidBoolean(raw.isComposed)) isComposed = raw.isComposed;
  else if (raw.isComposed !== undefined) report?.(`"${name}" has the isComposed ${JSON.stringify(raw.isComposed)}, which is not valid: ${String(isComposed)} is used instead`);
  const device: TuyaDeviceConfig = {
    name,
    deviceId: raw.deviceId,
    productKey: raw.productKey,
    catalogFile: raw.catalogFile,
    hiddenFeatures: features('hiddenFeatures'),
    addedFeatures: features('addedFeatures'),
    isComposed,
  };
  for (const key of ['cloudName', 'category'] as const) {
    const text = raw[key];
    if (isValidString(text, 1, maxFieldLength)) device[key] = text;
  }
  if (isValidDeviceId(raw.nodeId) && isValidDeviceId(raw.gatewayId)) {
    device.nodeId = raw.nodeId;
    device.gatewayId = raw.gatewayId;
  }
  const host = normalizeHost(raw.host);
  if (host !== undefined && isMember(LAN_VERSIONS, raw.version)) {
    device.host = host;
    device.version = raw.version;
  } else if (raw.host !== undefined || raw.version !== undefined) {
    report?.(
      `"${name}" has the host ${JSON.stringify(raw.host)} and the version ${JSON.stringify(raw.version)}, which are not valid together: it is searched for on the LAN instead`,
    );
  }
  if (raw.isCloudOnly === true) device.isCloudOnly = true;
  else if (raw.isCloudOnly !== undefined && raw.isCloudOnly !== false)
    report?.(`"${name}" has the isCloudOnly ${JSON.stringify(raw.isCloudOnly)}, which is not valid: it is tried on the LAN first instead`);
  if (isValidString(raw.localKey, 1, maxFieldLength)) device.localKey = raw.localKey;
  return device;
}

/**
 * Parse the stored device list
 *
 * Edge cases:
 *  - not an array -> an empty list
 *  - a device that is not complete or not valid is left out and reported: `getUnreadableDevices` lists those
 *  - a second device with a name or a device ID already taken is dropped and reported
 *
 * @param {unknown} value The stored value.
 * @param {(message: string) => void} [report] Called once for each device that is left out, and for each setting that is stored but not valid.
 * @returns {TuyaDeviceConfig[]} The valid devices, in their stored order.
 */
export function parseDeviceConfigs(value: unknown, report?: (message: string) => void): TuyaDeviceConfig[] {
  const devices: TuyaDeviceConfig[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const device = parseDeviceConfig(entry, report);
    if (device === undefined) {
      report?.(
        'A stored device has no valid name, device ID, product key or catalog file and is ignored. It stays in the configuration as it is until a device with its name or its device ID is added in the setup page',
      );
    } else if (devices.some((other) => other.name === device.name)) {
      report?.(`A second stored device is named "${device.name}" and is ignored: no two devices share a name`);
    } else if (devices.some((other) => other.deviceId === device.deviceId)) {
      report?.(`"${device.name}" has the device ID of another stored device and is ignored`);
    } else {
      devices.push(device);
    }
  }
  return devices;
}

/**
 * List the stored devices this version cannot read
 *
 * The plugin stores them again as they are, so that a version that reads them, or a correction by hand, still finds
 * them.
 *
 * Edge cases:
 *  - not an array -> an empty list
 *  - an entry with the name or the device ID of one of `devices` is left out: that device took its place
 *
 * @param {unknown} value The stored device list, or the entries kept from it.
 * @param {readonly TuyaDeviceConfig[]} devices The devices that are stored now.
 * @returns {unknown[]} The entries `parseDeviceConfig` refuses, as they were stored.
 */
export function getUnreadableDevices(value: unknown, devices: readonly TuyaDeviceConfig[]): unknown[] {
  const entries: unknown[] = Array.isArray(value) ? value : [];
  return entries.filter((entry) => {
    if (parseDeviceConfig(entry) !== undefined) return false;
    const raw: Record<string, unknown> = isValidObject(entry) ? { ...entry } : {};
    const name = normalizeDeviceName(raw.name);
    return !devices.some((device) => device.name === name || device.deviceId === raw.deviceId);
  });
}

/**
 * Copy a device without its local key, which the setup page never sees
 *
 * @param {T} value The device.
 * @returns {Omit<T, 'localKey'>} A copy without `localKey`.
 */
export function withoutLocalKey<T extends { localKey?: string }>(value: T): Omit<T, 'localKey'> {
  const copy = { ...value };
  delete copy.localKey;
  return copy;
}

/**
 * Tell whether two stored devices are reached the same way
 *
 * @param {TuyaDeviceConfig} left One device.
 * @param {TuyaDeviceConfig} right The other device.
 * @returns {boolean} True when every field the client is built from is the same, the names and the options aside.
 */
export function hasSameConnection(left: TuyaDeviceConfig, right: TuyaDeviceConfig): boolean {
  return (
    left.deviceId === right.deviceId &&
    left.catalogFile === right.catalogFile &&
    left.nodeId === right.nodeId &&
    left.gatewayId === right.gatewayId &&
    left.host === right.host &&
    left.version === right.version &&
    left.isCloudOnly === right.isCloudOnly &&
    left.localKey === right.localKey
  );
}

/**
 * Tell whether two stored devices are exposed to Matter the same way
 *
 * @param {TuyaDeviceConfig} left One device.
 * @param {TuyaDeviceConfig} right The other device.
 * @returns {boolean} True when both are built from the same catalog entry with the same features, and the same endpoints for them. The name is no part of it: it is the label of the device in Matter, which changes in place.
 */
export function hasSameExposure(left: TuyaDeviceConfig, right: TuyaDeviceConfig): boolean {
  const sameIds = (a: readonly string[], b: readonly string[]): boolean => a.toSorted().join() === b.toSorted().join();
  return (
    left.catalogFile === right.catalogFile &&
    left.isComposed === right.isComposed &&
    sameIds(left.hiddenFeatures, right.hiddenFeatures) &&
    sameIds(left.addedFeatures, right.addedFeatures)
  );
}

/**
 * Take the settings that decide the endpoints of a device from another device
 *
 * A running device keeps the ones it was built with: a change of them reaches Matter when the device is built again,
 * at the next start of Matterbridge.
 *
 * @param {TuyaDeviceConfig} device The device, whose other settings are kept.
 * @param {TuyaDeviceConfig} source The device whose exposure settings are taken.
 * @returns {TuyaDeviceConfig} The device with the exposure settings and the catalog entry of the source.
 */
export function withExposureOf(device: TuyaDeviceConfig, source: TuyaDeviceConfig): TuyaDeviceConfig {
  return {
    ...device,
    catalogFile: source.catalogFile,
    isComposed: source.isComposed,
    hiddenFeatures: [...source.hiddenFeatures],
    addedFeatures: [...source.addedFeatures],
  };
}
