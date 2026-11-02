/**
 * @file vitest/accessory/light.test.ts
 * @description This file contains the tests for the lights of a Tuya device and their Matter endpoints.
 * @author Calvin Che
 */

/**
 * WARNING!!!
 * The tests in this unit are supposed to run sequentially because they depend on the Matter state.
 */

import type { MatterbridgeEndpoint } from 'matterbridge';
import { colorTemperatureLight, dimmableLight, extendedColorLight, onOffLight } from 'matterbridge';
import type { ActionContext } from 'matterbridge/matter';
import { ColorControl, LevelControl, OnOff } from 'matterbridge/matter/clusters';
import { log, setupTest } from 'matterbridge/test-utils/vitest';
import { addDevice, aggregator, createServerNode, createTestEnvironment, startServerNode, stopServerNode } from 'matterbridge/test-utils/vitest/matter';
import { TuyaError } from 'open-tuya';

import { type DeviceConnection, TuyaAccessory } from '../../src/accessory/tuyaAccessory.js';
import { type DeviceFeatures, getDeviceFeatures } from '../../src/features.js';
import { colorBulbFile, connectionOf, createDeviceConfig, createFakeClient, dualDimmerFile, entryOf, type FakeClient, pathLightsFile, whiteBulbFile } from '../fakeTuya.js';

const online = { fabric: 1 } as unknown as ActionContext;
const vendorId = 0xfff1;

/**
 * Write attributes the way a controller does: the values land, then each change is announced with a fabric
 *
 * @param {MatterbridgeEndpoint | undefined} endpoint The endpoint.
 * @param {string} cluster The cluster name.
 * @param {Record<string, unknown>} attributes The attributes to write, in order.
 * @returns {Promise<void>} Resolves when every change is announced.
 */
async function writeAsController(endpoint: MatterbridgeEndpoint | undefined, cluster: string, attributes: Record<string, unknown>): Promise<void> {
  if (endpoint === undefined) throw new Error('The endpoint is missing');
  for (const [attribute, value] of Object.entries(attributes)) {
    const previous: unknown = endpoint.getAttribute(cluster, attribute);
    await endpoint.setAttribute(cluster, attribute, value as never);
    const events = endpoint.eventsOf(cluster.charAt(0).toLowerCase() + cluster.slice(1)) as Record<string, { emit: (...parameters: unknown[]) => void } | undefined>;
    events[`${attribute}$Changed`]?.emit(value, previous, online);
  }
}

/**
 * Build a light and add its endpoints to the test aggregator
 *
 * @param {string} file The tuya-local file of its catalog entry.
 * @param {FakeClient} client The client of the device.
 * @param {string} deviceId The device ID.
 * @param {DeviceFeatures} [features] What it can show. Defaults to what its catalog entry gives.
 * @returns {Promise<TuyaAccessory>} The started accessory.
 */
async function startLight(file: string, client: FakeClient, deviceId: string, features?: DeviceFeatures): Promise<TuyaAccessory> {
  const accessory = new TuyaAccessory({
    config: createDeviceConfig(file, { deviceId, name: 'Lamp' }),
    entry: entryOf(file),
    features: features ?? getDeviceFeatures(entryOf(file)),
    productName: 'Bulb',
    createConnection: (): DeviceConnection => connectionOf(client),
    log,
    vendorId,
  });
  for (const endpoint of accessory.endpoints) expect(await addDevice(aggregator, endpoint)).toBe(true);
  expect(await accessory.start()).toBe(true);
  return accessory;
}

await setupTest('Light', false);

