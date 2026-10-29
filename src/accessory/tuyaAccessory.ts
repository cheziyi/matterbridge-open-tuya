/**
 * @file src/accessory/tuyaAccessory.ts
 * @description This file contains the bridge between one Tuya device and its Matter endpoints.
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

import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { type ActionContext, Node } from 'matterbridge/matter';
import { BridgedDeviceBasicInformation, OnOff } from 'matterbridge/matter/clusters';
import type { ControlValues, RoutedTuyaClient, TuyaDeviceEntry, TuyaErrorCode } from 'open-tuya';

import { type TuyaDeviceConfig, withExposureOf } from '../config.js';
import { getErrorCode, getErrorMessage } from '../errors.js';
import type { DeviceFeatures, SwitchFeature } from '../features.js';
import { EndpointIds } from '../platform/endpointIds.js';
import { applyDeviceLabel, createMainEndpoint, createSideEndpoint, type EndpointIdentity } from './endpoints.js';
import { type AccessoryLayout, getAccessoryLayout, type LayoutUnit } from './layout.js';
import { type AccessoryEndpoints, applyValues } from './matterState.js';

/** How many reads in a row have to fail before the device is reported as unreachable. */
const unreachableAfterFailures = 2;

/** The route a device answers through: the LAN, directly or through its gateway, or the cloud. */
export type DeviceRoute = 'lan' | 'cloud';

/** What a device's client takes and gives: the part of `RoutedTuyaClient` the accessory calls. */
export type DeviceClient = Pick<RoutedTuyaClient, 'connected' | 'readControls' | 'writeControls' | 'onControls' | 'close'>;

/** The client of a device, and which of its routes are there. */
export interface DeviceConnection {
  client: DeviceClient;
  /** Whether a route on the LAN is there, directly or through a gateway. */
  hasLan: boolean;
  /** Whether a route through the cloud is there. */
  hasCloud: boolean;
  /** Whether the route on the LAN is connected now, which the client tries first. */
  isOnLan: () => boolean;
}

/** Builds the client of a device, or gives undefined when the device has no route: no cloud, and no address on the LAN or no local key. */
export type DeviceConnectionFactory = () => DeviceConnection | undefined;

/** What a device is built from. */
export interface TuyaAccessoryOptions {
  config: TuyaDeviceConfig;
  /** The catalog entry the controls of the device are named by, which its client is built with. */
  entry: TuyaDeviceEntry;
  /** What the device can show, from its catalog entry. */
  features: DeviceFeatures;
  /** The name the product is sold under, as the catalog names it. */
  productName: string;
  createConnection: DeviceConnectionFactory;
  log: AnsiLogger;
  /** The vendor id of the bridge, used for the bridged device information. */
  vendorId: number;
  /** The endpoint ids of the device, which give an endpoint that comes back after it was taken away a new id. Defaults to the base ids. */
  ids?: EndpointIds;
}

/** What the setup page shows about a running device. */
export interface TuyaAccessoryStatus {
  isReachable: boolean;
  /** Whether the first read of a new client has not finished yet. */
  isConnecting: boolean;
  /** The route the device answers through while it is reachable. */
  route?: DeviceRoute;
  /** Whether the device has a route on the LAN to try first. */
  hasLan: boolean;
  lastError?: string;
  lastErrorCode?: TuyaErrorCode;
  /** The controls the device last reported. */
  values?: ControlValues;
}

/**
 * Tell whether an attribute change came from a Matter controller
 *
 * @param {ActionContext} context The context of the change.
 * @returns {boolean} False for a change this plugin made itself.
 */
function isControllerWrite(context: ActionContext): boolean {
  return context.fabric !== undefined;
}

/**
 * Do nothing: the settled value of a queued task is its caller's business, not the queue's
 *
 * @returns {void}
 */
function ignore(): void {
  // Intentionally empty.
}

