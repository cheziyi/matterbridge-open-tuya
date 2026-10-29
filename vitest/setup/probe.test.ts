/**
 * @file vitest/setup/probe.test.ts
 * @description This file contains the tests for the checks the guided setup makes of a device of the account.
 * @author Calvin Che
 */

import { TuyaError } from 'open-tuya';

import { findGateway, getDeviceSupport, isGateway, probeDevice } from '../../src/setup/probe.js';
import { createCloudDevice, createFakeRoute, lightFile, plugFile } from '../fakeTuya.js';

const plugDataPoints = { '1': true, '2': 0, '4': 53, '5': 123, '6': 2305 };

describe('probe', () => {
  const gateway = createCloudDevice(plugFile, { deviceId: 'bf00000000000000gw01', productKey: 'gatewayproduct00', localKey: 'gatewaykey000001', category: 'wg2' });
  const behind = createCloudDevice(plugFile, { deviceId: 'a4c13800000000000001', nodeId: 'a4c1380000000001', localKey: 'gatewaykey000001' });
  const plug = createCloudDevice(plugFile);

  test('should tell a gateway by the devices behind it, and find the gateway of a device', () => {
    const devices = [gateway, behind, plug];
    expect(isGateway(gateway, devices)).toBe(true);
    expect(isGateway(plug, devices)).toBe(false);
    expect(isGateway(behind, devices)).toBe(false);
    expect(isGateway({ ...gateway, localKey: undefined }, devices)).toBe(false);
    expect(findGateway(behind, devices)).toBe(gateway);
    expect(findGateway(plug, devices)).toBeUndefined();
    expect(findGateway({ ...behind, localKey: undefined }, devices)).toBeUndefined();
  });

  test('should tell from its product key whether the plugin controls a device', () => {
    const devices = [gateway, behind, plug];
    expect(getDeviceSupport(plug, devices)).toBe('supported');
    expect(getDeviceSupport(gateway, devices)).toBe('gateway');
    expect(getDeviceSupport(createCloudDevice(lightFile), devices)).toBe('otherKind');
    expect(getDeviceSupport({ ...plug, productKey: 'unknownproduct00' }, devices)).toBe('unknownProduct');
  });

  test('should read a device on the LAN, and give its entry, its features and its controls', async () => {
    const lan = createFakeRoute(plugDataPoints);
    const cloud = createFakeRoute();
    const result = await probeDevice(plug, [lan, cloud], lan);
    expect(result).toMatchObject({ status: 'ready', deviceId: plug.deviceId, catalogFile: plugFile, productName: 'SP111-A', route: 'lan' });
    expect(result.features?.outlets).toHaveLength(1);
    expect(result.values).toMatchObject({ device: { on: true, powerInW: 12.3, voltageInV: 230.5 } });
    expect(cloud.readDataPoints).not.toHaveBeenCalled();
    expect(lan.close).toHaveBeenCalled();
    expect(cloud.close).toHaveBeenCalled();
  });

  test('should read a device through the cloud when the LAN fails', async () => {
    const lan = createFakeRoute();
    lan.readDataPoints.mockRejectedValue(new TuyaError('CONNECTION_FAILED', 'no answer'));
    lan.connected = false;
    const result = await probeDevice(plug, [lan, createFakeRoute(plugDataPoints)], lan);
    expect(result).toMatchObject({ status: 'ready', route: 'cloud' });
    expect((await probeDevice(plug, [createFakeRoute(plugDataPoints)])).route).toBe('cloud');
  });

  test('should say what stands in the way when no route answers', async () => {
    const failing = (error: unknown): ReturnType<typeof createFakeRoute> => {
      const route = createFakeRoute();
      route.readDataPoints.mockRejectedValue(error);
      return route;
    };
    expect(await probeDevice(plug, [failing(new TuyaError('SESSION_EXPIRED', 'sign in'))])).toMatchObject({ status: 'signInRequired' });
    for (const code of ['CONNECTION_FAILED', 'CONNECTION_LOST', 'REQUEST_TIMED_OUT'] as const) {
      expect(await probeDevice(plug, [failing(new TuyaError(code, 'no answer'))])).toMatchObject({ status: 'unreachable' });
    }
    const failed = await probeDevice(plug, [failing(new Error('boom'))]);
    expect(failed).toEqual({ status: 'failed', deviceId: plug.deviceId, message: 'boom' });
  });

  test('should say why the plugin does not control a device it reads', async () => {
    const unknown = await probeDevice({ ...plug, productKey: 'unknownproduct00' }, [createFakeRoute({ '999': 'x' })]);
    expect(unknown).toMatchObject({ status: 'unsupported', message: 'The device catalog of open-tuya does not know this device yet' });
    const light = await probeDevice(createCloudDevice(lightFile), [createFakeRoute({})]);
    expect(light.status).toBe('unsupported');
    expect(light.message).toMatch(/^It is a kind of device the plugin does not control yet: /);
    const feeder = await probeDevice(createCloudDevice('advwin_6l_petfeeder.yaml'), [createFakeRoute({})]);
    expect(feeder).toMatchObject({ status: 'unsupported', message: 'It has no switch and no sensor the plugin shows in Matter' });
  });
});