describe('lights', () => {
  beforeAll(async () => {
    await createTestEnvironment();
    await createServerNode(6304);
    await startServerNode();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await stopServerNode();
    vi.restoreAllMocks();
  });

  describe('a bulb of a colour and a white', () => {
    let client: FakeClient;
    let accessory: TuyaAccessory;

    test('should be an extended colour light that shows the white the device reports', async () => {
      client = createFakeClient({ light: { on: true, colorMode: 'color_temp', brightness: 505, colorTemperatureInK: 4000, hue: 120, saturation: 1000, colorBrightness: 1000 } });
      accessory = await startLight(colorBulbFile, client, 'bf0000000000000011aa');
      const { endpoint } = accessory;
      expect(endpoint.deviceTypes.has(extendedColorLight.code)).toBe(true);
      expect(endpoint.getAttribute(OnOff, 'onOff')).toBe(true);
      expect(endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(128);
      expect(endpoint.getAttribute(ColorControl, 'colorTemperatureMireds')).toBe(250);
      expect(endpoint.getAttribute(ColorControl, 'colorTempPhysicalMinMireds')).toBe(154);
      expect(endpoint.getAttribute(ColorControl, 'colorTempPhysicalMaxMireds')).toBe(370);
      expect(endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.ColorTemperatureMireds);
      expect(endpoint.getAttribute(ColorControl, 'currentHue')).toBe(85);
    });

    test('should show the colour the device pushes, with the brightness of the colour as the level', async () => {
      client.push({ light: { colorMode: 'hs', colorBrightness: 0 } });
      const { endpoint } = accessory;
      // A read through the client runs after the push is written, and writes nothing.
      await accessory.readDataPoints();
      expect(endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.CurrentHueAndCurrentSaturation);
      expect(endpoint.getAttribute(ColorControl, 'enhancedColorMode')).toBe(ColorControl.EnhancedColorMode.CurrentHueAndCurrentSaturation);
      expect(endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(1);
      expect(endpoint.getAttribute(ColorControl, 'currentSaturation')).toBe(254);
      expect(endpoint.getAttribute(ColorControl, 'currentX')).toBeLessThan(Number(endpoint.getAttribute(ColorControl, 'currentY')));
    });

    test('should write the on/off and the level an app sends together as one write', async () => {
      await writeAsController(accessory.endpoint, 'OnOff', { onOff: false });
      await writeAsController(accessory.endpoint, 'LevelControl', { currentLevel: 254 });
      await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledTimes(1));
      expect(client.writeControls).toHaveBeenCalledWith({ light: { on: false, colorBrightness: 1000 } });
      await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('"Lamp" set light on false, colorBrightness 1000'));
    });

    test('should turn the light to a colour a controller sets', async () => {
      await writeAsController(accessory.endpoint, 'ColorControl', { colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation, currentHue: 127, currentSaturation: 127 });
      await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light: { colorMode: 'hs', hue: 180, saturation: 500, colorBrightness: 1000 } }));
      expect(client.writeControls).toHaveBeenCalledTimes(1);
      // Matter shows the colour written once the write is done: a read through the client waits for it, and writes nothing.
      await accessory.readDataPoints();
      expect(accessory.endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.CurrentHueAndCurrentSaturation);
    });

    test('should turn the light to its white when a controller changes the colour mode alone', async () => {
      // The colour temperature the endpoint holds is the white the device last reported: only the mode changes.
      await writeAsController(accessory.endpoint, 'ColorControl', { colorMode: ColorControl.ColorMode.ColorTemperatureMireds });
      await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light: { colorMode: 'color_temp', colorTemperatureInK: 4000 } }));
      expect(client.writeControls).toHaveBeenCalledTimes(1);
      // A read through the client waits for the write to end, and writes nothing.
      await accessory.readDataPoints();
      expect(accessory.endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.ColorTemperatureMireds);
      expect(accessory.endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(128);
    });

    test('should turn the light to the white of a colour temperature a controller sets', async () => {
      await writeAsController(accessory.endpoint, 'ColorControl', { colorMode: ColorControl.ColorMode.ColorTemperatureMireds, colorTemperatureMireds: 370 });
      await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light: { colorMode: 'color_temp', colorTemperatureInK: 2703 } }));
      await vi.waitFor(() => expect(accessory.endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.ColorTemperatureMireds));
      // The level is the brightness of the white now.
      expect(accessory.endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(128);
    });

    test('should ignore what the plugin writes itself, and a push of another component', async () => {
      await accessory.endpoint.setAttribute(LevelControl, 'currentLevel', 10);
      client.push({ device: { other: 1 } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      await accessory.refresh();
      expect(client.writeControls).not.toHaveBeenCalled();
    });

    test('should show what the device last reported when it neither takes a write nor answers the read after it', async () => {
      client.writeControls.mockRejectedValueOnce(new TuyaError('REQUEST_TIMED_OUT', 'no answer'));
      client.readControls.mockRejectedValueOnce(new TuyaError('REQUEST_TIMED_OUT', 'no answer'));
      await writeAsController(accessory.endpoint, 'LevelControl', { currentLevel: 254 });
      await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith('"Lamp" did not take light brightness 1000: no answer'));
      await vi.waitFor(() => expect(accessory.endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(128));
    });

    test('should keep what Matter shows for a value that is not a number, and write nothing for a level of none', async () => {
      const mireds: unknown = accessory.endpoint.getAttribute(ColorControl, 'colorTemperatureMireds');
      client.push({ light: { brightness: 'high', colorTemperatureInK: 'warm', hue: 'red' } });
      // A read through the client runs after the push is written, and writes nothing.
      await accessory.readDataPoints();
      expect(accessory.endpoint.getAttribute(ColorControl, 'colorTemperatureMireds')).toBe(mireds);
      await writeAsController(accessory.endpoint, 'LevelControl', { currentLevel: null });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client.writeControls).not.toHaveBeenCalled();
    });

    test('should write nothing once disposed', async () => {
      await writeAsController(accessory.endpoint, 'OnOff', { onOff: true });
      await accessory.dispose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(client.writeControls).not.toHaveBeenCalled();
    });
  });

  test('should put a write back with no route and nothing reported yet', async () => {
    const accessory = new TuyaAccessory({
      config: createDeviceConfig(whiteBulbFile, { deviceId: 'bf0000000000000016aa', name: 'Unrouted' }),
      entry: entryOf(whiteBulbFile),
      features: getDeviceFeatures(entryOf(whiteBulbFile)),
      productName: 'Bulb',
      createConnection: (): undefined => undefined,
      log,
      vendorId,
    });
    for (const endpoint of accessory.endpoints) expect(await addDevice(aggregator, endpoint)).toBe(true);
    expect(await accessory.start()).toBe(false);
    await writeAsController(accessory.endpoint, 'OnOff', { onOff: true });
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^"Unrouted" did not take light on true: /)));
    await vi.waitFor(() => expect(accessory.endpoint.getAttribute(OnOff, 'onOff')).toBe(false));
    // What the level was before the request is not known: it stays as the controller asked.
    await writeAsController(accessory.endpoint, 'LevelControl', { currentLevel: 200 });
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^"Unrouted" did not take light brightness \d+: /)));
    await expect(accessory.readDataPoints()).rejects.toThrow();
    expect(accessory.endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(200);
    await accessory.dispose();
  });

  test('should make a white bulb a colour temperature light', async () => {
    const client = createFakeClient({ light: { on: false, brightness: 10, colorTemperatureInK: 6500 } });
    const accessory = await startLight(whiteBulbFile, client, 'bf0000000000000012aa');
    const { endpoint } = accessory;
    expect(endpoint.deviceTypes.has(colorTemperatureLight.code)).toBe(true);
    expect(endpoint.getAttribute(ColorControl, 'colorTemperatureMireds')).toBe(154);
    expect(endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(1);
    await writeAsController(endpoint, 'ColorControl', { colorTemperatureMireds: 250 });
    await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light: { colorTemperatureInK: 4000 } }));
    await accessory.dispose();
  });

  test('should turn path lights of no colour temperature to their white', async () => {
    const client = createFakeClient({ light: { on: true, colorMode: 'hs', brightness: 1000, hue: 0, saturation: 1000, colorBrightness: 1000 } });
    const accessory = await startLight(pathLightsFile, client, 'bf0000000000000013aa');
    expect(accessory.endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.CurrentHueAndCurrentSaturation);
    // A white of no colour temperature shows as a colour temperature, whatever the endpoint holds for it, not as the stale colour.
    client.push({ light: { colorMode: 'white' } });
    await accessory.readDataPoints();
    expect(accessory.endpoint.getAttribute(ColorControl, 'colorMode')).toBe(ColorControl.ColorMode.ColorTemperatureMireds);
    expect(accessory.endpoint.getAttribute(ColorControl, 'enhancedColorMode')).toBe(ColorControl.EnhancedColorMode.ColorTemperatureMireds);
    await writeAsController(accessory.endpoint, 'ColorControl', { colorMode: ColorControl.ColorMode.ColorTemperatureMireds, colorTemperatureMireds: 300 });
    await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light: { colorMode: 'white' } }));
    await accessory.dispose();
  });

  test('should give each dimmer of a dual dimmer a dimmable light, and write to its own channel', async () => {
    const client = createFakeClient({ light1: { on: true, brightness: 255 }, light2: { on: false, brightness: 'unknown' } });
    const accessory = await startLight(dualDimmerFile, client, 'bf0000000000000014aa');
    const second = accessory.sideEndpoints.get('light2.on');
    expect(accessory.endpoint.deviceTypes.has(dimmableLight.code)).toBe(true);
    expect(second?.deviceTypes.has(dimmableLight.code)).toBe(true);
    expect(accessory.endpoint.getAttribute(LevelControl, 'currentLevel')).toBe(254);
    await writeAsController(second, 'OnOff', { onOff: true });
    await vi.waitFor(() => expect(client.writeControls).toHaveBeenCalledWith({ light2: { on: true } }));
    await accessory.dispose();
  });

  test('should make a light with only a switch an on/off light, and write nothing it cannot set', async () => {
    const client = createFakeClient({ light: { on: true } });
    const features: DeviceFeatures = {
      lights: [
        { id: 'light.on', component: 'light', control: 'on', label: 'Light' },
        {
          id: 'light2.on',
          component: 'light2',
          control: 'on',
          label: 'Light 2',
          color: { hue: { control: 'hue', min: 0, max: 360 }, saturation: { control: 'saturation', min: 0, max: 1000 } },
        },
      ],
      outlets: [],
      settingSwitches: [],
      sensors: [],
    };
    const accessory = await startLight(whiteBulbFile, client, 'bf0000000000000015aa', features);
    expect(accessory.endpoint.deviceTypes.has(onOffLight.code)).toBe(true);
    expect(accessory.endpoint.hasClusterServer(LevelControl)).toBe(false);
    // A light of a colour with no brightness has a level that sets nothing.
    await writeAsController(accessory.sideEndpoints.get('light2.on'), 'LevelControl', { currentLevel: 100 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await accessory.refresh();
    expect(client.writeControls).not.toHaveBeenCalled();
    await accessory.dispose();
  });
});