/**
 * Merge the controls of a push into those the device reported before
 *
 * @param {ControlValues | undefined} known The controls reported before.
 * @param {ControlValues} pushed The controls of the push.
 * @returns {ControlValues} Every control, the pushed ones as pushed.
 */
function mergeValues(known: ControlValues | undefined, pushed: ControlValues): ControlValues {
  const merged: Record<string, ControlValues[string]> = { ...known };
  for (const [component, controls] of Object.entries(pushed)) merged[component] = { ...merged[component], ...controls };
  return merged;
}

/** Thrown while a device has no route to reach it by. */
export const noRouteMessage = 'The device has no route: sign in to a Tuya account, or let the plugin hear it on your network';

/**
 * One Tuya device and the Matter endpoints that stand for it: its first outlet, or its first sensor, with its meter and
 * its battery, and, as they are exposed, its other outlets, its other sensors and its setting switches. Each is a device
 * of its own in Matter, or a part of the main one when the device is exposed as a composed one.
 *
 * The endpoints are built in `endpoints.ts` and what the device reports is written to Matter in `matterState.ts`. This
 * class wires them together: it takes the writes of the controllers and the pushes of the device, and runs the reads
 * and the writes one after the other.
 */
export class TuyaAccessory implements AccessoryEndpoints {
  /** The name the user gave the device, which is its label in Matter. */
  name: string;
  readonly endpoint: MatterbridgeEndpoint;
  readonly sideEndpoints = new Map<string, MatterbridgeEndpoint>();
  /** How the features are laid out, as the endpoints were built from it. */
  readonly layout: AccessoryLayout;
  /** The catalog entry the endpoints were built from: a client of the device names its controls by it until the device is built again. */
  readonly entry: TuyaDeviceEntry;
  private config: TuyaDeviceConfig;
  private readonly log: AnsiLogger;
  private readonly identity: EndpointIdentity;
  /** The main endpoint, when the other endpoints of the device are its parts. */
  private readonly parent: MatterbridgeEndpoint | undefined;
  private createConnection: DeviceConnectionFactory;
  private connection: DeviceConnection | undefined;
  private stopListening: (() => void) | undefined;

  private values: ControlValues | undefined;
  private isReachable = false;
  /** Until the first read of the client ends. */
  private isConnecting = true;
  /** The route the log last named the device as answering through, so that a change of route is logged. */
  private loggedRoute: DeviceRoute | undefined;
  private lastError: string | undefined;
  private lastErrorCode: TuyaErrorCode | undefined;
  private failureCount = 0;
  private isDisposed = false;
  // Reads and writes run one after the other, so a read never overwrites what a write is about to send.
  private queue: Promise<void> = Promise.resolve();
  // Whether a read waits for the Matter node to be online, which the endpoints are written to only while it is.
  private isAwaitingOnline = false;

  /**
   * Create the endpoints of a device from its features and how it is configured
   *
   * No client is built until `start`.
   *
   * @param {TuyaAccessoryOptions} options The device, its features, the factory of its client and the logger.
   * @throws {Error} When the device has neither an outlet nor a sensor to show.
   */
  constructor(options: TuyaAccessoryOptions) {
    this.config = options.config;
    this.entry = options.entry;
    this.log = options.log;
    this.createConnection = options.createConnection;
    this.name = options.config.name;
    const layout = getAccessoryLayout(options.config, options.features);
    if (layout === undefined) throw new Error('The device has neither an outlet nor a sensor to show in Matter');
    this.layout = layout;
    this.identity = { label: this.name, serial: options.config.deviceId, productName: options.productName, vendorId: options.vendorId, ids: options.ids ?? new EndpointIds() };
    this.endpoint = createMainEndpoint(this.identity, layout);
    this.subscribeUnit(this.endpoint, layout.main);
    if (layout.isComposed) this.parent = this.endpoint;
    for (const unit of layout.sides) {
      const endpoint = createSideEndpoint(this.identity, unit, this.parent);
      this.subscribeUnit(endpoint, unit);
      this.sideEndpoints.set(unit.feature.id, endpoint);
    }
  }

