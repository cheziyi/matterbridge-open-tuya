/**
 * @file vitest/accessory/tuyaAccessory.test.ts
 * @description This file contains the tests for the bridge between a Tuya device and its Matter endpoints.
 * @author Calvin Che
 */

/**
 * WARNING!!!
 * The tests in this unit are supposed to run sequentially because they depend on the Matter state.
 */

import type { MatterbridgeEndpoint } from 'matterbridge';
import type { ActionContext } from 'matterbridge/matter';
import {
  BooleanState,
  BridgedDeviceBasicInformation,
  ElectricalEnergyMeasurement,
  ElectricalPowerMeasurement,
  IlluminanceMeasurement,
  OccupancySensing,
  OnOff,
  PowerSource,
  RelativeHumidityMeasurement,
  TemperatureMeasurement,
} from 'matterbridge/matter/clusters';
import { log, setupTest } from 'matterbridge/test-utils/vitest';
import { addDevice, aggregator, createServerNode, createTestEnvironment, startServerNode, stopServerNode } from 'matterbridge/test-utils/vitest/matter';
import { TuyaError } from 'open-tuya';

import { applyValues } from '../../src/accessory/matterState.js';
import { type DeviceConnection, noRouteMessage, TuyaAccessory } from '../../src/accessory/tuyaAccessory.js';
import { ignoreFailure } from '../../src/errors.js';
import type { DeviceFeatures } from '../../src/features.js';
import { getDeviceFeatures } from '../../src/features.js';
import { EndpointIds } from '../../src/platform/endpointIds.js';
import { connectionOf, createDeviceConfig, createFakeClient, entryOf, type FakeClient, leakFile, multiSensorFile, plugFile, stripFile } from '../fakeTuya.js';

const online = { fabric: 1 } as unknown as ActionContext;
const vendorId = 0xfff1;

/**
 * Add every endpoint of an accessory to the test aggregator
 *
 * @param {TuyaAccessory} accessory The accessory.
 * @returns {Promise<void>} Resolves when the endpoints are active.
 */
async function addAccessory(accessory: TuyaAccessory): Promise<void> {
  for (const endpoint of accessory.endpoints) expect(await addDevice(aggregator, endpoint)).toBe(true);
}

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

/**
 * Get the label an endpoint is created with, which the Matter apps show as its name
 *
 * @param {MatterbridgeEndpoint | undefined} endpoint The endpoint.
 * @returns {unknown} The label, or undefined without an endpoint.
 */
function labelOf(endpoint: MatterbridgeEndpoint | undefined): unknown {
  return endpoint?.getClusterServerOptions(BridgedDeviceBasicInformation)?.nodeLabel;
}

/**
 * Wait until the queued reads and writes of an accessory are done
 *
 * @param {TuyaAccessory} accessory The accessory.
 * @returns {Promise<void>} Resolves after the pending work.
 */
async function settle(accessory: TuyaAccessory): Promise<void> {
  // A refresh runs after everything queued before it.
  await accessory.refresh();
}

await setupTest('TuyaAccessory', false);

