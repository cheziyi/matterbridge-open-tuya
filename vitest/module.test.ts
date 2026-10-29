/**
 * @file vitest/module.test.ts
 * @description This file contains the tests for the Tuya platform.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

/**
 * WARNING!!!
 * The tests in this unit are supposed to run sequentially because they depend on the Matterbridge/Matter state.
 * Is not possible for timing reasons to create and destroy a Matter node each test to keep isolation.
 */

import type { MatterbridgeEndpoint } from 'matterbridge';
import { BridgedDeviceBasicInformation, OnOff } from 'matterbridge/matter/clusters';
import { log, setupTest } from 'matterbridge/test-utils/vitest';
import { addMatterbridge, createServerNode, createTestEnvironment, getMatterbridge, startServerNode, stopServerNode } from 'matterbridge/test-utils/vitest/matter';
import { type AppCloudSession, type DataPoints, type DiscoveredTuyaDevice, type TuyaCloudDevice, TuyaError } from 'open-tuya';

import type { TuyaDeviceConfig } from '../src/config.js';
import initializePlugin, { deviceSyncIntervalInMs, smartLifeClientId, smartLifeSchema, TuyaPlatform, type TuyaPlatformConfig } from '../src/module.js';
import { createCloudDevice, createDeviceConfig, createFakeRoute, type FakeRoute, lightFile, plugFile, productKeyOf, stripFile } from './fakeTuya.js';

// What the mocked SDK reaches: the devices on the LAN and in the cloud, which the test body sets up.
const net = vi.hoisted(() => ({
  /** The data points each device reports, on the LAN and through the cloud alike, by its device ID or its node ID. */
  dataPoints: new Map<string, Record<string, boolean | number | string>>(),
  /** The routes the platform created on the LAN, by device ID, the last first. */
  lan: new Map<string, unknown>(),
  /** The routes the platform created through the cloud, by device ID. */
  cloud: new Map<string, unknown>(),
  /** The options of each LAN client the platform created. */
  lanOptions: [] as Record<string, unknown>[],
  onDevice: undefined as ((found: DiscoveredTuyaDevice) => void) | undefined,
  discoveryFails: false,
  discoveryClose: undefined as unknown,
  /** What the cloud account lists. */
  listed: [] as TuyaCloudDevice[],
  accounts: [] as Record<string, unknown>[],
  sessionChange: undefined as ((session: AppCloudSession) => void) | undefined,
  qr: undefined as unknown,
}));

vi.mock('open-tuya', async (importOriginal) => {
  const original = await importOriginal<typeof import('open-tuya')>();
  const { createFakeRoute: fakeRoute } = await import('./fakeTuya.js');
  /**
   * Create the route of a device or a node, which reads its data points from `net`
   *
   * @param {string} id The device ID or the node ID.
   * @param {Map<string, unknown>} routes Where the route is kept for the test.
   * @returns {FakeRoute} The route.
   */
  const routeTo = (id: string, routes: Map<string, unknown>): FakeRoute => {
    const route = fakeRoute();
    route.readDataPoints.mockImplementation(async () => {
      const dataPoints = net.dataPoints.get(id);
      if (dataPoints === undefined) throw new original.TuyaError('CONNECTION_FAILED', `${id} does not answer`);
      return Promise.resolve({ ...dataPoints });
    });
    routes.set(id, route);
    return route;
  };
  const createAccount = (options: Record<string, unknown>): unknown => {
    const account = {
      options,
      listDevices: vi.fn(async () => Promise.resolve(net.listed)),
      createClient: vi.fn(async (deviceId: string) => Promise.resolve(routeTo(deviceId, net.cloud))),
      close: vi.fn(async () => Promise.resolve()),
    };
    net.accounts.push(account);
    return account;
  };
  return {
    ...original,
    discoverDevices: vi.fn(async (options: { onDevice?: (found: DiscoveredTuyaDevice) => void }) => {
      if (net.discoveryFails) throw new original.TuyaError('DISCOVERY_FAILED', 'port 6667 is held');
      net.onDevice = options.onDevice;
      const discovery = { devices: new Map(), close: vi.fn(async () => Promise.resolve()) };
      net.discoveryClose = discovery.close;
      return Promise.resolve(discovery);
    }),
    createLocalTuyaClient: vi.fn((options: Record<string, unknown>) => {
      net.lanOptions.push(options);
      const deviceId = String(options.deviceId);
      if (options.localKey === 'badkey') throw new RangeError('The local key is not 16 bytes');
      const route = routeTo(deviceId, net.lan) as FakeRoute & { createClient: (nodeId: string) => FakeRoute };
      route.createClient = (nodeId: string): FakeRoute => {
        if (nodeId === 'refused') throw new TypeError('A 3.1 gateway reaches no device behind it');
        return routeTo(nodeId, net.lan);
      };
      return route;
    }),
    createAppCloudAccount: vi.fn((options: Record<string, unknown>) => {
      net.sessionChange = options.onSessionChange as (session: AppCloudSession) => void;
      return createAccount(options);
    }),
    createDeveloperCloudAccount: vi.fn((options: Record<string, unknown>) => createAccount(options)),
    createQrLogin: vi.fn(() => net.qr),
  };
});

const { createAppCloudAccount, createDeveloperCloudAccount, createLocalTuyaClient, createQrLogin, discoverDevices } = await import('open-tuya');