  /**
   * List the Matter endpoints of the device that are devices in Matter: the ones to register, which each say whether
   * the device is reachable
   *
   * @returns {MatterbridgeEndpoint[]} The main endpoint, then the others, unless they are parts of the main one.
   */
  get endpoints(): MatterbridgeEndpoint[] {
    if (this.parent !== undefined) return [this.parent];
    return [this.endpoint, ...this.sideEndpoints.values()];
  }

  /**
   * Report how the device is doing
   *
   * @returns {TuyaAccessoryStatus} Whether the last reads succeeded, the route, the last error and the last controls read.
   */
  getStatus(): TuyaAccessoryStatus {
    const { connection } = this;
    let route: DeviceRoute | undefined;
    if (this.isReachable && connection !== undefined) route = connection.isOnLan() ? 'lan' : 'cloud';
    return {
      isReachable: this.isReachable,
      isConnecting: this.isConnecting,
      route,
      hasLan: connection?.hasLan ?? false,
      lastError: this.lastError,
      lastErrorCode: this.lastErrorCode,
      values: this.values,
    };
  }

  /**
   * Build the client of the device and read it
   *
   * @returns {Promise<boolean>} True when the device answered.
   */
  async start(): Promise<boolean> {
    return this.enqueue(async () => {
      this.openConnection();
      return this.readAndApply();
    });
  }

  /**
   * Switch to a new client, after a route of the device changed: the account, the address on the LAN or the local key
   *
   * @param {DeviceConnectionFactory} createConnection The factory of the new client.
   * @returns {Promise<boolean>} Resolves when the previous client is closed and the new one has read the device: true when it answered.
   */
  async updateConnection(createConnection: DeviceConnectionFactory): Promise<boolean> {
    return this.enqueue(async () => {
      this.createConnection = createConnection;
      await this.closeConnection();
      this.isConnecting = true;
      this.openConnection();
      return this.readAndApply();
    });
  }

  /**
   * Take a new configuration: the name, the connection and whatever else changes no endpoint
   *
   * A new name is written to the label of each endpoint that is a device of its own in Matter, which is what the Matter
   * apps show. The settings that decide the endpoints stay as the device was built: a change of them reaches Matter
   * when the device is built again, at the next start of Matterbridge.
   *
   * @param {TuyaDeviceConfig} config The updated device.
   * @returns {Promise<void>} Resolves when a new name is written to the endpoints.
   */
  async updateConfig(config: TuyaDeviceConfig): Promise<void> {
    const previous = this.name;
    this.config = withExposureOf(config, this.config);
    if (config.name === previous) return;
    this.name = config.name;
    await applyDeviceLabel(this.endpoints, config.name);
    this.log.info(`"${previous}" is now named "${config.name}"`);
  }

  /**
   * Read the controls of the device and write them to the Matter endpoints
   *
   * A read that fails is logged, never thrown: after two failures in a row the endpoints are reported as unreachable.
   * While the Matter node is offline, such as during a factory reset or before the bridge has started, the device is
   * not read: it is read once the node is online.
   *
   * @returns {Promise<boolean>} True when the device answered. False when it did not, or the node is offline.
   */
  async refresh(): Promise<boolean> {
    return this.enqueue(async () => this.readAndApply());
  }

  /**
   * Stop the device for good: close its client. The device reads and writes nothing afterwards, so a device that is
   * needed again is built anew.
   *
   * @returns {Promise<void>} Resolves when the running read or write is done and the client is closed.
   */
  async dispose(): Promise<void> {
    this.isDisposed = true;
    await this.queue;
    await this.closeConnection();
  }

  /**
   * The device's configuration as the accessory holds it
   *
   * @returns {TuyaDeviceConfig} The configuration, with the exposure the endpoints were built with.
   */
  get deviceConfig(): TuyaDeviceConfig {
    return this.config;
  }

