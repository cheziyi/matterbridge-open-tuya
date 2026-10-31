/**
 * @file src/setup/probe.ts
 * @description This file contains the checks the guided setup makes of a device of the account before it is added.
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

import { type ControlValues, type DataPoints, findDeviceEntries, readControls, type TuyaClient, type TuyaCloudDevice, type TuyaDeviceEntry, type TuyaDeviceModel } from 'open-tuya';

import type { DeviceRoute } from '../accessory/tuyaAccessory.js';
import { describeError, getErrorCode } from '../errors.js';
import { createModelEntry, type DeviceFeatures, getDeviceFeatures, getEntrySupport, getProductName, pickSupportedEntry } from '../features.js';

/** Whether the plugin can control a device of the account, or why not. */
export const DEVICE_SUPPORTS = ['supported', 'unknownProduct', 'otherKind', 'gateway'] as const;

/** Whether the plugin can control a device of the account, or why not: one of `DEVICE_SUPPORTS`. `unknownProduct` is checked by its data points in the Connect step. */
export type DeviceSupport = (typeof DEVICE_SUPPORTS)[number];

/** What a check of a device found. */
export const PROBE_STATUSES = ['ready', 'signInRequired', 'unsupported', 'unreachable', 'failed'] as const;

/** What a check of a device found: one of `PROBE_STATUSES`. */
export type ProbeStatus = (typeof PROBE_STATUSES)[number];

/** What a check of a device found, with what it read from the device when it answered. */
export interface ProbeResult {
  status: ProbeStatus;
  deviceId: string;
  /** The tuya-local file of the catalog entry the controls are named by, when the status is `ready` and the catalog names the device. */
  catalogFile?: string;
  /** The cloud's model of the device, which the controls are named by, when the status is `ready` and the catalog does not list its product. */
  model?: TuyaDeviceModel;
  /** The name the product is sold under, when the status is `ready`. */
  productName?: string;
  /** What the device can show in Matter, when the status is `ready`. */
  features?: DeviceFeatures;
  /** The controls the device reported, when the status is `ready`. */
  values?: ControlValues;
  /** The route the device answered through, when the status is `ready`. */
  route?: DeviceRoute;
  /** What went wrong, in words the page can show. */
  message?: string;
}

/**
 * Tell whether a device of the account is a gateway: one that other devices of the account are reached through
 *
 * The cloud names no gateway for a device behind one, but the device has the gateway's local key.
 *
 * @param {TuyaCloudDevice} device The device.
 * @param {readonly TuyaCloudDevice[]} devices Every device of the account.
 * @returns {boolean} True when the device has no node ID and another device with a node ID has its local key.
 */
export function isGateway(device: TuyaCloudDevice, devices: readonly TuyaCloudDevice[]): boolean {
  if (device.nodeId !== undefined || device.localKey === undefined) return false;
  return devices.some((other) => other.nodeId !== undefined && other.localKey === device.localKey);
}

/**
 * Find the gateway a device behind one is reached through on the LAN
 *
 * @param {TuyaCloudDevice} device The device.
 * @param {readonly TuyaCloudDevice[]} devices Every device of the account.
 * @returns {TuyaCloudDevice | undefined} The device with the same local key and no node ID, or undefined for a device that is behind no gateway, or whose gateway is not listed.
 */
export function findGateway(device: TuyaCloudDevice, devices: readonly TuyaCloudDevice[]): TuyaCloudDevice | undefined {
  if (device.nodeId === undefined || device.localKey === undefined) return undefined;
  return devices.find((other) => other.nodeId === undefined && other.localKey === device.localKey);
}

/**
 * Tell whether the plugin can control a device of the account, from its product key alone
 *
 * Edge cases:
 *  - a gateway -> `gateway`: the devices behind it are listed on their own
 *  - a product the catalog lists, with no entry the plugin controls -> `otherKind`, such as a light
 *  - a product the catalog does not list -> `unknownProduct`: the catalog may still match it by its data points
 *
 * @param {TuyaCloudDevice} device The device.
 * @param {readonly TuyaCloudDevice[]} devices Every device of the account.
 * @returns {DeviceSupport} Whether the plugin can control it, or why not.
 */
