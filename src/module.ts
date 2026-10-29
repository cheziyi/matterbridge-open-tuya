/**
 * @file src/module.ts
 * @description This file contains the Matterbridge platform for Tuya switches, plugs and sensors controlled on the LAN and through the Tuya cloud.
 * @author Calvin Che
 * @contributor Luca Liguori
 * @created 2026-10-29
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 Calvin Che.
 * Copyright 2025, 2026 Luca Liguori, for the platform scaffolding from the Matterbridge plugin template.
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

import { MatterbridgeDynamicPlatform, type MatterbridgeEndpoint, type PlatformConfig, type PlatformMatterbridge } from 'matterbridge';
import type { AnsiLogger, LogLevel } from 'matterbridge/logger';
import {
  type AppCloudSession,
  createAppCloudAccount,
  createDeveloperCloudAccount,
  createLocalTuyaClient,
  createQrLogin,
  type DiscoveredTuyaDevice,
  discoverDevices,
  type LocalTuyaClient,
  RoutedTuyaClient,
  type TuyaClient,
  type TuyaCloudAccount,
  type TuyaCloudDevice,
  type TuyaDiscovery,
  TuyaError,
} from 'open-tuya';

import { type DeviceConnection, type DeviceConnectionFactory, TuyaAccessory } from './accessory/tuyaAccessory.js';
import {
  getUnreadableDevices,
  hasSameConnection,
  hasSameExposure,
  normalizePollInterval,
  parseAccountConfig,
  parseDeviceConfigs,
  type TuyaAccountConfig,
  type TuyaDeviceConfig,
  type TuyaPlatformConfig,
  withoutLocalKey,
} from './config.js';
import { describeError, getErrorMessage, ignoreFailure, isSignInRequired } from './errors.js';
import { findCatalogEntry, getDeviceFeatures, getProductName } from './features.js';
import { AddressStore, type LanAddress } from './platform/addressStore.js';
import { CloudRoute } from './platform/cloudRoute.js';
import { EndpointIds, EndpointIdStore } from './platform/endpointIds.js';
import { parseSetupRevision, SetupRevisions } from './platform/setupRevisions.js';
import { findGateway, getDeviceSupport, probeDevice, type ProbeResult } from './setup/probe.js';
import {
  type DeveloperSignInRequest,
  type FoundDevice,
  handleSetupRequest,
  type QrLoginState,
  type SetupAccount,
  type SetupDevice,
  type SetupPlatform,
  type SetupState,
} from './setup/setupApi.js';

/** How often, in milliseconds, the device list of the account is read to keep the local key and the name of each device up to date. */
export const deviceSyncIntervalInMs = 15 * 60 * 1000;

/** How long, in milliseconds, a QR code is waited on before the sign in gives up. */
export const qrLoginTimeoutInMs = 5 * 60 * 1000;

/** The client ID and the schema the Smart Life cloud signs in with: Home Assistant's, the only pair known to work. */
export const smartLifeClientId = 'HA_3y9q4ak7g4ephrvke';
export const smartLifeSchema = 'haauthorize';

const requiredMatterbridgeVersion = '3.10.10';

export type { TuyaPlatformConfig } from './config.js';

/**
 * This is the standard interface for Matterbridge plugins.
 * Each plugin should export a default function that follows this signature.
 *
 * @param {PlatformMatterbridge} matterbridge - An instance of MatterBridge.
 * @param {AnsiLogger} log - An instance of AnsiLogger. This is used for logging messages in a format that can be displayed with ANSI color codes and in the frontend.
 * @param {TuyaPlatformConfig} config - The platform configuration.
 * @returns {TuyaPlatform} - An instance of the MatterbridgeAccessory or MatterbridgeDynamicPlatform class. This is the main interface for interacting with the Matterbridge system.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: TuyaPlatformConfig): TuyaPlatform {
  return new TuyaPlatform(matterbridge, log, config);
}

/**
 * Describe the account for the setup page, without its session or its secret
 *
 * @param {TuyaAccountConfig} account The account.
 * @param {boolean} needsSignIn Whether the cloud no longer accepts it.
 * @returns {SetupAccount} The account as the page sees it.
 */
function describeAccount(account: TuyaAccountConfig, needsSignIn: boolean): SetupAccount {
  if (account.type === 'smartLife') return { type: 'smartLife', userCode: account.userCode, needsSignIn };
  return { type: 'developer', accessId: account.accessId, dataCenter: account.dataCenter, needsSignIn };
}

/**
 * The platform: it holds the Tuya account, listens for the devices on the LAN, stores the devices by their device ID,
 * keeps their local keys up to date, exposes each one to Matter and serves the guided setup.
 */