  private openConnection(): void {
    const connection = this.createConnection();
    this.connection = connection;
    if (connection === undefined) return;
    // Closing the connection removes the listener, so a client that was replaced pushes nothing.
    this.stopListening = connection.client.onControls((values) => this.receiveValues(values));
  }

  private async closeConnection(): Promise<void> {
    const { connection } = this;
    this.connection = undefined;
    this.stopListening?.();
    this.stopListening = undefined;
    if (connection === undefined) return;
    try {
      await connection.client.close();
    } catch (error) {
      this.log.debug(`"${this.name}" connection did not close cleanly: ${getErrorMessage(error)}`);
    }
  }

  // Subscribes to the on/off of an outlet or a setting switch. A sensor takes no write.
  private subscribeUnit(endpoint: MatterbridgeEndpoint, unit: LayoutUnit): void {
    if (unit.type === 'sensor') return;
    const { feature } = unit;
    this.listen(endpoint, () =>
      endpoint.subscribeAttribute(OnOff, 'onOff', (isOn: boolean, _wasOn: boolean, context: ActionContext) => {
        if (isControllerWrite(context)) void this.writeSwitch(feature, isOn);
      }),
    );
  }

  /**
   * Subscribe to the attribute of an endpoint, and again whenever the endpoint comes back from a factory reset
   *
   * Matter resets the node to factory defaults when its last fabric leaves, such as when the bridge is removed from the
   * last app it was in. The reset drops what was subscribed on each endpoint, so that the writes of the next app it is
   * paired with would reach nothing.
   *
   * Each endpoint subscribes to one attribute: the on/off of its outlet or its switch.
   *
   * @param {MatterbridgeEndpoint} endpoint The endpoint.
   * @param {() => void} subscribe Subscribes to the attribute, now and after each reset.
   * @returns {void}
   */
  private listen(endpoint: MatterbridgeEndpoint, subscribe: () => void): void {
    subscribe();
    let wasReset = false;
    endpoint.lifecycle.reset.on(() => {
      wasReset = true;
    });
    endpoint.lifecycle.ready.on(() => {
      if (!wasReset) return;
      wasReset = false;
      subscribe();
      if (endpoint === this.endpoint) this.log.info(`"${this.name}" is subscribed again after the Matter node was reset`);
      // The reset put every attribute back to its default: the state of the device replaces them once the node is online.
      void this.refresh();
    });
  }

  /**
   * The Matter node the endpoints are in while it is offline, which they are written to only while it is online
   *
   * @returns {Node | undefined} The node while it is offline. Undefined while it is online, or the endpoints are in no node.
   */
  private getOfflineNode(): Node | undefined {
    let root = this.endpoint.owner;
    while (root?.owner !== undefined) root = root.owner;
    return root instanceof Node && !root.lifecycle.isOnline ? root : undefined;
  }

  /**
   * Tell whether the endpoints wait for the Matter node to be online, and read the device once it is
   *
   * @returns {boolean} True while the node is offline, when nothing is to be written to the endpoints.
   */
  private isWaitingForNode(): boolean {
    const node = this.getOfflineNode();
    if (node === undefined) return false;
    if (!this.isAwaitingOnline) {
      this.isAwaitingOnline = true;
      // The read is not awaited, so that the node goes online without waiting for the device.
      node.lifecycle.online.once(() => {
        this.isAwaitingOnline = false;
        void this.refresh();
      });
    }
    return true;
  }