export function getDeviceSupport(device: TuyaCloudDevice, devices: readonly TuyaCloudDevice[]): DeviceSupport {
  const entries = findDeviceEntries({ productKey: device.productKey });
  if (entries.length === 0) return isGateway(device, devices) ? 'gateway' : 'unknownProduct';
  return pickSupportedEntry(entries) === undefined ? 'otherKind' : 'supported';
}

/**
 * Turn a failed read into what the user has to do next
 *
 * @param {unknown} error The error the read rejected with.
 * @param {string} deviceId The device that was read.
 * @returns {ProbeResult} The status, with the words of the failure.
 */
function classifyFailure(error: unknown, deviceId: string): ProbeResult {
  const message = describeError(error);
  const code = getErrorCode(error);
  if (code === 'SESSION_EXPIRED') return { status: 'signInRequired', deviceId, message };
  if (code === 'CONNECTION_FAILED' || code === 'CONNECTION_LOST' || code === 'REQUEST_TIMED_OUT' || code === 'DEVICE_OFFLINE') return { status: 'unreachable', deviceId, message };
  return { status: 'failed', deviceId, message };
}

/**
 * Read a device through its routes, and find the entry to name its controls by
 *
 * Every route is tried in order, connected or not, so that a route on the LAN listed first answers once it connects.
 * The routes are closed afterwards: the gateway's client and the account they go through stay open.
 *
 * The catalog's entry for the product comes first, then the entry built from the cloud's model of the device, then the
 * catalog's entry that names the largest share of the data points the device reports. Two entries that name the same
 * data points tie in that last match, as a leak sensor's and a motion sensor's do, so it comes last.
 *
 * Edge cases:
 *  - the model cannot be read -> the match by data points, as without one
 *
 * @param {TuyaCloudDevice} device The device, as the cloud lists it.
 * @param {readonly TuyaClient[]} routes The routes to read it through, the LAN first: at least one.
 * @param {TuyaClient} [lan] The route on the LAN among them, to tell whether it answered.
 * @param {() => Promise<TuyaDeviceModel>} [readModel] Reads the cloud's model of the device, for a product the catalog does not list.
 * @returns {Promise<ProbeResult>} `ready` with the entry, the features and the controls, or what stands in the way.
 */
export async function probeDevice(device: TuyaCloudDevice, routes: readonly TuyaClient[], lan?: TuyaClient, readModel?: () => Promise<TuyaDeviceModel>): Promise<ProbeResult> {
  const { deviceId } = device;
  try {
    let dataPoints: DataPoints | undefined;
    let lastError: unknown;
    // Each route in turn, as createTuyaClient reads a device to find its entry: a route on the LAN still connecting answers once it is.
    for (const route of routes) {
      try {
        dataPoints = await route.readDataPoints();
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (dataPoints === undefined) return classifyFailure(lastError, deviceId);
    const entries = findDeviceEntries({ productKey: device.productKey, dataPoints });
    const fromProduct = pickSupportedEntry(entries.filter((candidate) => candidate.products.some((product) => product.productKey === device.productKey)));
    let model: TuyaDeviceModel | undefined;
    let fromModel: TuyaDeviceEntry | undefined;
    if (fromProduct === undefined && readModel !== undefined) {
      try {
        model = await readModel();
      } catch {
        // The match by data points follows, as for a device without a model.
      }
      const built = model === undefined ? undefined : createModelEntry(model, device.category);
      if (built !== undefined && getEntrySupport(built) === 'supported') fromModel = built;
    }
    const entry = fromProduct ?? fromModel ?? pickSupportedEntry(entries);
    if (entry === undefined) {
      const [best] = entries;
      let message = 'The device catalog of open-tuya does not know this device yet';
      if (best !== undefined)
        message =
          getEntrySupport(best) === 'noControls'
            ? 'It has no switch and no sensor the plugin shows in Matter'
            : `It is a kind of device the plugin does not control yet: ${best.name}`;
      return { status: 'unsupported', deviceId, message };
    }
    return {
      status: 'ready',
      deviceId,
      ...(entry === fromModel ? { model } : { catalogFile: entry.source?.file }),
      productName: getProductName(entry, device.productKey),
      features: getDeviceFeatures(entry),
      values: readControls(entry, dataPoints),
      route: lan?.connected === true ? 'lan' : 'cloud',
    };
  } finally {
    await Promise.allSettled(routes.map(async (route) => route.close()));
  }
}
