/**
 * @file vitest/accessory/factoryReset.test.ts
 * @description This file contains the tests for a device that outlives a factory reset of the Matter node.
 * @author Calvin Che
 */

/**
 * WARNING!!!
 * The tests in this unit are supposed to run sequentially because they depend on the Matter state.
 * The node is reset to factory defaults, so they have a server node of their own.
 */

import type { MatterbridgeEndpoint } from 'matterbridge';
import type { ActionContext } from 'matterbridge/matter';
import { OnOff } from 'matterbridge/matter/clusters';
import { log, setupTest } from 'matterbridge/test-utils/vitest';
import { addDevice, aggregator, createServerNode, createTestEnvironment, server, startServerNode, stopServerNode } from 'matterbridge/test-utils/vitest/matter';

import { type DeviceConnection, TuyaAccessory } from '../../src/accessory/tuyaAccessory.js';
import { getDeviceFeatures } from '../../src/features.js';
import { connectionOf, createDeviceConfig, createFakeClient, entryOf, type FakeClient, stripFile } from '../fakeTuya.js';

const online = { fabric: 1 } as unknown as ActionContext;
const vendorId = 0xfff1;

/**
 * Write an attribute the way a controller does: the value lands, then the change is announced with a fabric
 *
 * @param {MatterbridgeEndpoint | undefined} endpoint The endpoint.
 * @param {string} cluster The cluster name.
 * @param {string} attribute The attribute name.
 * @param {unknown} value The value to write.
 * @returns {Promise<void>} Resolves when the change is announced.
 */
async function writeAsController(endpoint: MatterbridgeEndpoint | undefined, cluster: string, attribute: string, value: unknown): Promise<void> {
  if (endpoint === undefined) throw new Error('The endpoint is missing');
  const previous: unknown = endpoint.getAttribute(cluster, attribute);
  await endpoint.setAttribute(cluster, attribute, value as never);
  const events = endpoint.eventsOf(cluster.charAt(0).toLowerCase() + cluster.slice(1)) as Record<string, { emit: (...parameters: unknown[]) => void } | undefined>;
  events[`${attribute}$Changed`]?.emit(value, previous, online);
}

await setupTest('FactoryReset', false);

describe('a device when the Matter node is reset to factory defaults', () => {
  let client: FakeClient;
  let accessory: TuyaAccessory;

  beforeAll(async () => {
    await createTestEnvironment();
    await createServerNode(6303);
    await startServerNode();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await accessory.dispose();
    await stopServerNode();
    vi.restoreAllMocks();
  });

  test('should take the writes of a controller before the reset', async () => {
    client = createFakeClient({ device: { outlet1: true, outlet2: false } });
    const config = createDeviceConfig(stripFile, { name: 'Strip', hiddenFeatures: ['device.outlet3', 'device.outlet4', 'device.outlet5'] });
    accessory = new TuyaAccessory({
      config,
      entry: entryOf(stripFile),
      features: getDeviceFeatures(entryOf(stripFile)),
      productName: 'Strip',
      createConnection: (): DeviceConnection => connectionOf(client),
      log,
      vendorId,
    });
    for (const endpoint of accessory.endpoints) expect(await addDevice(aggregator, endpoint)).toBe(true);
    await accessory.start();
    await writeAsController(accessory.endpoint, 'OnOff', 'onOff', false);
    await accessory.refresh();
    expect(client.writeControls).toHaveBeenCalledExactlyOnceWith({ device: { outlet1: false } });
  });

  test('should subscribe again once the node is back, and write the state of the device again', async () => {
    client.values = { device: { outlet1: true, outlet2: true } };
    const info = vi.spyOn(log, 'info');
    const isOnlineAtRead: boolean[] = [];
    client.readControls.mockImplementation(async () => {
      isOnlineAtRead.push(server.lifecycle.isOnline);
      return client.values;
    });
    // A poll and a push while the node is offline for the reset write nothing, and wait for the node instead.
    const pollDuringReset = new Promise<boolean>((resolve) => {
      server.lifecycle.offline.once(() => {
        client.push({ device: { outlet2: true } });
        resolve(accessory.refresh());
      });
    });
    await server.erase();
    expect(await pollDuringReset).toBe(false);
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith('"Strip" is subscribed again after the Matter node was reset'), { timeout: 5000 });
    await vi.waitFor(() => expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true), { timeout: 5000 });
    await vi.waitFor(() => expect(accessory.sideEndpoints.get('device.outlet2')?.getAttribute(OnOff, 'onOff')).toBe(true), { timeout: 5000 });
    // Every read once the node is online.
    expect(isOnlineAtRead.every((isOnline) => isOnline)).toBe(true);
  });

  test('should take the writes of a controller to each endpoint after the reset, once', async () => {
    await writeAsController(accessory.endpoint, 'OnOff', 'onOff', false);
    await writeAsController(accessory.sideEndpoints.get('device.outlet2'), 'OnOff', 'onOff', false);
    await accessory.refresh();
    expect(client.writeControls).toHaveBeenNthCalledWith(1, { device: { outlet1: false } });
    expect(client.writeControls).toHaveBeenNthCalledWith(2, { device: { outlet2: false } });
    // Each write was taken once: the reset left no subscription behind twice.
    expect(client.writeControls).toHaveBeenCalledTimes(2);
  });

  test('should leave the reachability to the read once the node is back, when a read fails while the node goes offline', async () => {
    const warn = vi.spyOn(log, 'warn');
    // A first failure while the node is online, which is not enough to call the device unreachable.
    client.readControls.mockRejectedValueOnce(new Error('no answer'));
    expect(await accessory.refresh()).toBe(false);
    expect(accessory.getStatus().isReachable).toBe(true);
    // The second fails as the node goes offline for a reset: nothing is written to the endpoints then.
    client.readControls.mockImplementationOnce(async () => new Promise((_resolve, reject) => server.lifecycle.offline.once(() => reject(new Error('no answer')))));
    const read = accessory.refresh();
    await vi.waitFor(() => expect(client.readControls).toHaveBeenCalledTimes(2));
    await server.erase();
    expect(await read).toBe(false);
    expect(warn).toHaveBeenCalledWith('"Strip" is unreachable: no answer');
    // Once the node is online, the device is read again, and answers.
    await vi.waitFor(() => expect(accessory.getStatus()).toMatchObject({ isReachable: true, lastError: undefined }), { timeout: 5000 });
  });
});