  private async writeSwitch(feature: SwitchFeature, isOn: boolean): Promise<void> {
    if (this.isDisposed) return;
    const what = `${feature.label.toLowerCase()} ${isOn ? 'on' : 'off'}`;
    this.log.info(`"${this.name}" received ${what}`);
    await this.enqueue(async () => {
      const client = this.connection?.client;
      try {
        if (client === undefined) throw new Error(noRouteMessage);
        await client.writeControls({ [feature.component]: { [feature.control]: isOn } });
        this.log.info(`"${this.name}" set ${what}`);
        this.values = mergeValues(this.values, { [feature.component]: { [feature.control]: isOn } });
      } catch (error) {
        this.recordError(error);
        this.log.error(`"${this.name}" did not take ${what}: ${getErrorMessage(error)}`);
        // Read back what the device holds, which undoes the request in Matter.
        await this.readAndApply();
      }
    });
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(ignore, ignore);
    return result;
  }

  /**
   * Read the device and write what it reports to Matter
   *
   * @returns {Promise<boolean>} True when the device answered. False when it did not, or the node is offline and it was not read.
   */
  private async readAndApply(): Promise<boolean> {
    if (this.isDisposed || this.isWaitingForNode()) return false;
    const { connection } = this;
    let values: ControlValues;
    try {
      if (connection === undefined) throw new Error(noRouteMessage);
      values = await connection.client.readControls();
    } catch (error) {
      this.isConnecting = false;
      await this.handleReadFailure(error);
      return false;
    }
    this.isConnecting = false;
    this.failureCount = 0;
    this.lastError = undefined;
    this.lastErrorCode = undefined;
    this.logRoute(connection);
    await this.apply(values);
    return true;
  }

  // Names the route the device answers through when it is another than the log last named.
  private logRoute(connection: DeviceConnection): void {
    const route: DeviceRoute = connection.isOnLan() ? 'lan' : 'cloud';
    if (route === this.loggedRoute) return;
    this.loggedRoute = route;
    this.log.info(`"${this.name}" answers ${route === 'lan' ? 'on the LAN' : 'through the Tuya cloud'}`);
  }

  // A push of the device, which carries the controls that changed.
  private receiveValues(values: ControlValues): void {
    void this.enqueue(async () => {
      if (this.isDisposed) return;
      this.failureCount = 0;
      await this.apply(mergeValues(this.values, values), values);
    });
  }

  private async apply(values: ControlValues, changed: ControlValues = values): Promise<void> {
    this.values = values;
    // While the node is offline the controls are kept, and the read once it is online writes them.
    if (this.isWaitingForNode()) return;
    try {
      await this.setReachable(true);
      await applyValues(this, this.layout, changed);
    } catch (error) {
      this.log.warn(`"${this.name}" state could not be written to Matter: ${getErrorMessage(error)}`);
    }
  }

  private recordError(error: unknown): void {
    this.lastError = getErrorMessage(error);
    this.lastErrorCode = getErrorCode(error);
  }

  private async handleReadFailure(error: unknown): Promise<void> {
    this.failureCount += 1;
    this.recordError(error);
    this.log.debug(`"${this.name}" did not answer (${this.failureCount} in a row): ${this.lastError}`);
    if (this.failureCount !== unreachableAfterFailures && this.connection !== undefined) return;
    if (this.isReachable || this.failureCount === unreachableAfterFailures) this.log.warn(`"${this.name}" is unreachable: ${this.lastError}`);
    if (this.isWaitingForNode()) return;
    try {
      await this.setReachable(false);
    } catch (writeError) {
      this.log.debug(`"${this.name}" reachability could not be written to Matter: ${getErrorMessage(writeError)}`);
    }
  }

  private async setReachable(isReachable: boolean): Promise<void> {
    if (this.isReachable !== isReachable) this.log.notice(`"${this.name}" is ${isReachable ? 'reachable' : 'unreachable'}`);
    this.isReachable = isReachable;
    for (const endpoint of this.endpoints) {
      const hasChanged = await endpoint.updateAttribute(BridgedDeviceBasicInformation, 'reachable', isReachable);
      if (hasChanged) await endpoint.triggerEvent(BridgedDeviceBasicInformation, 'reachableChanged', { reachableNewValue: isReachable });
    }
  }
}
