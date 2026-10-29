/**
 * @file vitest/fakeTuya.ts
 * @description This file contains the fake devices, clients and accounts the tests reach instead of the network.
 * @author Calvin Che
 */

import type { ControlValues, DataPoints, TuyaClient, TuyaCloudDevice, TuyaDeviceEntry } from 'open-tuya';
import type { Mock } from 'vitest';

import type { DeviceClient, DeviceConnection } from '../src/accessory/tuyaAccessory.js';
import { defaultExposure, type TuyaDeviceConfig } from '../src/config.js';
import { findCatalogEntry } from '../src/features.js';

/** A plug with a power meter: one outlet, the power, the voltage and the current. */
export const plugFile = 'smartplugv1.yaml';
/** A power strip of five outlets and a child lock. */
export const stripFile = 'mirabella_power_strip.yaml';
/** A sensor of the temperature, in a unit it switches, the humidity, the light and the motion, on a battery, with an indicator light. */
export const multiSensorFile = 'fourin1_motion_sensor.yaml';
/** A water leak detector on a battery. */
export const leakFile = 'meian_sw02_leakdetector.yaml';
/** A light, which the plugin does not control. */
export const lightFile = 'arlec_10_pathlights.yaml';

/**
 * Get a catalog entry the tests need
 *
 * @param {string} file The tuya-local file it was converted from.
 * @returns {TuyaDeviceEntry} The entry.
 * @throws {Error} When the catalog has none from that file.
 */
export function entryOf(file: string): TuyaDeviceEntry {
  const entry = findCatalogEntry(file);
  if (entry === undefined) throw new Error(`No catalog entry from ${file}`);
  return entry;
}

/**
 * Get the first product key of a catalog entry
 *
 * @param {string} file The tuya-local file the entry was converted from.
 * @returns {string} The product key.
 */
export function productKeyOf(file: string): string {
  return entryOf(file).products[0]?.productKey ?? 'unknownproduct';
}

/**
 * Build a stored device
 *
 * @param {string} file The tuya-local file of its catalog entry.
 * @param {Partial<TuyaDeviceConfig>} overrides The fields to replace.
 * @returns {TuyaDeviceConfig} The device.
 */
export function createDeviceConfig(file: string, overrides: Partial<TuyaDeviceConfig> = {}): TuyaDeviceConfig {
  return {
    name: 'Desk',
    deviceId: 'bf0000000000000001aa',
    productKey: productKeyOf(file),
    catalogFile: file,
    ...defaultExposure,
    hiddenFeatures: [],
    addedFeatures: [],
    localKey: '0123456789abcdef',
    ...overrides,
  };
}

/**
 * Build a device as the cloud lists it
 *
 * @param {string} file The tuya-local file of its catalog entry.
 * @param {Partial<TuyaCloudDevice>} overrides The fields to replace.
 * @returns {TuyaCloudDevice} The device.
 */
export function createCloudDevice(file: string, overrides: Partial<TuyaCloudDevice> = {}): TuyaCloudDevice {
  return {
    deviceId: 'bf0000000000000001aa',
    name: 'Desk plug',
    productKey: productKeyOf(file),
    localKey: '0123456789abcdef',
    category: 'cz',
    online: true,
    ...overrides,
  };
}

/** A device client whose every call is a mock, and whose pushes a test sends. */
export interface FakeClient extends DeviceClient {
  connected: boolean;
  readControls: Mock<() => Promise<ControlValues>>;
  writeControls: Mock<(values: ControlValues) => Promise<void>>;
  onControls: Mock<(listener: (values: ControlValues) => void) => () => void>;
  close: Mock<() => Promise<void>>;
  /** The controls a read answers with. */
  values: ControlValues;
  /** Send a push to the listeners, as the device does when a control changes. */
  push: (values: ControlValues) => void;
}

/**
 * Create a fake device client
 *
 * @param {ControlValues} values The controls a read answers with.
 * @returns {FakeClient} The client.
 */
export function createFakeClient(values: ControlValues): FakeClient {
  const listeners = new Set<(values: ControlValues) => void>();
  const client: FakeClient = {
    connected: true,
    values,
    readControls: vi.fn(async () => Promise.resolve(client.values)),
    writeControls: vi.fn(async () => Promise.resolve()),
    onControls: vi.fn((listener: (values: ControlValues) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    close: vi.fn(async () => Promise.resolve()),
    push: (pushed) => {
      for (const listener of listeners) listener(pushed);
    },
  };
  return client;
}

/**
 * Wrap a fake client as the connection of a device
 *
 * @param {FakeClient} client The client.
 * @param {Partial<Omit<DeviceConnection, 'client'>>} overrides Which routes it has: the LAN, connected, and the cloud by default.
 * @returns {DeviceConnection} The connection.
 */
export function connectionOf(client: FakeClient, overrides: Partial<Omit<DeviceConnection, 'client'>> = {}): DeviceConnection {
  return { client, hasLan: true, hasCloud: true, isOnLan: () => true, ...overrides };
}

/** A raw route whose every call is a mock. */
export interface FakeRoute extends TuyaClient {
  connected: boolean;
  readDataPoints: Mock<() => Promise<DataPoints>>;
  writeDataPoints: Mock<(dataPoints: DataPoints) => Promise<void>>;
  onDataPoints: Mock<(listener: (dataPoints: DataPoints) => void) => () => void>;
  close: Mock<() => Promise<void>>;
  /** Send a push to the listeners. */
  push: (dataPoints: DataPoints) => void;
}

/**
 * Create a fake route to a device, as a LAN client, a gateway's client or a cloud client is
 *
 * @param {DataPoints} dataPoints The data points a read answers with.
 * @returns {FakeRoute} The route.
 */
export function createFakeRoute(dataPoints: DataPoints = {}): FakeRoute {
  const listeners = new Set<(dataPoints: DataPoints) => void>();
  const route: FakeRoute = {
    connected: true,
    readDataPoints: vi.fn(async () => Promise.resolve(dataPoints)),
    writeDataPoints: vi.fn(async () => Promise.resolve()),
    onDataPoints: vi.fn((listener: (dataPoints: DataPoints) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    close: vi.fn(async () => Promise.resolve()),
    push: (pushed) => {
      for (const listener of listeners) listener(pushed);
    },
    [Symbol.asyncDispose]: async () => Promise.resolve(),
  };
  return route;
}