export class TuyaPlatform extends MatterbridgeDynamicPlatform implements SetupPlatform {
  private account: TuyaAccountConfig | undefined;
  /** The account signed in, which the cloud routes go through. */
  private cloud: TuyaCloudAccount | undefined;
  /** Whether the cloud refused the account's session, so that it has to be signed in again. */
  private isAccountRejected = false;
  private devices: TuyaDeviceConfig[];
  /** The stored devices this version cannot read, which are stored again as they are. */
  private unreadableDevices: unknown[];
  /** The running devices, by their device ID. */
  private readonly accessories = new Map<string, TuyaAccessory>();
  private readonly addressStore = new AddressStore(() => this.context);
  private readonly endpointIdStore = new EndpointIdStore(() => this.context);
  /** Why a stored device is not running, by its device ID. */
  private readonly startErrors = new Map<string, string>();
  /** The devices whose stored options reach Matter at the next start of Matterbridge, by their device ID. */
  private readonly restartRequired = new Set<string>();
  private discovery: TuyaDiscovery | undefined;
  /** Why the discovery does not listen, while it does not. */
  private discoveryError: string | undefined;
  /** Where each device was last heard on the LAN, or stored as heard at before the restart, by its device ID. */
  private readonly addresses = new Map<string, LanAddress>();
  /** The client of each gateway the devices behind it are reached through, by its device ID. */
  private readonly gateways = new Map<string, LocalTuyaClient>();
  /** The devices of the account as the cloud last listed them, by their device ID, with their local keys: the setup page never sees those. */
  private listed = new Map<string, TuyaCloudDevice>();
  private deviceList: Promise<TuyaCloudDevice[]> | undefined;
  private qrLogin: QrLoginState = { status: 'idle' };
  private qrAbort: AbortController | undefined;
  private pollTimer: NodeJS.Timeout | undefined;
  private syncTimer: NodeJS.Timeout | undefined;
  private pollIntervalInSeconds: number;
  private readonly revisions: SetupRevisions;
  /** The devices being read, so that a device that is slow to answer holds up no other. */
  private readonly polling = new Set<TuyaAccessory>();
  // Changes to the account and the device list run one after the other.
  private changes: Promise<void> = Promise.resolve();

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: TuyaPlatformConfig) {
    // Always call super(matterbridge, log, config)
    super(matterbridge, log, config);

    // Verify that Matterbridge is the correct version
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion(requiredMatterbridgeVersion)) {
      throw new Error(
        `This plugin requires Matterbridge version >= "${requiredMatterbridgeVersion}". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.log.info(`Initializing platform ${this.config.name}...`);
    this.account = parseAccountConfig(config.account);
    if (config.account !== undefined && this.account === undefined) this.log.warn('The stored Tuya account cannot be read: sign in again in the setup page');
    this.devices = parseDeviceConfigs(config.devices, (message) => this.log.warn(message));
    this.unreadableDevices = getUnreadableDevices(config.devices, this.devices);
    this.revisions = new SetupRevisions(config.setupRevision);
    this.pollIntervalInSeconds = normalizePollInterval(config.pollIntervalInSeconds);
    this.log.info(`Platform ${this.config.name} initialized successfully`);
  }

  override async onStart(reason?: string): Promise<void> {
    this.log.info(`Starting platform ${this.config.name} with reason: ${reason ?? 'no reason provided'}...`);

    // Wait for the platform storage, which holds the address each device was heard at.
    await this.ready;

    if (this.account !== undefined) this.cloud = this.createCloud(this.account);
    await this.startDiscovery();
    for (const id of this.listLanIds()) {
      const stored = await this.addressStore.read(id);
      if (stored !== undefined && !this.addresses.has(id)) this.addresses.set(id, stored);
    }
    for (const device of this.devices) await this.startDevice(device);
    this.startTimers();
    // The stored local keys may be out of date: do not hold the start for the cloud.
    void this.syncDevices();

    this.log.info(`Platform ${this.config.name} started successfully`);
  }

  override async onConfigure(): Promise<void> {
    // Always call super.onConfigure()
    await super.onConfigure();

    this.log.info(`Configuring platform ${this.config.name}...`);
    await this.pollDevices();
    this.log.info(`Platform ${this.config.name} configured successfully`);
  }

  // oxlint-disable-next-line typescript/require-await
  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string): Promise<void> {
    // Always call super.onShutdown(reason)
    await super.onShutdown(reason);

    this.log.info(`Shutting down platform ${this.config.name} with reason: ${reason ?? 'no reason provided'}...`);

    this.stopTimers();
    this.cancelQrLogin();
    await this.changes;
    for (const accessory of this.accessories.values()) await accessory.dispose();
    this.accessories.clear();
    await this.closeGateways(() => true);
    await this.discovery?.close().catch(ignoreFailure);
    this.discovery = undefined;
    await this.cloud?.close().catch(ignoreFailure);
    this.cloud = undefined;
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();

    this.log.info(`Platform ${this.config.name} shut down successfully`);
  }

  /**
   * Apply a configuration saved in the Matterbridge config editor
   *
   * The editor changes the poll interval. The account and the devices are set up in the setup page alone, and the
   * editor does not list them.
   *
   * The editor still holds the whole configuration it loaded with its page, and sends all of it back. Saved after the
   * setup page changed the account or the devices meanwhile, that copy holds those of before: it is recognized by its
   * revision, and the account and the devices are stored again as they are.
   *
   * @param {PlatformConfig} config The saved configuration.
   * @returns {Promise<void>} Resolves when the configuration is applied.
   */
  // oxlint-disable-next-line typescript/require-await
  override async onConfigChanged(config: PlatformConfig): Promise<void> {
    if (this.pollTimer === undefined) return;
    // A configuration this plugin stored itself comes back here within moments, with nothing in it to apply.
    const revision = parseSetupRevision(config.setupRevision);
    if (this.revisions.acknowledge(revision)) return;
    const pollIntervalInSeconds = normalizePollInterval(config.pollIntervalInSeconds);
    if (pollIntervalInSeconds !== this.pollIntervalInSeconds) {
      this.pollIntervalInSeconds = pollIntervalInSeconds;
      this.startTimers();
    }
    if (revision !== this.revisions.current) this.storeConfig();
  }

  /**
   * Serve the setup page's requests to `/plugins/<plugin name>/api/<path>`
   *
   * @param {string} method The HTTP method.
   * @param {string} [path] The path after `api/`.
   * @param {Record<string, unknown>} [query] The query string parameters.
   * @param {unknown} [body] The parsed JSON body.
   * @returns {Promise<unknown>} The JSON reply, or undefined for a path the plugin does not serve.
   */
  override async onFetch(method: string, path?: string, query?: Record<string, unknown>, body?: unknown): Promise<unknown> {
    return handleSetupRequest(this, method, path, query, body);
  }

  /**
   * Describe the account and the stored devices for the setup page
   *
   * @returns {Promise<SetupState>} The account without its session or its secret, and each device with how it is doing and what it last reported.
   */
  // oxlint-disable-next-line typescript/require-await
  async getSetupState(): Promise<SetupState> {
    const devices: SetupDevice[] = this.devices.map((device) => {
      const accessory = this.accessories.get(device.deviceId);
      const status = accessory?.getStatus();
      let state: SetupDevice['status'] = 'stopped';
      if (status?.isReachable === true) state = 'online';
      else if (status?.isConnecting === true) state = 'connecting';
      else if (status !== undefined) state = 'offline';
      const entry = findCatalogEntry(device.catalogFile);
      return {
        ...withoutLocalKey(device),
        status: state,
        route: status?.route,
        hasLan: status?.hasLan ?? false,
        error: status === undefined ? this.startErrors.get(device.deviceId) : status.lastError,
        needsRestart: this.restartRequired.has(device.deviceId),
        features: entry === undefined ? undefined : getDeviceFeatures(entry),
        productName: entry === undefined ? undefined : getProductName(entry, device.productKey),
        values: status?.values,
      };
    });
    const { account } = this;
    return { account: account === undefined ? undefined : describeAccount(account, this.isAccountRejected), devices, discoveryError: this.discoveryError };
  }

  /**
   * Start a sign in to the Smart Life cloud by QR code, and wait for the scan in the background
   *
   * A sign in already going on is cancelled. The scan is waited on for 5 minutes: `getQrLogin` follows it.
   *
   * @param {string} userCode The User Code the Smart Life app shows under Settings > Account and Security.
   * @returns {Promise<QrLoginState>} The sign in, waiting with the QR code to show.
   * @throws {Error} When the cloud refuses the User Code or does not answer, with what went wrong.
   */
  async startQrLogin(userCode: string): Promise<QrLoginState> {
    this.cancelQrLogin();
    const login = createQrLogin({ clientId: smartLifeClientId, schema: smartLifeSchema, userCode });
    let qrCode: string;
    try {
      qrCode = await login.requestQrCode();
    } catch (error) {
      const message = `The Smart Life cloud did not give a QR code: check the User Code. ${describeError(error)}`;
      this.log.warn(message);
      throw new Error(message, { cause: error });
    }
    const abort = new AbortController();
    this.qrAbort = abort;
    const timer = setTimeout(() => abort.abort(new TuyaError('QR_CODE_EXPIRED', 'The QR code was not scanned in time')), qrLoginTimeoutInMs);
    timer.unref();
    this.qrLogin = { status: 'waiting', qrCode };
    void this.waitForQrScan(login, qrCode, userCode, abort, timer);
    return this.qrLogin;
  }

  /**
   * Follow the sign in by QR code
   *
   * @returns {QrLoginState} How it goes.
   */
  getQrLogin(): QrLoginState {
    return this.qrLogin;
  }

  /**
   * Stop waiting for the scan of a QR code
   *
   * @returns {void}
   */
  cancelQrLogin(): void {
    const abort = this.qrAbort;
    this.qrAbort = undefined;
    abort?.abort();
    this.qrLogin = { status: 'idle' };
  }

  /**
   * Sign in to a cloud project of the Tuya developer platform, store it and connect every stored device through it
   *
   * The project is checked by listing its devices before it is stored.
   *
   * @param {DeveloperSignInRequest} request The access ID, the access secret and the data center of the project.
   * @returns {Promise<void>} Resolves when the account is stored and the devices are connected through it.
   * @throws {Error} When the platform refuses the project or does not answer, with what went wrong.
   */
  async signInDeveloper(request: DeveloperSignInRequest): Promise<void> {
    const account: TuyaAccountConfig = { type: 'developer', ...request };
    const cloud = this.createCloud(account);
    try {
      await cloud.listDevices();
    } catch (error) {
      await cloud.close().catch(ignoreFailure);
      const message = `The Tuya developer platform did not list the devices of the project: ${describeError(error)}`;
      this.log.warn(message);
      throw new Error(message, { cause: error });
    }
    await cloud.close().catch(ignoreFailure);
    await this.setAccount(account);
    this.log.notice(`Signed in to the Tuya developer platform with the project ${request.accessId}`);
  }

  /**
   * Forget the account
   *
   * The devices stay in Matter, with their rooms and their automations, and are reached on the LAN alone until an
   * account is signed in again.
   *
   * @returns {Promise<void>} Resolves when the account is forgotten and every device is reconnected without it.
   */
  async signOut(): Promise<void> {
    this.cancelQrLogin();
    await this.enqueueChange(async () => {
      await this.cloud?.close().catch(ignoreFailure);
      this.cloud = undefined;
      this.account = undefined;
      this.isAccountRejected = false;
      this.listed = new Map();
      this.storeConfig();
      await this.reconnectAll();
    });
    this.log.notice('Signed out of the Tuya account');
  }

  /**
   * List the devices of the account, for the setup page
   *
   * The list also brings the local keys of the stored devices up to date.
   *
   * @returns {Promise<FoundDevice[]>} The devices, each marked when it is stored already and when the plugin cannot control it.
   * @throws {Error} When no account is signed in, or the cloud does not answer.
   */
  async listDevices(): Promise<FoundDevice[]> {
    const devices = await this.readDevices();
    await this.applyListing(devices);
    return devices.map((device) => {
      const gateway = findGateway(device, devices);
      const found: FoundDevice = {
        deviceId: device.deviceId,
        name: device.name,
        productKey: device.productKey,
        category: device.category,
        online: device.online,
        isConfigured: this.devices.some((stored) => stored.deviceId === device.deviceId),
        support: getDeviceSupport(device, devices),
        hasLocalKey: device.localKey !== undefined,
      };
      if (device.nodeId !== undefined) found.nodeId = device.nodeId;
      if (gateway !== undefined) found.gatewayId = gateway.deviceId;
      const lan = this.addresses.get(gateway?.deviceId ?? device.deviceId);
      if (lan !== undefined) found.lan = lan;
      return found;
    });
  }

  /**
   * Read the device list of the account and store the local key, the name and the gateway of each stored device that changed
   *
   * A failed read is logged, never thrown.
   *
   * @returns {Promise<void>} Resolves when the stored devices are up to date and the devices that could not start were retried.
   */
  async syncDevices(): Promise<void> {
    if (this.cloud !== undefined) {
      try {
        await this.applyListing(await this.readDevices());
      } catch (error) {
        this.log.warn(`The devices of the Tuya account could not be read: ${describeError(error)}`);
      }
    }
    try {
      await this.enqueueChange(async () => this.startStoppedDevices());
    } catch {
      // enqueueChange logged it.
    }
  }

  /**
   * Check whether a device of the account answers, on the LAN first and through the cloud, and find its catalog entry
   *
   * @param {string} deviceId The device to check.
   * @returns {Promise<ProbeResult>} `ready` with the entry, the features and the controls, or the failure that stands in the way.
   */
  async probe(deviceId: string): Promise<ProbeResult> {
    if (!this.listed.has(deviceId)) {
      try {
        await this.readDevices();
      } catch (error) {
        return { status: isSignInRequired(error) ? 'signInRequired' : 'failed', deviceId, message: describeError(error) };
      }
    }
    const device = this.listed.get(deviceId);
    if (device === undefined) return { status: 'failed', deviceId, message: 'The Tuya account no longer lists the device: read the device list again' };
    const stored = this.devices.find((candidate) => candidate.deviceId === deviceId);
    const gateway = findGateway(device, [...this.listed.values()]);
    const lan = stored?.isCloudOnly === true ? undefined : this.createLanRoute({ ...device, gatewayId: gateway?.deviceId, host: stored?.host, version: stored?.version });
    const routes: TuyaClient[] = lan === undefined ? [] : [lan];
    const { cloud } = this;
    if (cloud !== undefined) routes.push(new CloudRoute(async () => cloud.createClient(deviceId)));
    if (routes.length === 0) return { status: 'unreachable', deviceId, message: 'The device was not heard on your network, and no Tuya account is signed in' };
    const result = await probeDevice(device, routes, lan);
    if (result.status === 'signInRequired') this.rejectAccount();
    return result;
  }

  /**
   * Store a device, adding it or replacing the stored device of the same device ID
   *
   * What the cloud lists of the device, its local key among it, is taken from the last list: the setup page never sees
   * the local key.
   *
   * @param {TuyaDeviceConfig} device The device, as the setup page sends it.
   * @returns {Promise<void>} Resolves when the device is stored and started or updated, or noted for the next start of Matterbridge.
   * @throws {Error} When another stored device already has the name, or the catalog has no entry from its file.
   */
  async saveDevice(device: TuyaDeviceConfig): Promise<void> {
    const stored = this.devices.find((candidate) => candidate.deviceId === device.deviceId);
    if (this.devices.some((candidate) => candidate !== stored && candidate.name === device.name)) throw new Error(`Another device is already named "${device.name}"`);
    if (findCatalogEntry(device.catalogFile) === undefined) throw new Error(`The device catalog has no entry from ${device.catalogFile}`);
    const listed = this.listed.get(device.deviceId);
    // What the cloud lists is never taken from the page: from the last list, or as it was stored.
    const { cloudName: _cloudName, category: _category, nodeId: _nodeId, gatewayId: _gatewayId, localKey: _localKey, ...options } = device;
    const source = listed === undefined ? stored : this.fromListing(listed);
    const next: TuyaDeviceConfig = { ...options };
    if (source !== undefined) {
      next.productKey = source.productKey;
      if (source.cloudName !== undefined) next.cloudName = source.cloudName;
      if (source.category !== undefined) next.category = source.category;
      if (source.localKey !== undefined) next.localKey = source.localKey;
      if (source.nodeId !== undefined && source.gatewayId !== undefined) {
        next.nodeId = source.nodeId;
        next.gatewayId = source.gatewayId;
      }
    }
    const devices = stored === undefined ? [...this.devices, next] : this.devices.map((candidate) => (candidate === stored ? next : candidate));
    await this.applyDevices(devices);
  }

  /**
   * Remove a stored device and its Matter endpoints
   *
   * @param {string} deviceId The device ID.
   * @returns {Promise<boolean>} False when no device has that device ID.
   */
  async removeDevice(deviceId: string): Promise<boolean> {
    if (!this.devices.some((device) => device.deviceId === deviceId)) return false;
    await this.applyDevices(this.devices.filter((device) => device.deviceId !== deviceId));
    return true;
  }

  /**
   * Read the controls of every running device once
   *
   * A device that has not answered the read before this one is left out, so that the others are still read on time.
   *
   * @returns {Promise<void>} Resolves when every device that was read answered or failed.
   */
  async pollDevices(): Promise<void> {
    const idle = [...this.accessories.values()].filter((accessory) => !this.polling.has(accessory));
    await Promise.all(
      idle.map(async (accessory) => {
        this.polling.add(accessory);
        try {
          await accessory.refresh();
          if (accessory.getStatus().lastErrorCode === 'SESSION_EXPIRED') this.rejectAccount();
        } finally {
          this.polling.delete(accessory);
        }
      }),
    );
  }

  /**
   * Note where the discovery heard a device on the LAN
   *
   * A device broadcasts every few seconds, so this is called again and again with the same address: only a new address
   * is stored. A running device that has no route on the LAN yet, or whose gateway was heard, gets one.
   *
   * @param {DiscoveredTuyaDevice} found The device as it broadcast itself.
   * @returns {Promise<void>} Resolves when the address is stored and the devices it reaches are reconnected.
   */
  async hearDevice(found: DiscoveredTuyaDevice): Promise<void> {
    const known = this.addresses.get(found.deviceId);
    if (known?.host === found.host && known.version === found.version) return;
    const address: LanAddress = { host: found.host, version: found.version };
    this.addresses.set(found.deviceId, address);
    if (!this.listLanIds().includes(found.deviceId)) return;
    this.log.debug(`Heard ${found.deviceId} on the LAN at ${found.host}, protocol ${found.version}`);
    try {
      await this.addressStore.write(found.deviceId, address);
      // The discovery follows a device that has a route on the LAN to its new address: only one without a route yet needs a new client.
      await this.enqueueChange(async () => {
        for (const device of this.devices) {
          if (device.deviceId !== found.deviceId && device.gatewayId !== found.deviceId) continue;
          const accessory = this.accessories.get(device.deviceId);
          if (accessory !== undefined && !accessory.getStatus().hasLan && device.isCloudOnly !== true) await accessory.updateConnection(this.createConnectionFactory(device));
        }
      });
    } catch (error) {
      this.log.debug(`The address of ${found.deviceId} could not be stored: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Wait for the scan of a QR code, and store the account it signs in
   *
   * A sign in that was cancelled or replaced meanwhile changes nothing.
   *
   * @param {ReturnType<typeof createQrLogin>} login The sign in.
   * @param {string} qrCode The QR code shown.
   * @param {string} userCode The User Code it was asked with.
   * @param {AbortController} abort Stops the wait.
   * @param {NodeJS.Timeout} timer Stops the wait once the QR code was shown too long.
   * @returns {Promise<void>} Resolves once the scan is in, the wait failed or it stopped.
   */
  private async waitForQrScan(login: ReturnType<typeof createQrLogin>, qrCode: string, userCode: string, abort: AbortController, timer: NodeJS.Timeout): Promise<void> {
    try {
      const session = await login.waitForScan(qrCode, { signal: abort.signal });
      if (this.qrAbort !== abort) return;
      await this.setAccount({ type: 'smartLife', userCode, session });
      this.qrLogin = { status: 'signedIn' };
      this.log.notice('Signed in to the Smart Life cloud');
    } catch (error) {
      // Cancelled: a sign in that timed out is aborted with a TuyaError, which says the QR code expired.
      if (this.qrAbort !== abort || (abort.signal.aborted && !(abort.signal.reason instanceof TuyaError))) return;
      const reason: unknown = abort.signal.aborted ? abort.signal.reason : error;
      const isExpired = reason instanceof TuyaError && reason.code === 'QR_CODE_EXPIRED';
      this.qrLogin = { status: isExpired ? 'expired' : 'failed', message: describeError(reason) };
      if (!isExpired) this.log.warn(`The sign in to the Smart Life cloud failed: ${describeError(reason)}`);
    } finally {
      clearTimeout(timer);
      if (this.qrAbort === abort) this.qrAbort = undefined;
    }
  }

  private rejectAccount(): void {
    if (!this.isAccountRejected) this.log.warn('The Tuya cloud no longer accepts the account: sign in again in the setup page');
    this.isAccountRejected = true;
  }

  // The devices and the gateways whose address on the LAN is kept.
  private listLanIds(): string[] {
    return [...new Set(this.devices.flatMap((device) => (device.gatewayId === undefined ? [device.deviceId] : [device.deviceId, device.gatewayId])))];
  }

  private async startDiscovery(): Promise<void> {
    try {
      this.discovery = await discoverDevices({ onDevice: (found) => void this.hearDevice(found) });
      this.discoveryError = undefined;
    } catch (error) {
      this.discoveryError = describeError(error);
      this.log.warn(`The plugin does not listen for devices on the LAN, and reaches them through the Tuya cloud or at the host given in their options: ${this.discoveryError}`);
    }
  }

  private createCloud(account: TuyaAccountConfig): TuyaCloudAccount {
    if (account.type === 'developer') return createDeveloperCloudAccount({ accessId: account.accessId, accessSecret: account.accessSecret, dataCenter: account.dataCenter });
    return createAppCloudAccount({ clientId: smartLifeClientId, session: account.session, onSessionChange: (session) => this.storeSession(account, session) });
  }

  // Each refresh of the session replaces the refresh token, which works once: the new session is stored at once.
  private storeSession(account: TuyaAccountConfig, session: AppCloudSession): void {
    if (this.account !== account || account.type !== 'smartLife') return;
    account.session = session;
    this.isAccountRejected = false;
    this.storeConfig();
  }

  /**
   * Store a new account, and connect every stored device through it
   *
   * @param {TuyaAccountConfig} account The account.
   * @returns {Promise<void>} Resolves when the account is stored and the devices are connected through it.
   */
  private async setAccount(account: TuyaAccountConfig): Promise<void> {
    await this.enqueueChange(async () => {
      await this.cloud?.close().catch(ignoreFailure);
      this.account = account;
      this.cloud = this.createCloud(account);
      this.isAccountRejected = false;
      this.listed = new Map();
      this.storeConfig();
      await this.reconnectAll();
    });
    void this.syncDevices();
  }

  // Runs inside the queue of changes.
  private async reconnectAll(): Promise<void> {
    for (const device of this.devices) {
      const accessory = this.accessories.get(device.deviceId);
      if (accessory === undefined) await this.startDevice(device);
      else await accessory.updateConnection(this.createConnectionFactory(device));
    }
  }

  private async readDevices(): Promise<TuyaCloudDevice[]> {
    const { cloud } = this;
    if (cloud === undefined) throw new Error('Sign in to your Tuya account first');
    // Two reads at once would ask the cloud twice for the same list.
    this.deviceList ??= cloud.listDevices().finally(() => {
      this.deviceList = undefined;
    });
    try {
      const devices = await this.deviceList;
      this.isAccountRejected = false;
      this.listed = new Map(devices.map((device) => [device.deviceId, device]));
      return devices;
    } catch (error) {
      if (isSignInRequired(error)) this.rejectAccount();
      throw error;
    }
  }

  /**
   * Read what the cloud lists of a device as the fields of a stored device
   *
   * @param {TuyaCloudDevice} device The device as the cloud lists it.
   * @returns {Pick<TuyaDeviceConfig, 'productKey' | 'cloudName' | 'category' | 'nodeId' | 'gatewayId' | 'localKey'>} The fields the cloud gives.
   */
  private fromListing(device: TuyaCloudDevice): Pick<TuyaDeviceConfig, 'productKey' | 'cloudName' | 'category' | 'nodeId' | 'gatewayId' | 'localKey'> {
    const gateway = findGateway(device, [...this.listed.values()]);
    const fields: Pick<TuyaDeviceConfig, 'productKey' | 'cloudName' | 'category' | 'nodeId' | 'gatewayId' | 'localKey'> = { productKey: device.productKey, cloudName: device.name };
    if (device.category !== '') fields.category = device.category;
    if (device.localKey !== undefined) fields.localKey = device.localKey;
    if (device.nodeId !== undefined && gateway !== undefined) {
      fields.nodeId = device.nodeId;
      fields.gatewayId = gateway.deviceId;
    }
    return fields;
  }

  private async applyListing(listing: readonly TuyaCloudDevice[]): Promise<void> {
    await this.enqueueChange(async () => {
      const devices = this.devices.map((stored) => {
        const listed = listing.find((device) => device.deviceId === stored.deviceId);
        if (listed === undefined) return stored;
        const updated: TuyaDeviceConfig = { ...stored, ...this.fromListing(listed) };
        if (updated.localKey !== stored.localKey && stored.localKey !== undefined) this.log.notice(`"${stored.name}" has a new local key`);
        const isSame = (['productKey', 'cloudName', 'category', 'nodeId', 'gatewayId', 'localKey'] as const).every((key) => updated[key] === stored[key]);
        return isSame ? stored : updated;
      });
      if (devices.some((device, index) => device !== this.devices[index])) await this.reconcile(devices);
    });
  }

  private startTimers(): void {
    this.stopTimers();
    this.pollTimer = setInterval(() => void this.pollDevices(), this.pollIntervalInSeconds * 1000);
    this.pollTimer.unref();
    this.syncTimer = setInterval(() => void this.syncDevices(), deviceSyncIntervalInMs);
    this.syncTimer.unref();
  }

  private stopTimers(): void {
    clearInterval(this.pollTimer);
    clearInterval(this.syncTimer);
    this.pollTimer = undefined;
    this.syncTimer = undefined;
  }

  private async enqueueChange(task: () => Promise<void>): Promise<void> {
    const result = this.changes.then(task);
    this.changes = result.catch((error: unknown) => {
      this.log.error(`A change to the devices failed: ${getErrorMessage(error)}`);
    });
    return result;
  }

  /**
   * Get the client of the gateway a device is behind, creating it once the gateway was heard on the LAN
   *
   * One client serves every device behind the gateway, which shares its local key.
   *
   * @param {string} gatewayId The device ID of the gateway.
   * @param {string} localKey The local key of the gateway, which the devices behind it have.
   * @returns {LocalTuyaClient | undefined} The client, or undefined while the gateway was not heard, or its client cannot be created.
   */
  private getGateway(gatewayId: string, localKey: string): LocalTuyaClient | undefined {
    const known = this.gateways.get(gatewayId);
    if (known !== undefined) return known;
    const address = this.addresses.get(gatewayId);
    if (address === undefined) return undefined;
    try {
      const gateway = createLocalTuyaClient({ deviceId: gatewayId, host: address.host, version: address.version, localKey, ...(this.discovery && { discovery: this.discovery }) });
      this.gateways.set(gatewayId, gateway);
      return gateway;
    } catch (error) {
      this.log.warn(`The gateway ${gatewayId} cannot be reached on the LAN: ${getErrorMessage(error)}`);
      return undefined;
    }
  }

  private async closeGateways(isUnused: (gatewayId: string) => boolean): Promise<void> {
    for (const [gatewayId, gateway] of this.gateways) {
      if (!isUnused(gatewayId)) continue;
      this.gateways.delete(gatewayId);
      await gateway.close().catch(ignoreFailure);
    }
  }

  /**
   * Create the route of a device on the LAN, directly or through its gateway
   *
   * Edge cases:
   *  - no local key -> undefined: the LAN needs one
   *  - a device behind a gateway that was not heard -> undefined
   *  - a device with no host given that was not heard -> undefined
   *  - a client the protocol version cannot have, such as a device behind a 3.1 gateway -> undefined, logged
   *
   * @param {Pick<TuyaDeviceConfig, 'deviceId' | 'localKey' | 'nodeId' | 'gatewayId' | 'host' | 'version'>} device The device.
   * @returns {TuyaClient | undefined} The route, or undefined when the device cannot be reached on the LAN now.
   */
  private createLanRoute(device: Pick<TuyaDeviceConfig, 'deviceId' | 'localKey' | 'nodeId' | 'gatewayId' | 'host' | 'version'>): TuyaClient | undefined {
    const { deviceId, localKey, nodeId, gatewayId } = device;
    if (localKey === undefined) return undefined;
    try {
      if (nodeId !== undefined && gatewayId !== undefined) return this.getGateway(gatewayId, localKey)?.createClient(nodeId);
      const address = device.host !== undefined && device.version !== undefined ? { host: device.host, version: device.version } : this.addresses.get(deviceId);
      if (address === undefined) return undefined;
      return createLocalTuyaClient({ deviceId, host: address.host, version: address.version, localKey, ...(this.discovery && { discovery: this.discovery }) });
    } catch (error) {
      this.log.warn(`${deviceId} cannot be reached on the LAN: ${getErrorMessage(error)}`);
      return undefined;
    }
  }

  /**
   * Build the factory of the client of a stored device: on the LAN first, through its gateway when it is behind one,
   * and through the cloud when it does not answer there
   *
   * @param {TuyaDeviceConfig} device The device.
   * @returns {DeviceConnectionFactory} The factory, which gives undefined while the device has no route.
   */
  private createConnectionFactory(device: TuyaDeviceConfig): DeviceConnectionFactory {
    return (): DeviceConnection | undefined => {
      const entry = findCatalogEntry(device.catalogFile);
      if (entry === undefined) return undefined;
      const lan = device.isCloudOnly === true ? undefined : this.createLanRoute(device);
      const routes: TuyaClient[] = lan === undefined ? [] : [lan];
      const { cloud } = this;
      if (cloud !== undefined) routes.push(new CloudRoute(async () => cloud.createClient(device.deviceId)));
      if (routes.length === 0) return undefined;
      return { client: new RoutedTuyaClient(routes, [entry]), hasLan: lan !== undefined, hasCloud: cloud !== undefined, isOnLan: () => lan?.connected === true };
    };
  }

  // Stores the account and the devices, under a new revision.
  private storeConfig(): void {
    this.config.setupRevision = this.revisions.advance();
    this.config.account = this.account;
    // A device this version cannot read stays stored, until one with its name or its device ID takes its place.
    this.unreadableDevices = getUnreadableDevices(this.unreadableDevices, this.devices);
    this.config.devices = [...this.devices, ...this.unreadableDevices];
    this.saveConfig(this.config);
  }

  /**
   * Make the running devices match a new device list
   *
   * @param {TuyaDeviceConfig[]} devices The new list.
   * @returns {Promise<void>} Resolves when every device is started, stopped or updated.
   */
  private async applyDevices(devices: TuyaDeviceConfig[]): Promise<void> {
    await this.enqueueChange(async () => this.reconcile(devices));
  }

  // Runs inside the queue of changes.
  private async reconcile(devices: TuyaDeviceConfig[]): Promise<void> {
    const previous = this.devices;
    this.devices = devices;
    this.storeConfig();
    for (const device of previous) {
      if (!this.devices.some((candidate) => candidate.deviceId === device.deviceId)) await this.stopDevice(device);
    }
    for (const device of this.devices) {
      const before = previous.find((candidate) => candidate.deviceId === device.deviceId);
      const accessory = this.accessories.get(device.deviceId);
      if (before === undefined || accessory === undefined) {
        await this.startDevice(device);
        continue;
      }
      // The endpoints of a registered device cannot change while Matterbridge runs: the device keeps the ones it was
      // built with, and gets its new ones at the next start.
      if (!hasSameExposure(before, device)) this.requireRestart(device);
      await accessory.updateConfig(device);
      if (!hasSameConnection(before, device)) await accessory.updateConnection(this.createConnectionFactory(device));
    }
    const used = new Set(this.devices.map((device) => device.gatewayId));
    await this.closeGateways((gatewayId) => !used.has(gatewayId));
  }

  private async startStoppedDevices(): Promise<void> {
    for (const device of this.devices) {
      if (!this.accessories.has(device.deviceId)) await this.startDevice(device);
    }
  }

  /**
   * Create the Matter endpoints of a device and register them
   *
   * A device that cannot start is logged and retried on the next read of the device list, never thrown.
   *
   * @param {TuyaDeviceConfig} device The device.
   * @returns {Promise<void>} Resolves when the device runs, or could not be started.
   */
  private async startDevice(device: TuyaDeviceConfig): Promise<void> {
    const entry = findCatalogEntry(device.catalogFile);
    if (entry === undefined) {
      this.startErrors.set(device.deviceId, `The device catalog of this version has no entry from ${device.catalogFile}: set the device up again in the setup page`);
      return;
    }
    const registered: MatterbridgeEndpoint[] = [];
    let accessory: TuyaAccessory | undefined;
    try {
      // An address heard before the device was stored, such as during its setup, is kept from now on: the discovery stores only an address it did not know.
      for (const id of [device.deviceId, device.gatewayId]) {
        const address = id === undefined ? undefined : this.addresses.get(id);
        if (id !== undefined && address !== undefined) await this.addressStore.write(id, address);
      }
      const ids = new EndpointIds(await this.endpointIdStore.read(device));
      accessory = new TuyaAccessory({
        config: device,
        features: getDeviceFeatures(entry),
        productName: getProductName(entry, device.productKey),
        createConnection: this.createConnectionFactory(device),
        log: this.log,
        vendorId: this.matterbridge.aggregatorVendorId,
        ids,
      });
      for (const endpoint of accessory.endpoints) {
        await this.registerDevice(endpoint);
        registered.push(endpoint);
      }
      await this.endpointIdStore.write(device, ids.toStore());
      this.accessories.set(device.deviceId, accessory);
      this.startErrors.delete(device.deviceId);
      // A device that starts is built from its stored options.
      this.restartRequired.delete(device.deviceId);
      this.log.info(`"${device.name}" started with ${accessory.endpoints.length} Matter endpoint(s)`);
      // Not awaited: a device that does not answer must not hold up the start of the others.
      void accessory.start();
    } catch (error) {
      const message = getErrorMessage(error);
      if (this.startErrors.get(device.deviceId) !== message) this.log.warn(`"${device.name}" could not be started and will be retried: ${message}`);
      this.startErrors.set(device.deviceId, message);
      for (const endpoint of registered) await this.unregisterDevice(endpoint);
      await accessory?.dispose();
    }
  }

  /**
   * Note that a device is built again at the next start of Matterbridge, and ask for the restart
   *
   * The endpoints of a registered device cannot change while Matterbridge runs. Taking them away and registering them
   * again makes the Matter apps take the device for a new one, with its room and its automations lost. Across a restart
   * Matterbridge keeps the endpoint numbers, so the apps keep the device. Until the restart, the device keeps the
   * endpoints it was built with.
   *
   * @param {TuyaDeviceConfig} device The device.
   * @returns {void}
   */
  private requireRestart(device: TuyaDeviceConfig): void {
    if (!this.restartRequired.has(device.deviceId)) {
      this.log.notice(`"${device.name}" is built again with its new options at the next restart of Matterbridge: until then it keeps its current ones`);
    }
    this.restartRequired.add(device.deviceId);
    this.wssSendRestartRequired();
  }

  /**
   * Stop a removed device, take its Matter endpoints away and forget its address
   *
   * @param {TuyaDeviceConfig} device The device.
   * @returns {Promise<void>} Resolves when the device is stopped and its address is forgotten.
   */
  private async stopDevice(device: TuyaDeviceConfig): Promise<void> {
    const { name, deviceId } = device;
    const accessory = this.accessories.get(deviceId);
    this.accessories.delete(deviceId);
    this.startErrors.delete(deviceId);
    this.restartRequired.delete(deviceId);
    if (accessory !== undefined) {
      await accessory.dispose();
      for (const endpoint of accessory.endpoints) await this.unregisterDevice(endpoint);
      this.log.info(`"${name}" stopped`);
    }
    await this.addressStore.remove(deviceId);
  }
}