const pluginName = 'matterbridge-open-tuya';
const session: AppCloudSession = { endpoint: 'https://apigw.tuyaeu.com', accessToken: 'access', refreshToken: 'refresh', expiresAtInMs: Date.now() + 3_600_000 };
const account = { type: 'smartLife' as const, userCode: 'abc123', session };
const plugDataPoints = { '1': true, '2': 0, '4': 53, '5': 123, '6': 2305 };

const deskId = 'bf0000000000000001aa';
const benchId = 'bf0000000000000002aa';
const gatewayId = 'bf00000000000000gw01';
const nodeDeviceId = 'a4c13800000000000001';
const nodeId = 'a4c1380000000001';
const lightId = 'bf0000000000000003aa';

const desk = createDeviceConfig(plugFile, { deviceId: deskId, name: 'Desk', localKey: '0123456789abcdef' });
const listedDesk = createCloudDevice(plugFile, { deviceId: deskId, name: 'Desk plug' });
const listedGateway = createCloudDevice(plugFile, { deviceId: gatewayId, name: 'Hub', productKey: 'gatewayproduct00', localKey: 'gatewaykey000001', category: 'wg2' });
const listedNode = createCloudDevice(plugFile, { deviceId: nodeDeviceId, name: 'Zigbee plug', nodeId, localKey: 'gatewaykey000001' });
const listedLight = createCloudDevice(lightFile, { deviceId: lightId, name: 'Path lights', category: 'dj' });
const listedBench = createCloudDevice(stripFile, { deviceId: benchId, name: 'Bench strip', category: 'pc' });

/**
 * Build the platform configuration
 *
 * @param {Partial<TuyaPlatformConfig>} overrides The fields to replace.
 * @returns {TuyaPlatformConfig} The configuration.
 */
function createConfig(overrides: Partial<TuyaPlatformConfig> = {}): TuyaPlatformConfig {
  return { name: pluginName, type: 'DynamicPlatform', version: '0.1.0', debug: false, unregisterOnShutdown: false, ...overrides };
}

/**
 * Get the route the platform created to a device
 *
 * @param {Map<string, unknown>} routes The routes on the LAN or through the cloud.
 * @param {string} id The device ID or the node ID.
 * @returns {FakeRoute} The route.
 * @throws {Error} When the platform created none.
 */
function routeOf(routes: Map<string, unknown>, id: string): FakeRoute {
  const route = routes.get(id);
  if (route === undefined) throw new Error(`No route to ${id}`);
  return route as FakeRoute;
}

/**
 * Hear a device on the LAN, as the discovery does when it broadcasts
 *
 * @param {string} deviceId The device ID.
 * @param {string} host Its address.
 * @returns {Promise<void>} Resolves once the platform had the time to take it in.
 */
async function hear(deviceId: string, host: string): Promise<void> {
  net.onDevice?.({ deviceId, host, version: '3.3', productKey: productKeyOf(plugFile) });
  // The platform takes a broadcast in on its own: a turn of the event loop lets it.
  await new Promise((resolve) => setTimeout(resolve, 10));
}

await setupTest('TuyaPlatform', false);