describe('TuyaAccessory', () => {
  beforeAll(async () => {
    await createTestEnvironment();
    await createServerNode(6301);
    await startServerNode();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await stopServerNode();
    vi.restoreAllMocks();
  });

  describe('a plug with a meter', () => {
    let client: FakeClient;
    let accessory: TuyaAccessory;
    let isOnLan = true;

    test('should create an outlet that is an electrical sensor, named by its device ID', async () => {
      client = createFakeClient({ device: { on: true, powerInW: 12.3, voltageInV: 230.5, currentInMilliamps: 53 } });
      const config = createDeviceConfig(plugFile, { deviceId: 'bf0000000000000001aa' });
      accessory = new TuyaAccessory({
        config,
        entry: entryOf(plugFile),
        features: getDeviceFeatures(entryOf(plugFile)),
        productName: 'TopGreener TGWF115PRM',
        createConnection: (): DeviceConnection => connectionOf(client, { isOnLan: () => isOnLan }),
        log,
        vendorId,
      });
      expect(accessory.endpoints).toHaveLength(1);
      expect(accessory.endpoint.deviceName).toBe('Tuya bf0000000000000001aa');
      expect(accessory.endpoint.serialNumber).toBe('bf0000000000000001aa');
      expect(labelOf(accessory.endpoint)).toBe('Desk');
      expect(accessory.deviceConfig).toBe(config);
      expect(accessory.getStatus()).toEqual({
        isReachable: false,
        isConnecting: true,
        route: undefined,
        hasLan: false,
        lastError: undefined,
        lastErrorCode: undefined,
        values: undefined,
      });
      await addAccessory(accessory);
      expect(accessory.endpoint.hasClusterServer(ElectricalPowerMeasurement)).toBe(true);
      // The plug measures no energy, so it has no energy measurement.
      expect(accessory.endpoint.hasClusterServer(ElectricalEnergyMeasurement)).toBe(false);
    });

    test('should write what the device reports to Matter when it starts, and say it answers on the LAN', async () => {
      expect(await accessory.start()).toBe(true);
      const { endpoint } = accessory;
      expect(endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
      expect(endpoint.getAttribute(ElectricalPowerMeasurement, 'activePower')).toBe(12_300);
      expect(endpoint.getAttribute(ElectricalPowerMeasurement, 'voltage')).toBe(230_500);
      expect(endpoint.getAttribute(ElectricalPowerMeasurement, 'activeCurrent')).toBe(53);
      expect(endpoint.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(true);
      expect(accessory.getStatus()).toMatchObject({ isReachable: true, isConnecting: false, route: 'lan', hasLan: true });
      expect(log.info).toHaveBeenCalledWith('"Desk" answers on the LAN');
    });

    test('should send the on/off a controller writes to the device', async () => {
      await writeAsController(accessory.endpoint, 'OnOff', 'onOff', false);
      await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('"Desk" set power off'));
      expect(client.writeControls).toHaveBeenCalledWith({ device: { on: false } });
      expect(log.info).toHaveBeenCalledWith('"Desk" received power off');
      // What was written counts as reported, the meter as it was.
      expect(accessory.getStatus().values).toEqual({ device: { on: false, powerInW: 12.3, voltageInV: 230.5, currentInMilliamps: 53 } });
    });

    test('should put back what the device holds when it does not take a write', async () => {
      client.values = { device: { on: true } };
      client.writeControls.mockRejectedValueOnce(new TuyaError('REQUEST_TIMED_OUT', 'no answer'));
      await writeAsController(accessory.endpoint, 'OnOff', 'onOff', false);
      await settle(accessory);
      expect(log.error).toHaveBeenCalledWith('"Desk" did not take power off: no answer');
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
    });

    test('should ignore an on/off the plugin writes itself', async () => {
      await accessory.endpoint.setAttribute(OnOff, 'onOff', false);
      await settle(accessory);
      expect(client.writeControls).not.toHaveBeenCalled();
    });

    test('should write a push of the device to Matter, and keep what the push leaves out', async () => {
      client.push({ device: { powerInW: 5 } });
      await vi.waitFor(() => expect(accessory.endpoint.getAttribute(ElectricalPowerMeasurement, 'activePower')).toBe(5000));
      client.push({ device: { on: false } });
      await vi.waitFor(() => expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(false));
      // The status merges every push into what was reported before.
      expect(accessory.getStatus().values).toMatchObject({ device: { on: false, powerInW: 5 } });
    });

    test('should name the cloud as the route once the LAN does not answer', async () => {
      client.readControls.mockReset();
      client.readControls.mockImplementation(async () => Promise.resolve(client.values));
      isOnLan = false;
      await accessory.refresh();
      expect(accessory.getStatus().route).toBe('cloud');
      expect(log.info).toHaveBeenCalledWith('"Desk" answers through the Tuya cloud');
    });

    test('should report the device as unreachable after two reads in a row fail, and reachable once it answers', async () => {
      client.readControls.mockRejectedValueOnce(new TuyaError('CONNECTION_FAILED', 'gone')).mockRejectedValueOnce(new TuyaError('CONNECTION_FAILED', 'gone'));
      expect(await accessory.refresh()).toBe(false);
      expect(accessory.endpoint.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(true);
      expect(await accessory.refresh()).toBe(false);
      expect(accessory.endpoint.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(false);
      expect(log.warn).toHaveBeenCalledWith('"Desk" is unreachable: gone');
      expect(accessory.getStatus()).toMatchObject({ isReachable: false, route: undefined, lastError: 'gone', lastErrorCode: 'CONNECTION_FAILED' });
      expect(await accessory.refresh()).toBe(true);
      expect(accessory.endpoint.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(true);
      expect(accessory.getStatus().lastError).toBeUndefined();
    });

    test('should take a new name as its label, and log it once', async () => {
      await accessory.updateConfig(createDeviceConfig(plugFile, { name: 'Lamp', isComposed: false }));
      expect(accessory.name).toBe('Lamp');
      expect(log.info).toHaveBeenCalledWith('"Desk" is now named "Lamp"');
      expect(accessory.endpoint.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Lamp');
      // The exposure stays as the device was built.
      expect(accessory.deviceConfig.isComposed).toBe(true);
      vi.mocked(log.info).mockClear();
      await accessory.updateConfig(createDeviceConfig(plugFile, { name: 'Lamp' }));
      expect(log.info).not.toHaveBeenCalledWith(expect.stringContaining('is now named'));
    });

    test('should switch to a new client, closing the one before, even when it does not close cleanly', async () => {
      const previous = client;
      previous.close.mockRejectedValueOnce(new Error('stuck'));
      client = createFakeClient({ device: { on: true } });
      expect(await accessory.updateConnection((): DeviceConnection => connectionOf(client))).toBe(true);
      expect(previous.close).toHaveBeenCalled();
      expect(log.debug).toHaveBeenCalledWith('"Lamp" connection did not close cleanly: stuck');
      expect(client.readControls).toHaveBeenCalled();
      // A push of the client before reaches nothing.
      previous.push({ device: { on: false } });
      await settle(accessory);
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
    });

    test('should be unreachable at once with no route, and refuse a write', async () => {
      expect(await accessory.updateConnection((): undefined => undefined)).toBe(false);
      expect(accessory.endpoint.getAttribute(BridgedDeviceBasicInformation, 'reachable')).toBe(false);
      expect(accessory.getStatus()).toMatchObject({ hasLan: false, lastError: noRouteMessage });
      await writeAsController(accessory.endpoint, 'OnOff', 'onOff', false);
      await settle(accessory);
      expect(log.error).toHaveBeenCalledWith(`"Lamp" did not take power off: ${noRouteMessage}`);
      // Logged unreachable once, not at every poll.
      vi.mocked(log.warn).mockClear();
      await accessory.refresh();
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('should read and write nothing once disposed', async () => {
      await accessory.dispose();
      expect(await accessory.refresh()).toBe(false);
      await writeAsController(accessory.endpoint, 'OnOff', 'onOff', true);
      expect(log.info).not.toHaveBeenCalledWith('"Lamp" received power on');
    });

    test('should log a state Matter does not take, and keep running', async () => {
      const failing = createFakeClient({ device: { on: true } });
      const device = new TuyaAccessory({
        config: createDeviceConfig(plugFile, { deviceId: 'bf0000000000000009aa', name: 'Broken' }),
        entry: entryOf(plugFile),
        features: getDeviceFeatures(entryOf(plugFile)),
        productName: 'Plug',
        createConnection: (): DeviceConnection => connectionOf(failing),
        log,
        vendorId,
      });
      await addAccessory(device);
      vi.spyOn(device.endpoint, 'updateAttribute').mockRejectedValueOnce(new Error('refused'));
      expect(await device.start()).toBe(true);
      expect(log.warn).toHaveBeenCalledWith('"Broken" state could not be written to Matter: refused');
      failing.readControls.mockRejectedValue(new TuyaError('CONNECTION_FAILED', 'gone'));
      await device.refresh();
      vi.spyOn(device.endpoint, 'updateAttribute').mockRejectedValueOnce(new Error('refused'));
      await device.refresh();
      expect(log.debug).toHaveBeenCalledWith('"Broken" reachability could not be written to Matter: refused');
      await device.dispose();
    });
  });

  describe('a power strip whose outlets are devices of their own', () => {
    let client: FakeClient;
    let accessory: TuyaAccessory;

    test('should create a device for each outlet shown and for the child lock added', async () => {
      client = createFakeClient({ device: { outlet1: true, outlet2: false, outlet3: true, outlet4: false, outlet5: true, childLock: true } });
      accessory = new TuyaAccessory({
        config: createDeviceConfig(stripFile, {
          deviceId: 'bf0000000000000002aa',
          name: 'Strip',
          isComposed: false,
          hiddenFeatures: ['device.outlet3', 'device.outlet4', 'device.outlet5'],
          addedFeatures: ['device.childLock'],
        }),
        entry: entryOf(stripFile),
        features: getDeviceFeatures(entryOf(stripFile)),
        productName: 'Mirabella Genio Smart 2Gnd',
        createConnection: (): DeviceConnection => connectionOf(client),
        log,
        vendorId,
        ids: new EndpointIds(),
      });
      expect(accessory.endpoints).toHaveLength(3);
      const outlet2 = accessory.sideEndpoints.get('device.outlet2');
      const lock = accessory.sideEndpoints.get('device.childLock');
      expect(outlet2?.serialNumber).toBe('bf0000000000000002aa-2');
      expect(outlet2?.deviceName).toBe('Tuya bf0000000000000002aa Outlet 2');
      expect(labelOf(outlet2)).toBe('Strip Outlet 2');
      expect(lock?.serialNumber).toBe('bf0000000000000002aa-6');
      expect(labelOf(lock)).toBe('Strip Child Lock');
      await addAccessory(accessory);
      await accessory.start();
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
      expect(outlet2?.getAttribute(OnOff, 'onOff')).toBe(false);
      expect(lock?.getAttribute(OnOff, 'onOff')).toBe(true);
    });

    test('should send the on/off of each outlet and the child lock to its own control', async () => {
      await writeAsController(accessory.sideEndpoints.get('device.outlet2'), 'OnOff', 'onOff', true);
      await writeAsController(accessory.sideEndpoints.get('device.childLock'), 'OnOff', 'onOff', false);
      await settle(accessory);
      expect(client.writeControls).toHaveBeenNthCalledWith(1, { device: { outlet2: true } });
      expect(client.writeControls).toHaveBeenNthCalledWith(2, { device: { childLock: false } });
      expect(log.info).toHaveBeenCalledWith('"Strip" received child lock off');
    });

    test('should write a new name to the label of every device of its own', async () => {
      await accessory.updateConfig(createDeviceConfig(stripFile, { name: 'Bench', isComposed: false }));
      expect(accessory.sideEndpoints.get('device.outlet2')?.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Bench Outlet 2');
      await accessory.dispose();
    });
  });

  describe('a sensor on a battery, as one composed device', () => {
    let client: FakeClient;
    let accessory: TuyaAccessory;

    test('should make the temperature sensor the device, with its other readings as parts', async () => {
      client = createFakeClient({
        device: { temperature: 70.7, temperatureUnit: 'F', humidityInPercent: 45, illuminanceInLux: 1000, occupancy: true, batteryInPercent: 15 },
        indicator: { on: true },
      });
      accessory = new TuyaAccessory({
        config: createDeviceConfig(multiSensorFile, { deviceId: 'bf0000000000000003aa', name: 'Hall', addedFeatures: ['indicator.on'] }),
        entry: entryOf(multiSensorFile),
        features: getDeviceFeatures(entryOf(multiSensorFile)),
        productName: 'Motion sensor',
        createConnection: (): DeviceConnection => connectionOf(client),
        log,
        vendorId,
      });
      expect(accessory.endpoints).toHaveLength(1);
      expect(accessory.endpoint.getChildEndpoints()).toHaveLength(4);
      await addAccessory(accessory);
      await accessory.start();
      expect(accessory.endpoint.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(2150);
      expect(accessory.sideEndpoints.get('device.humidityInPercent')?.getAttribute(RelativeHumidityMeasurement, 'measuredValue')).toBe(4500);
      expect(accessory.sideEndpoints.get('device.illuminanceInLux')?.getAttribute(IlluminanceMeasurement, 'measuredValue')).toBe(30_001);
      expect(accessory.sideEndpoints.get('device.occupancy')?.getAttribute(OccupancySensing, 'occupancy')).toEqual({ occupied: true });
      expect(accessory.sideEndpoints.get('indicator.on')?.getAttribute(OnOff, 'onOff')).toBe(true);
      expect(accessory.endpoint.getAttribute(PowerSource, 'batPercentRemaining')).toBe(30);
      expect(accessory.endpoint.getAttribute(PowerSource, 'batChargeLevel')).toBe(PowerSource.BatChargeLevel.Warning);
    });

    test('should read the temperature in the unit of the catalog without a unit reported, and the battery levels', async () => {
      client.push({ device: { temperature: 21.5, temperatureUnit: 7, batteryInPercent: 5, humidityInPercent: 'wet', illuminanceInLux: 'dark' } });
      await settle(accessory);
      client.values = { device: { temperature: 21.5, batteryInPercent: 80 } };
      await accessory.refresh();
      expect(accessory.endpoint.getAttribute(PowerSource, 'batChargeLevel')).toBe(PowerSource.BatChargeLevel.Ok);
      client.values = { device: { temperature: 'warm', batteryInPercent: 5, occupancy: 'maybe' } };
      await accessory.refresh();
      expect(accessory.endpoint.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(2150);
      expect(accessory.endpoint.getAttribute(PowerSource, 'batChargeLevel')).toBe(PowerSource.BatChargeLevel.Critical);
      expect(accessory.sideEndpoints.get('device.occupancy')?.getAttribute(OccupancySensing, 'occupancy')).toEqual({ occupied: false });
      client.values = { device: { batteryInPercent: 'full', on: 'x' } };
      await accessory.refresh();
      expect(accessory.endpoint.getAttribute(PowerSource, 'batPercentRemaining')).toBe(10);
      await accessory.dispose();
    });
  });

  describe('detectors and a meter of energy', () => {
    test('should show a water leak, an open contact and the energy used', async () => {
      const features: DeviceFeatures = {
        outlets: [{ id: 'device.on', component: 'device', control: 'on', label: 'Power' }],
        settingSwitches: [],
        sensors: [
          { id: 'device.door', kind: 'contact', label: 'Contact', component: 'device', control: 'door' },
          { id: 'device.moisture', kind: 'waterLeak', label: 'Water Leak', component: 'device', control: 'moisture' },
          { id: 'device.temperatureInC', kind: 'temperature', label: 'Temperature', component: 'device', control: 'temperatureInC', unit: 'C' },
        ],
        meter: { energy: { component: 'device', control: 'energyInKwh', unit: 'kWh' }, power: { component: 'device', control: 'powerInKw', unit: 'kW' } },
      };
      const client = createFakeClient({ device: { on: true, door: true, moisture: true, energyInKwh: 1.5, powerInKw: 'x', temperatureInC: 40 } });
      const accessory = new TuyaAccessory({
        config: createDeviceConfig(leakFile, { deviceId: 'bf0000000000000004aa', name: 'Washer' }),
        entry: entryOf(leakFile),
        features,
        productName: 'Washer',
        createConnection: (): DeviceConnection => connectionOf(client),
        log,
        vendorId,
      });
      await addAccessory(accessory);
      await accessory.start();
      expect(accessory.sideEndpoints.get('device.door')?.getAttribute(BooleanState, 'stateValue')).toBe(false);
      expect(accessory.sideEndpoints.get('device.moisture')?.getAttribute(BooleanState, 'stateValue')).toBe(true);
      expect(accessory.endpoint.getAttribute(ElectricalEnergyMeasurement, 'cumulativeEnergyImported')).toMatchObject({ energy: 1_500_000 });
      expect(accessory.sideEndpoints.get('device.temperatureInC')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(4000);
      client.values = { device: { door: 'unknown', energyInKwh: -1 } };
      await accessory.refresh();
      expect(accessory.sideEndpoints.get('device.door')?.getAttribute(BooleanState, 'stateValue')).toBe(true);
      expect(accessory.endpoint.getAttribute(ElectricalEnergyMeasurement, 'cumulativeEnergyImported')).toMatchObject({ energy: 1_500_000 });
      expect(accessory.sideEndpoints.get('device.temperatureInC')?.getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(4000);
      client.values = { device: {} };
      expect(await accessory.refresh()).toBe(true);
      await accessory.dispose();
    });

    test('should refuse a device with nothing to show', () => {
      expect(
        () =>
          new TuyaAccessory({
            config: createDeviceConfig(leakFile),
            entry: entryOf(leakFile),
            features: { outlets: [], settingSwitches: [], sensors: [] },
            productName: 'Nothing',
            createConnection: (): undefined => undefined,
            log,
            vendorId,
          }),
      ).toThrow('The device has neither an outlet nor a sensor to show in Matter');
    });
  });

  describe('a device whose work overlaps', () => {
    test('should drop a push that waits behind a read once the device is disposed', async () => {
      const client = createFakeClient({ device: { on: true } });
      const accessory = new TuyaAccessory({
        config: createDeviceConfig(plugFile, { deviceId: 'bf0000000000000005aa', name: 'Late' }),
        entry: entryOf(plugFile),
        features: getDeviceFeatures(entryOf(plugFile)),
        productName: 'Late',
        createConnection: (): DeviceConnection => connectionOf(client),
        log,
        vendorId,
      });
      await addAccessory(accessory);
      await accessory.start();
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
      // A read the device is slow to answer holds the queue, and a push waits behind it.
      let answer: (values: { device: { on: boolean } }) => void = ignoreFailure;
      client.readControls.mockImplementationOnce(async () => new Promise((resolve) => (answer = resolve)));
      const read = accessory.refresh();
      await vi.waitFor(() => expect(client.readControls).toHaveBeenCalledTimes(2));
      client.push({ device: { on: false } });
      const disposed = accessory.dispose();
      answer({ device: { on: true } });
      // The read began before the dispose, and ends as it does.
      expect(await read).toBe(true);
      await disposed;
      // The push turned the outlet off: dropped, it leaves the read's on.
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
    });

    test('should skip a side unit the accessory has no endpoint for', async () => {
      const client = createFakeClient({ device: { outlet1: true, outlet2: true } });
      const accessory = new TuyaAccessory({
        config: createDeviceConfig(stripFile, { deviceId: 'bf0000000000000006aa', name: 'Sparse', hiddenFeatures: ['device.outlet3', 'device.outlet4', 'device.outlet5'] }),
        entry: entryOf(stripFile),
        features: getDeviceFeatures(entryOf(stripFile)),
        productName: 'Sparse',
        createConnection: (): DeviceConnection => connectionOf(client),
        log,
        vendorId,
      });
      await addAccessory(accessory);
      await accessory.start();
      expect(accessory.sideEndpoints.get('device.outlet2')?.getAttribute(OnOff, 'onOff')).toBe(true);
      // Endpoints that lack the second outlet: the main one is written, and the outlet it lacks is left alone.
      await applyValues({ endpoint: accessory.endpoint, sideEndpoints: new Map() }, accessory.layout, { device: { outlet1: false, outlet2: false } });
      expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(false);
      expect(accessory.sideEndpoints.get('device.outlet2')?.getAttribute(OnOff, 'onOff')).toBe(true);
      await accessory.dispose();
    });
  });
});