describe('TuyaPlatform', () => {
  const matterbridge = { ...getMatterbridge(), bridgeMode: 'bridge' as const };
  const saveConfig = vi.spyOn(TuyaPlatform.prototype, 'saveConfig').mockImplementation(() => undefined);
  const restartRequired = vi.spyOn(TuyaPlatform.prototype, 'wssSendRestartRequired').mockImplementation(() => undefined);
  let platform: TuyaPlatform;

  /**
   * Wait until the queued changes and reads of the platform are done
   *
   * @returns {Promise<void>} Resolves after the pending work.
   */
  async function settle(): Promise<void> {
    await platform.syncDevices();
    await platform.pollDevices();
  }

  /**
   * Find a registered device by the label the Matter apps show
   *
   * @param {string} label The label.
   * @returns {MatterbridgeEndpoint | undefined} The device, when one has the label.
   */
  function byLabel(label: string): MatterbridgeEndpoint | undefined {
    return platform.getDevices().find((device) => device.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel') === label);
  }

  /**
   * Get the stored device of a device ID
   *
   * @param {string} deviceId The device ID.
   * @returns {TuyaDeviceConfig | undefined} The device, as last stored.
   */
  function storedDevice(deviceId: string): TuyaDeviceConfig | undefined {
    return (platform.config.devices as TuyaDeviceConfig[] | undefined)?.find((device) => device.deviceId === deviceId);
  }

  beforeAll(async () => {
    await createTestEnvironment();
    await createServerNode(6302);
    await startServerNode();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await stopServerNode();
    vi.restoreAllMocks();
  });

  test('should throw an error if matterbridge is not the required version', () => {
    expect(() => new TuyaPlatform({ ...matterbridge, matterbridgeVersion: '2.0.0' }, log, createConfig())).toThrow(
      'This plugin requires Matterbridge version >= "3.10.10". Please update Matterbridge from 2.0.0 to the latest version in the frontend.',
    );
  });

  test('should warn of an account it cannot read, and say why the LAN is not listened to', async () => {
    net.discoveryFails = true;
    const signedOut = initializePlugin(
      matterbridge,
      log,
      createConfig({ account: { type: 'smartLife' }, devices: [createDeviceConfig(plugFile, { deviceId: 'bf0000000000000099aa', isCloudOnly: true })] }),
    );
    expect(log.warn).toHaveBeenCalledWith('The stored Tuya account cannot be read: sign in again in the setup page');
    addMatterbridge(signedOut);
    await signedOut.onStart();
    expect(log.info).toHaveBeenCalledWith(`Starting platform ${pluginName} with reason: no reason provided...`);
    const state = await signedOut.getSetupState();
    expect(state.account).toBeUndefined();
    expect(state.discoveryError).toBe('Another program holds a port the discovery of devices on the LAN listens on (port 6667 is held)');
    // A device on the cloud alone has no route without an account: it runs, unreachable.
    expect(state.devices[0]).toMatchObject({ status: 'offline', hasLan: false, error: expect.stringContaining('The device has no route') });
    expect(state.devices[0]).not.toHaveProperty('localKey');
    await expect(signedOut.listDevices()).rejects.toThrow('Sign in to your Tuya account first');
    expect(await signedOut.probe(deskId)).toEqual({ status: 'signInRequired', deviceId: deskId, message: 'Sign in to your Tuya account first' });
    // Nothing to sync without an account.
    await signedOut.syncDevices();
    await signedOut.onShutdown();
    expect(log.info).toHaveBeenCalledWith(`Shutting down platform ${pluginName} with reason: no reason provided...`);
    await signedOut.unregisterAllDevices();
    net.discoveryFails = false;
  });

  test('should create the platform and report stored devices that are not valid', () => {
    platform = initializePlugin(matterbridge, log, createConfig({ account, devices: [desk, { name: 'Broken' }], pollIntervalInSeconds: 20 }));
    expect(platform).toBeInstanceOf(TuyaPlatform);
    addMatterbridge(platform);
    expect(log.info).toHaveBeenCalledWith(`Initializing platform ${pluginName}...`);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  test('should ignore a saved configuration before it is started', async () => {
    await platform.onConfigChanged(createConfig({ devices: [] }));
    expect(platform.getDevices()).toHaveLength(0);
  });

  test('should start the stored devices through the cloud while the LAN has not heard them', async () => {
    net.listed = [listedDesk, listedGateway, listedNode, listedLight, listedBench];
    net.dataPoints.set(deskId, plugDataPoints);
    await platform.onStart('Vitest');
    expect(log.info).toHaveBeenCalledWith(`Starting platform ${pluginName} with reason: Vitest...`);
    expect(createAppCloudAccount).toHaveBeenCalledWith(expect.objectContaining({ clientId: smartLifeClientId, session }));
    expect(discoverDevices).toHaveBeenCalled();
    expect(platform.getDevices()).toHaveLength(1);
    await vi.waitFor(() => expect(byLabel('Desk')?.getAttribute(OnOff, 'onOff')).toBe(true));
    expect(createLocalTuyaClient).not.toHaveBeenCalled();
    const state = await platform.getSetupState();
    expect(state.account).toEqual({ type: 'smartLife', userCode: 'abc123', needsSignIn: false });
    expect(state.devices[0]).toMatchObject({ name: 'Desk', status: 'online', route: 'cloud', hasLan: false, productName: 'SP111-A', needsRestart: false });
    expect(state.devices[0]?.features?.outlets).toHaveLength(1);
    expect(state.devices[0]).not.toHaveProperty('localKey');
    await platform.onConfigure();
    expect(log.info).toHaveBeenCalledWith(`Configuring platform ${pluginName}...`);
    // The setup page reaches the platform through onFetch.
    expect(await platform.onFetch('GET', 'state')).toMatchObject({ ok: true, state: { devices: [{ name: 'Desk' }] } });
  });

  test('should give a device heard on the LAN a route there, and store the address', async () => {
    await hear(deskId, '192.168.1.20');
    await vi.waitFor(() => expect(createLocalTuyaClient).toHaveBeenCalled());
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: deskId, host: '192.168.1.20', version: '3.3', localKey: '0123456789abcdef' }));
    await vi.waitFor(async () => expect((await platform.getSetupState()).devices[0]).toMatchObject({ route: 'lan', hasLan: true }));
    expect(await platform.context?.get(`lan:${deskId}`)).toEqual({ host: '192.168.1.20', version: '3.3' });
    // The same broadcast again changes nothing, and a device the platform does not store is noted but not kept.
    vi.mocked(createLocalTuyaClient).mockClear();
    net.onDevice?.({ deviceId: deskId, host: '192.168.1.20', version: '3.3', productKey: 'x' });
    net.onDevice?.({ deviceId: 'bf0000000000000077aa', host: '192.168.1.77', version: '3.4', productKey: 'x' });
    await settle();
    expect(createLocalTuyaClient).not.toHaveBeenCalled();
    expect(await platform.context?.get('lan:bf0000000000000077aa')).toBeUndefined();
  });

  test('should list the devices of the account, with whether the plugin controls each and the gateway of a device behind one', async () => {
    await hear(gatewayId, '192.168.1.30');
    const devices = await platform.listDevices();
    const byId = new Map(devices.map((device) => [device.deviceId, device]));
    expect(byId.get(deskId)).toMatchObject({ support: 'supported', isConfigured: true, hasLocalKey: true, lan: { host: '192.168.1.20', version: '3.3' } });
    expect(byId.get(gatewayId)).toMatchObject({ support: 'gateway', isConfigured: false });
    expect(byId.get(nodeDeviceId)).toMatchObject({ support: 'supported', nodeId, gatewayId, lan: { host: '192.168.1.30' } });
    expect(byId.get(lightId)).toMatchObject({ support: 'otherKind' });
    expect(byId.get(lightId)?.lan).toBeUndefined();
    expect(JSON.stringify(devices)).not.toContain('gatewaykey000001');
  });

  test('should check a device behind a gateway through the client of the gateway', async () => {
    net.dataPoints.set(nodeId, plugDataPoints);
    const result = await platform.probe(nodeDeviceId);
    expect(result).toMatchObject({ status: 'ready', catalogFile: plugFile, route: 'lan' });
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: gatewayId, host: '192.168.1.30', localKey: 'gatewaykey000001' }));
    expect(routeOf(net.lan, nodeId).readDataPoints).toHaveBeenCalled();
    // One client of the gateway serves every device behind it.
    vi.mocked(createLocalTuyaClient).mockClear();
    expect((await platform.probe(nodeDeviceId)).status).toBe('ready');
    expect(createLocalTuyaClient).not.toHaveBeenCalled();
  });

  test('should check a device through the cloud alone when it is set to the cloud alone, and say a device the account no longer lists', async () => {
    net.dataPoints.set(benchId, { '1': true, '2': false, '3': true, '4': false, '5': true });
    expect((await platform.probe(benchId)).route).toBe('cloud');
    expect(await platform.probe('bf0000000000000055aa')).toEqual({
      status: 'failed',
      deviceId: 'bf0000000000000055aa',
      message: 'The Tuya account no longer lists the device: read the device list again',
    });
  });

  test('should store a device the setup page saves, with what the cloud lists of it', async () => {
    // The page never sees the local key, the node or the gateway: they come from the list.
    const fromPage = createDeviceConfig(plugFile, { deviceId: nodeDeviceId, name: 'Zigbee', localKey: undefined, nodeId: 'forged0000000000', gatewayId: 'forged0000000000' });
    delete fromPage.localKey;
    await platform.saveDevice(fromPage);
    expect(saveConfig).toHaveBeenCalled();
    expect(storedDevice(nodeDeviceId)).toMatchObject({ localKey: 'gatewaykey000001', nodeId, gatewayId, cloudName: 'Zigbee plug', category: 'cz' });
    expect(platform.getDevices()).toHaveLength(2);
    await vi.waitFor(() => expect(byLabel('Zigbee')?.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(true));
    const state = await platform.getSetupState();
    expect(state.devices.find((device) => device.deviceId === nodeDeviceId)).toMatchObject({ status: 'online', route: 'lan', hasLan: true });
  });

  test('should refuse a name another device has, and a catalog entry the catalog does not have', async () => {
    await expect(platform.saveDevice(createDeviceConfig(plugFile, { deviceId: nodeDeviceId, name: 'Desk' }))).rejects.toThrow('Another device is already named "Desk"');
    await expect(platform.saveDevice(createDeviceConfig(plugFile, { deviceId: benchId, name: 'Bench', catalogFile: 'nothing.yaml' }))).rejects.toThrow(
      'The device catalog has no entry from nothing.yaml',
    );
  });

  test('should rename a device in place, and build it again with new options at the next restart', async () => {
    await platform.saveDevice({ ...desk, name: 'Lamp' });
    expect(byLabel('Lamp')).toBeDefined();
    expect(restartRequired).not.toHaveBeenCalled();
    await platform.saveDevice({ ...desk, name: 'Lamp', hiddenFeatures: ['meter'] });
    expect(restartRequired).toHaveBeenCalled();
    expect(log.notice).toHaveBeenCalledWith('"Lamp" is built again with its new options at the next restart of Matterbridge: until then it keeps its current ones');
    expect((await platform.getSetupState()).devices[0]?.needsRestart).toBe(true);
  });

  test('should reconnect a device set to the cloud alone, and one given a host', async () => {
    await platform.saveDevice({ ...desk, name: 'Lamp', hiddenFeatures: ['meter'], isCloudOnly: true });
    await vi.waitFor(async () => expect((await platform.getSetupState()).devices[0]).toMatchObject({ status: 'online', route: 'cloud', hasLan: false }));
    // A device set to the cloud alone is checked through the cloud alone.
    vi.mocked(createLocalTuyaClient).mockClear();
    expect(await platform.probe(deskId)).toMatchObject({ status: 'ready', route: 'cloud' });
    expect(createLocalTuyaClient).not.toHaveBeenCalled();
    await platform.saveDevice({ ...desk, name: 'Lamp', hiddenFeatures: ['meter'], host: '10.0.0.5', version: '3.4' });
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: deskId, host: '10.0.0.5', version: '3.4' }));
  });

  test('should take a new local key from the device list, and reconnect the device with it', async () => {
    net.listed = [{ ...listedDesk, localKey: 'fedcba9876543210' }, listedGateway, listedNode, listedLight, listedBench];
    vi.mocked(createLocalTuyaClient).mockClear();
    await platform.syncDevices();
    expect(log.notice).toHaveBeenCalledWith('"Lamp" has a new local key');
    expect(storedDevice(deskId)?.localKey).toBe('fedcba9876543210');
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: deskId, localKey: 'fedcba9876543210' }));
    // A list with nothing new stores nothing, nor one that leaves a stored device out.
    saveConfig.mockClear();
    await platform.syncDevices();
    net.listed = [listedGateway, listedNode, { ...listedLight, category: '', localKey: undefined }, listedBench];
    await platform.syncDevices();
    expect(saveConfig).not.toHaveBeenCalled();
    expect(storedDevice(deskId)?.localKey).toBe('fedcba9876543210');
    // A device the cloud gives no local key is checked through the cloud alone.
    net.dataPoints.set(lightId, {});
    expect((await platform.probe(lightId)).status).toBe('unsupported');
    net.listed = [{ ...listedDesk, localKey: 'fedcba9876543210' }, listedGateway, listedNode, listedLight, listedBench];
    await platform.syncDevices();
  });

  test('should log a device list the cloud does not give, and note an account the cloud no longer accepts', async () => {
    const cloud = net.accounts.at(-1) as { listDevices: ReturnType<typeof vi.fn> };
    cloud.listDevices.mockRejectedValueOnce(new TuyaError('RATE_LIMITED', 'slow down'));
    await platform.syncDevices();
    expect(log.warn).toHaveBeenCalledWith('The devices of the Tuya account could not be read: The Tuya cloud was asked too often: wait a minute, then try again (slow down)');
    cloud.listDevices.mockRejectedValueOnce(new TuyaError('SESSION_EXPIRED', 'sign in'));
    await expect(platform.listDevices()).rejects.toThrow('sign in');
    expect(log.warn).toHaveBeenCalledWith('The Tuya cloud no longer accepts the account: sign in again in the setup page');
    expect((await platform.getSetupState()).account?.needsSignIn).toBe(true);
    // A list read again takes the rejection back.
    await platform.listDevices();
    expect((await platform.getSetupState()).account?.needsSignIn).toBe(false);
  });

  test('should note an account the cloud no longer accepts from a poll, and from a check', async () => {
    // The LAN does not answer, and the cloud refuses the account.
    const lan = routeOf(net.lan, deskId);
    const route = routeOf(net.cloud, deskId);
    lan.readDataPoints.mockRejectedValue(new TuyaError('CONNECTION_FAILED', 'gone'));
    route.readDataPoints.mockRejectedValue(new TuyaError('SESSION_EXPIRED', 'sign in'));
    await platform.pollDevices();
    expect((await platform.getSetupState()).account?.needsSignIn).toBe(true);
    for (const answering of [lan, route]) {
      answering.readDataPoints.mockReset();
      answering.readDataPoints.mockResolvedValue(plugDataPoints);
    }
    const cloud = net.accounts.at(-1) as { createClient: ReturnType<typeof vi.fn> };
    cloud.createClient.mockRejectedValueOnce(new TuyaError('SESSION_EXPIRED', 'sign in'));
    net.dataPoints.delete(benchId);
    expect((await platform.probe(benchId)).status).toBe('signInRequired');
    net.dataPoints.set(benchId, { '1': true });
    const account = net.accounts.at(-1) as { listDevices: ReturnType<typeof vi.fn> };
    account.listDevices.mockRejectedValueOnce(new TuyaError('SESSION_EXPIRED', 'sign in'));
    expect(await platform.probe('bf0000000000000055aa')).toMatchObject({ status: 'signInRequired' });
    await platform.listDevices();
  });

  test('should store each new session of the Smart Life cloud, and ignore one of an account replaced', async () => {
    saveConfig.mockClear();
    const refreshed = { ...session, refreshToken: 'refresh-2' };
    net.sessionChange?.(refreshed);
    expect(saveConfig).toHaveBeenCalled();
    expect(platform.config.account).toMatchObject({ session: refreshed });
    expect((await platform.getSetupState()).account?.needsSignIn).toBe(false);
  });

  test('should apply a poll interval saved in the config editor, and ignore the configuration it stored itself', async () => {
    const ownRevision = platform.config.setupRevision;
    saveConfig.mockClear();
    await platform.onConfigChanged({ ...platform.config, setupRevision: ownRevision });
    expect(saveConfig).not.toHaveBeenCalled();
    // A copy of the editor from before: the account and the devices are stored again as they are.
    await platform.onConfigChanged(createConfig({ devices: [], pollIntervalInSeconds: 60, setupRevision: 0 }));
    expect(saveConfig).toHaveBeenCalled();
    expect(platform.getDevices()).toHaveLength(2);
    saveConfig.mockClear();
    await platform.onConfigChanged({ ...platform.config, pollIntervalInSeconds: 60 });
    expect(saveConfig).not.toHaveBeenCalled();
    // The configuration of this revision again, from the editor: nothing changed, nothing to store.
    await platform.onConfigChanged({ ...platform.config, pollIntervalInSeconds: 60 });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('should sign out and keep the devices on the LAN', async () => {
    const cloud = net.accounts.at(-1) as { close: ReturnType<typeof vi.fn> };
    await platform.signOut();
    expect(cloud.close).toHaveBeenCalled();
    expect(log.notice).toHaveBeenCalledWith('Signed out of the Tuya account');
    const state = await platform.getSetupState();
    expect(state.account).toBeUndefined();
    expect(platform.getDevices()).toHaveLength(2);
    await vi.waitFor(async () =>
      expect((await platform.getSetupState()).devices.find((device) => device.deviceId === nodeDeviceId)).toMatchObject({ status: 'online', route: 'lan' }),
    );
    // Without an account there is no device list to check a device from, even one the platform hears.
    expect((await platform.probe(nodeDeviceId)).status).toBe('signInRequired');
    // Without a list, a device saved keeps what the cloud listed of it before.
    const zigbee = storedDevice(nodeDeviceId);
    if (zigbee === undefined) throw new Error('No Zigbee device');
    await platform.saveDevice({ ...zigbee, name: 'Zigbee' });
    expect(storedDevice(nodeDeviceId)).toMatchObject({ localKey: 'gatewaykey000001', nodeId, gatewayId, cloudName: 'Zigbee plug' });
  });

  test('should sign in by QR code, and store the session the scan gives', async () => {
    let scan: (value: AppCloudSession) => void = () => undefined;
    net.qr = {
      requestQrCode: vi.fn(async () => Promise.resolve('tuyaSmart--qrLogin?token=1')),
      waitForScan: vi.fn(
        async () =>
          new Promise<AppCloudSession>((resolve) => {
            scan = resolve;
          }),
      ),
    };
    const previousSessionChange = net.sessionChange;
    expect(await platform.startQrLogin('abc123')).toEqual({ status: 'waiting', qrCode: 'tuyaSmart--qrLogin?token=1' });
    expect(createQrLogin).toHaveBeenCalledWith({ clientId: smartLifeClientId, schema: smartLifeSchema, userCode: 'abc123' });
    expect(platform.getQrLogin().status).toBe('waiting');
    scan({ ...session, refreshToken: 'refresh-3' });
    await vi.waitFor(() => expect(platform.getQrLogin()).toEqual({ status: 'signedIn' }));
    expect(log.notice).toHaveBeenCalledWith('Signed in to the Smart Life cloud');
    expect(platform.config.account).toMatchObject({ type: 'smartLife', userCode: 'abc123', session: { refreshToken: 'refresh-3' } });
    await settle();
    expect((await platform.getSetupState()).account).toEqual({ type: 'smartLife', userCode: 'abc123', needsSignIn: false });
    // A session of the account signed in before is not stored over the new one.
    saveConfig.mockClear();
    previousSessionChange?.({ ...session, refreshToken: 'stale' });
    expect(saveConfig).not.toHaveBeenCalled();
  });

  test('should say when a QR code expires or the sign in fails, and stop waiting when cancelled', async () => {
    const waitForScan = vi.fn();
    net.qr = { requestQrCode: vi.fn(async () => Promise.resolve('tuyaSmart--qrLogin?token=2')), waitForScan };
    waitForScan.mockRejectedValueOnce(new TuyaError('QR_CODE_EXPIRED', 'The QR code expired'));
    await platform.startQrLogin('abc123');
    await vi.waitFor(() => expect(platform.getQrLogin().status).toBe('expired'));
    waitForScan.mockRejectedValueOnce(new TuyaError('REQUEST_REJECTED', 'refused'));
    await platform.startQrLogin('abc123');
    await vi.waitFor(() => expect(platform.getQrLogin()).toEqual({ status: 'failed', message: 'refused' }));
    expect(log.warn).toHaveBeenCalledWith('The sign in to the Smart Life cloud failed: refused');
    // A wait that is cancelled says nothing more.
    waitForScan.mockImplementationOnce(async (_qrCode: string, options: { signal: AbortSignal }) => {
      await new Promise((resolve) => {
        options.signal.addEventListener('abort', resolve);
      });
      throw new Error('aborted');
    });
    await platform.startQrLogin('abc123');
    platform.cancelQrLogin();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(platform.getQrLogin()).toEqual({ status: 'idle' });
    // A scan that comes in after a cancel changes nothing.
    let scan: (value: AppCloudSession) => void = () => undefined;
    waitForScan.mockImplementationOnce(
      async () =>
        new Promise<AppCloudSession>((resolve) => {
          scan = resolve;
        }),
    );
    await platform.startQrLogin('abc123');
    platform.cancelQrLogin();
    scan(session);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(platform.getQrLogin()).toEqual({ status: 'idle' });
  });

  test('should give up on a QR code that is not scanned in time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const waitForScan = vi.fn(async (_qrCode: string, options: { signal: AbortSignal }) => {
        await new Promise((resolve) => {
          options.signal.addEventListener('abort', resolve);
        });
        throw options.signal.reason;
      });
      net.qr = { requestQrCode: vi.fn(async () => Promise.resolve('tuyaSmart--qrLogin?token=3')), waitForScan };
      await platform.startQrLogin('abc123');
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(platform.getQrLogin()).toMatchObject({ status: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  test('should refuse a User Code the cloud does not take', async () => {
    net.qr = { requestQrCode: vi.fn(async () => Promise.reject(new TuyaError('REQUEST_REJECTED', 'The cloud answered 1004: bad code'))), waitForScan: vi.fn() };
    await expect(platform.startQrLogin('wrong1')).rejects.toThrow('The Smart Life cloud did not give a QR code: check the User Code. The cloud answered 1004: bad code');
  });

  test('should sign in to the developer platform once it lists the devices of the project', async () => {
    const request = { accessId: 'id', accessSecret: 'secret', dataCenter: 'eu' as const };
    vi.mocked(createDeveloperCloudAccount).mockImplementationOnce(() => {
      const failing = { listDevices: vi.fn(async () => Promise.reject(new TuyaError('PERMISSION_DENIED', 'plan expired'))), close: vi.fn(async () => Promise.resolve()) };
      return failing as never;
    });
    await expect(platform.signInDeveloper(request)).rejects.toThrow('The Tuya developer platform did not list the devices of the project');
    await platform.signInDeveloper(request);
    expect(createDeveloperCloudAccount).toHaveBeenCalledWith(request);
    expect(log.notice).toHaveBeenCalledWith('Signed in to the Tuya developer platform with the project id');
    await settle();
    expect((await platform.getSetupState()).account).toEqual({ type: 'developer', accessId: 'id', dataCenter: 'eu', needsSignIn: false });
    expect(platform.config.account).toMatchObject({ type: 'developer', accessSecret: 'secret' });
  });

  test('should restart with the addresses it heard, and reach the devices on the LAN at once', async () => {
    await platform.onShutdown('restart');
    expect(net.discoveryClose).toHaveBeenCalled();
    await platform.unregisterAllDevices();
    vi.mocked(createLocalTuyaClient).mockClear();
    platform = initializePlugin(matterbridge, log, platform.config);
    addMatterbridge(platform);
    await platform.onStart('restart');
    // The device given a host is reached there, the device behind the gateway through the gateway heard before.
    await vi.waitFor(() => expect(createLocalTuyaClient).toHaveBeenCalledTimes(2));
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: deskId, host: '10.0.0.5' }));
    expect(createLocalTuyaClient).toHaveBeenCalledWith(expect.objectContaining({ deviceId: gatewayId, host: '192.168.1.30' }));
    expect(platform.getDevices()).toHaveLength(2);
    await vi.waitFor(async () => expect((await platform.getSetupState()).devices[0]?.needsRestart).toBe(false));
  });

  test('should not start a device the catalog has no entry for, and not reach one on the LAN with a key it refuses', async () => {
    const odd = initializePlugin(
      matterbridge,
      log,
      createConfig({
        devices: [
          createDeviceConfig(plugFile, { deviceId: 'bf0000000000000088aa', name: 'Gone', catalogFile: 'removed_plug.yaml' }),
          createDeviceConfig(plugFile, { deviceId: 'bf0000000000000089aa', name: 'Odd', localKey: 'badkey', host: '10.0.0.9', version: '3.3' }),
          createDeviceConfig(plugFile, { deviceId: 'bf0000000000000090aa', name: 'Node', nodeId: 'refused', gatewayId: 'bf00000000000000gw09', localKey: 'nodekey000000001' }),
          createDeviceConfig(plugFile, { deviceId: 'bf0000000000000091aa', name: 'Far', nodeId: 'a4c1380000000091', gatewayId: 'bf00000000000000gw08', localKey: 'badkey' }),
        ],
      }),
    );
    addMatterbridge(odd);
    await odd.onStart();
    net.onDevice?.({ deviceId: 'bf00000000000000gw09', host: '10.0.0.10', version: '3.1', productKey: 'x' });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith('bf0000000000000090aa cannot be reached on the LAN: A 3.1 gateway reaches no device behind it'));
    net.onDevice?.({ deviceId: 'bf00000000000000gw08', host: '10.0.0.11', version: '3.3', productKey: 'x' });
    await vi.waitFor(() => expect(log.warn).toHaveBeenCalledWith('The gateway bf00000000000000gw08 cannot be reached on the LAN: The local key is not 16 bytes'));
    const state = await odd.getSetupState();
    expect(state.devices[0]).toMatchObject({ status: 'stopped', error: expect.stringContaining('has no entry from removed_plug.yaml'), features: undefined });
    expect(log.warn).toHaveBeenCalledWith('bf0000000000000089aa cannot be reached on the LAN: The local key is not 16 bytes');
    expect(await odd.removeDevice('bf0000000000000088aa')).toBe(true);
    await odd.onShutdown();
    // The test aggregator unregisters every device of every platform at once: only those of this one go.
    for (const device of odd.getDevices()) await odd.unregisterDevice(device);
  });

  test('should keep naming the controls of a running device by the entry it was built with, and take what is stored when the cloud lists nothing', async () => {
    const edgeId = 'bf0000000000000060aa';
    const bareId = 'bf0000000000000061aa';
    net.dataPoints.set(edgeId, { ...plugDataPoints });
    const edge = initializePlugin(
      matterbridge,
      log,
      createConfig({
        devices: [
          createDeviceConfig(plugFile, { deviceId: edgeId, name: 'Edge', host: '10.0.0.20', version: '3.3' }),
          createDeviceConfig(plugFile, { deviceId: bareId, name: 'Bare', localKey: undefined, isCloudOnly: true }),
          createDeviceConfig(plugFile, { deviceId: 'bf0000000000000062aa', name: 'Gone again', catalogFile: 'removed_plug.yaml' }),
        ],
      }),
    );
    addMatterbridge(edge);
    await edge.onStart();
    const edgeEndpoint = (): MatterbridgeEndpoint | undefined => edge.getDevices().find((device) => device.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel') === 'Edge');
    const stored = (deviceId: string): TuyaDeviceConfig | undefined => (edge.config.devices as TuyaDeviceConfig[]).find((device) => device.deviceId === deviceId);
    await vi.waitFor(() => expect(edgeEndpoint()?.getAttribute(OnOff, 'onOff')).toBe(true));

    // A device stored without what the cloud lists keeps it so while the cloud lists nothing.
    const bare = stored(bareId);
    if (bare === undefined) throw new Error('No bare device');
    await edge.saveDevice({ ...bare, name: 'Bare too' });
    expect(stored(bareId)).toMatchObject({ name: 'Bare too' });
    expect(stored(bareId)).not.toHaveProperty('localKey');
    expect(stored(bareId)).not.toHaveProperty('cloudName');
    expect(stored(bareId)).not.toHaveProperty('category');

    // A new catalog entry waits for the restart: until then the controls are named by the entry the endpoints were built from.
    const before = stored(edgeId);
    if (before === undefined) throw new Error('No edge device');
    net.dataPoints.set(edgeId, { ...plugDataPoints, '1': false });
    await edge.saveDevice({ ...before, catalogFile: stripFile });
    await vi.waitFor(() => expect(edgeEndpoint()?.getAttribute(OnOff, 'onOff')).toBe(false));
    expect(restartRequired).toHaveBeenCalledTimes(1);
    // A second change before the restart asks for it again, and notes the device once.
    vi.mocked(log.notice).mockClear();
    await edge.saveDevice({ ...before, catalogFile: stripFile, isComposed: false });
    expect(restartRequired).toHaveBeenCalledTimes(2);
    expect(log.notice).not.toHaveBeenCalledWith(expect.stringContaining('is built again with its new options'));

    // A device with a route on the LAN follows a new address through the discovery: it needs no new client.
    vi.mocked(createLocalTuyaClient).mockClear();
    await edge.hearDevice({ deviceId: edgeId, host: '10.0.0.21', version: '3.3', productKey: 'x' });
    expect(createLocalTuyaClient).not.toHaveBeenCalled();

    // An account signed in starts again a device that could not start, and a list with no category and no local key adds neither.
    const listed = net.listed;
    const { localKey: _localKey, ...bareListed } = createCloudDevice(plugFile, { deviceId: bareId, name: 'Bare plug', category: '' });
    net.listed = [bareListed];
    await edge.signInDeveloper({ accessId: 'edgeproject', accessSecret: 'secret', dataCenter: 'eu' });
    expect((await edge.getSetupState()).devices[2]).toMatchObject({ status: 'stopped', error: expect.stringContaining('has no entry from removed_plug.yaml') });
    await edge.syncDevices();
    expect(stored(bareId)).toMatchObject({ cloudName: 'Bare plug' });
    expect(stored(bareId)).not.toHaveProperty('category');
    expect(stored(bareId)).not.toHaveProperty('localKey');
    // A device the last list does not have is listed again, and a session the cloud refuses says to sign in again.
    const cloud = net.accounts.at(-1) as { listDevices: ReturnType<typeof vi.fn> };
    cloud.listDevices.mockRejectedValueOnce(new TuyaError('SESSION_EXPIRED', 'The session expired'));
    expect(await edge.probe('bf0000000000000063aa')).toMatchObject({ status: 'signInRequired', deviceId: 'bf0000000000000063aa' });
    cloud.listDevices.mockRejectedValueOnce(new TuyaError('REQUEST_TIMED_OUT', 'The cloud did not answer'));
    expect(await edge.probe('bf0000000000000063aa')).toMatchObject({ status: 'failed', deviceId: 'bf0000000000000063aa' });
    net.listed = listed;
    await edge.onShutdown();
    for (const device of edge.getDevices()) await edge.unregisterDevice(device);
  });

  test('should log a device whose endpoints cannot be registered, and retry it', async () => {
    const original = TuyaPlatform.prototype.registerDevice;
    const unregister = vi.spyOn(TuyaPlatform.prototype, 'unregisterDevice');
    // The strip is a device for each outlet: its first one registers, its second does not.
    const register = vi
      .spyOn(TuyaPlatform.prototype, 'registerDevice')
      .mockImplementationOnce(async function (this: TuyaPlatform, endpoint: MatterbridgeEndpoint) {
        return original.call(this, endpoint);
      })
      .mockRejectedValueOnce(new Error('taken'));
    await platform.saveDevice(createDeviceConfig(stripFile, { deviceId: benchId, name: 'Bench', isComposed: false }));
    expect(log.warn).toHaveBeenCalledWith('"Bench" could not be started and will be retried: taken');
    expect(unregister).toHaveBeenCalledTimes(1);
    expect((await platform.getSetupState()).devices.find((device) => device.deviceId === benchId)).toMatchObject({ status: 'stopped', error: 'taken' });
    // The same failure again is not logged again.
    vi.mocked(log.warn).mockClear();
    register.mockRejectedValueOnce(new Error('taken'));
    await platform.syncDevices();
    expect(log.warn).not.toHaveBeenCalledWith('"Bench" could not be started and will be retried: taken');
    register.mockRestore();
    unregister.mockRestore();
    await platform.syncDevices();
    expect(byLabel('Bench')).toBeDefined();
  });

  test('should log a change that fails, and an address it cannot store', async () => {
    saveConfig.mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const bench = storedDevice(benchId);
    if (bench === undefined) throw new Error('No bench');
    await expect(platform.saveDevice(bench)).rejects.toThrow('disk full');
    expect(log.error).toHaveBeenCalledWith('A change to the devices failed: disk full');
    const storage = platform.context;
    if (storage === undefined) throw new Error('No storage');
    vi.spyOn(storage, 'set').mockRejectedValueOnce(new Error('read-only'));
    await platform.hearDevice({ deviceId: benchId, host: '192.168.1.40', version: '3.3', productKey: 'x' });
    expect(log.debug).toHaveBeenCalledWith(`The address of ${benchId} could not be stored: read-only`);
  });

  test('should fire the poll and the sync on their timers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const restarted = initializePlugin(matterbridge, log, createConfig({ pollIntervalInSeconds: 10 }));
      addMatterbridge(restarted);
      const poll = vi.spyOn(restarted, 'pollDevices');
      const sync = vi.spyOn(restarted, 'syncDevices');
      await restarted.onStart();
      sync.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(poll).toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(deviceSyncIntervalInMs);
      expect(sync).toHaveBeenCalled();
      await restarted.onShutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  test('should remove a device and its endpoints, and forget its address', async () => {
    expect(await platform.removeDevice('bf0000000000000055aa')).toBe(false);
    expect(await platform.removeDevice(nodeDeviceId)).toBe(true);
    expect(log.info).toHaveBeenCalledWith('"Zigbee" stopped');
    // The desk, and the bench with a device of its own for each outlet.
    expect(platform.getDevices()).toHaveLength(6);
    expect(await platform.context?.get(`lan:${nodeDeviceId}`)).toBeUndefined();
  });

  test('should change the log level, and shut down unregistering every device when it is set to', async () => {
    await platform.onChangeLoggerLevel('debug' as never);
    expect(log.info).toHaveBeenCalledWith('onChangeLoggerLevel called with: debug');
    platform.config.unregisterOnShutdown = true;
    await platform.onShutdown();
    expect(platform.getDevices()).toHaveLength(0);
  });
});
