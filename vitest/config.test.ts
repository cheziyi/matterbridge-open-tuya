/**
 * @file vitest/config.test.ts
 * @description This file contains the tests for the plugin configuration model and its validation.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import {
  defaultExposure,
  getUnreadableDevices,
  hasSameConnection,
  hasSameExposure,
  isMember,
  isValidDeviceId,
  normalizeDeviceName,
  normalizeHost,
  normalizePollInterval,
  parseAccountConfig,
  parseDeviceConfig,
  parseDeviceConfigs,
  withExposureOf,
  withoutLocalKey,
} from '../src/config.js';
import { createDeviceConfig, plugFile, stripFile } from './fakeTuya.js';

const session = { endpoint: 'https://apigw.tuyaeu.com', accessToken: 'access', refreshToken: 'refresh', expiresAtInMs: 1_000_000 };

describe('config', () => {
  test('should check the members of a list, device IDs, names and hosts', () => {
    expect(isMember(['a', 'b'], 'a')).toBe(true);
    expect(isMember(['a', 'b'], 'c')).toBe(false);
    expect(isMember(['a', 'b'], 1)).toBe(false);
    expect(isValidDeviceId('bf0000000000000001aa')).toBe(true);
    expect(isValidDeviceId('a'.repeat(33))).toBe(false);
    expect(isValidDeviceId('bad id')).toBe(false);
    expect(isValidDeviceId(1)).toBe(false);
    expect(normalizeDeviceName('  Desk  ')).toBe('Desk');
    expect(normalizeDeviceName('')).toBeUndefined();
    expect(normalizeDeviceName('x'.repeat(33))).toBeUndefined();
    expect(normalizeDeviceName(5)).toBeUndefined();
    expect(normalizeHost(' 192.168.1.20 ')).toBe('192.168.1.20');
    expect(normalizeHost('plug.local')).toBe('plug.local');
    expect(normalizeHost('not a host')).toBeUndefined();
    expect(normalizeHost(undefined)).toBeUndefined();
  });

  test('should clamp the poll interval, and fall back to 30 seconds', () => {
    expect(normalizePollInterval(20.4)).toBe(20);
    expect(normalizePollInterval(1)).toBe(10);
    expect(normalizePollInterval(99_999)).toBe(3600);
    expect(normalizePollInterval('fast')).toBe(30);
  });

  test('should read a Smart Life account and a developer platform account', () => {
    expect(parseAccountConfig({ type: 'smartLife', userCode: 'abc123', session, extra: 1 })).toEqual({ type: 'smartLife', userCode: 'abc123', session });
    expect(parseAccountConfig({ type: 'developer', accessId: 'id', accessSecret: 'secret', dataCenter: 'eu' })).toEqual({
      type: 'developer',
      accessId: 'id',
      accessSecret: 'secret',
      dataCenter: 'eu',
    });
  });

  test('should refuse an account with a field that is missing or not valid', () => {
    expect(parseAccountConfig(undefined)).toBeUndefined();
    expect(parseAccountConfig({ type: 'other' })).toBeUndefined();
    expect(parseAccountConfig({ type: 'smartLife', userCode: 'abc123' })).toBeUndefined();
    expect(parseAccountConfig({ type: 'smartLife', userCode: '', session })).toBeUndefined();
    expect(parseAccountConfig({ type: 'smartLife', userCode: 'abc', session: 'session' })).toBeUndefined();
    expect(parseAccountConfig({ type: 'smartLife', userCode: 'abc', session: { ...session, accessToken: '' } })).toBeUndefined();
    expect(parseAccountConfig({ type: 'smartLife', userCode: 'abc', session: { ...session, expiresAtInMs: 'soon' } })).toBeUndefined();
    expect(parseAccountConfig({ type: 'developer', accessId: 'id', accessSecret: 'secret', dataCenter: 'moon' })).toBeUndefined();
    expect(parseAccountConfig({ type: 'developer', accessId: '', accessSecret: 'secret', dataCenter: 'eu' })).toBeUndefined();
  });

  test('should read a stored device with every field', () => {
    const stored = {
      ...createDeviceConfig(stripFile, { hiddenFeatures: ['device.outlet2', 'device.outlet2', 'bad id!'], addedFeatures: ['device.childLock'], isComposed: false }),
      cloudName: 'Strip',
      category: 'pc',
      nodeId: 'a4c1380000000001',
      gatewayId: 'bf00000000000000gw01',
      host: '192.168.1.20',
      version: '3.3',
      isCloudOnly: true,
    };
    expect(parseDeviceConfig(stored)).toEqual({ ...stored, hiddenFeatures: ['device.outlet2'] });
  });

  test('should fill in the defaults of a device stored without its settings', () => {
    const { hiddenFeatures: _hidden, addedFeatures: _added, isComposed: _isComposed, localKey: _localKey, ...bare } = createDeviceConfig(plugFile);
    expect(parseDeviceConfig(bare)).toEqual({ ...bare, ...defaultExposure });
  });

  test('should report a setting stored but not valid, and fall back for it', () => {
    const report = vi.fn();
    const device = parseDeviceConfig(
      { ...createDeviceConfig(plugFile), hiddenFeatures: 'outlet', isComposed: 'yes', host: 'not a host', version: '3.3', isCloudOnly: 'no', nodeId: 'a4c1380000000001' },
      report,
    );
    expect(device).toMatchObject({ hiddenFeatures: [], isComposed: true });
    expect(device?.host).toBeUndefined();
    expect(device?.isCloudOnly).toBeUndefined();
    // A node ID without its gateway is dropped.
    expect(device?.nodeId).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(4);
    expect(report).toHaveBeenCalledWith('"Desk" has the hiddenFeatures "outlet", which is not valid: none is used instead');
    expect(parseDeviceConfig({ ...createDeviceConfig(plugFile), isCloudOnly: false, host: '192.168.1.20' }, report)?.host).toBeUndefined();
  });

  test('should refuse a device without a name, a device ID, a product key or a catalog file', () => {
    expect(parseDeviceConfig('device')).toBeUndefined();
    expect(parseDeviceConfig({ ...createDeviceConfig(plugFile), name: '' })).toBeUndefined();
    expect(parseDeviceConfig({ ...createDeviceConfig(plugFile), deviceId: 'bad id' })).toBeUndefined();
    expect(parseDeviceConfig({ ...createDeviceConfig(plugFile), productKey: 7 })).toBeUndefined();
    expect(parseDeviceConfig({ ...createDeviceConfig(plugFile), catalogFile: 'plug.json' })).toBeUndefined();
  });

  test('should drop a device that is not valid, or takes the name or the device ID of another, and keep the unreadable ones', () => {
    const report = vi.fn();
    const desk = createDeviceConfig(plugFile);
    const stored = [
      desk,
      { name: 'Broken' },
      { ...desk, deviceId: 'bf0000000000000002aa' },
      { ...desk, name: 'Hall' },
      createDeviceConfig(plugFile, { name: 'Hall', deviceId: 'bf0000000000000003aa' }),
    ];
    const devices = parseDeviceConfigs(stored, report);
    expect(devices.map((device) => device.name)).toEqual(['Desk', 'Hall']);
    expect(report).toHaveBeenCalledTimes(3);
    expect(parseDeviceConfigs('devices')).toEqual([]);
    expect(getUnreadableDevices(stored, devices)).toEqual([{ name: 'Broken' }]);
    // An entry with the name of a stored device was replaced by it.
    expect(getUnreadableDevices([{ name: 'Desk' }], devices)).toEqual([]);
    expect(getUnreadableDevices(['junk'], devices)).toEqual(['junk']);
    expect(getUnreadableDevices(undefined, devices)).toEqual([]);
  });

  test('should copy a device without its local key', () => {
    const copy = withoutLocalKey(createDeviceConfig(plugFile));
    expect('localKey' in copy).toBe(false);
  });

  test('should compare the connection and the exposure of two devices', () => {
    const desk = createDeviceConfig(stripFile, { hiddenFeatures: ['device.outlet2', 'device.outlet3'] });
    expect(hasSameConnection(desk, { ...desk, name: 'Hall' })).toBe(true);
    expect(hasSameConnection(desk, { ...desk, localKey: 'fedcba9876543210' })).toBe(false);
    expect(hasSameExposure(desk, { ...desk, name: 'Hall', hiddenFeatures: ['device.outlet3', 'device.outlet2'] })).toBe(true);
    expect(hasSameExposure(desk, { ...desk, isComposed: false })).toBe(false);
    expect(hasSameExposure(desk, { ...desk, addedFeatures: ['device.childLock'] })).toBe(false);
  });

  test('should take the exposure and the catalog entry of another device, and keep the rest', () => {
    const desk = createDeviceConfig(stripFile);
    const other = createDeviceConfig(plugFile, { name: 'Hall', isComposed: false, hiddenFeatures: ['meter'], addedFeatures: ['x.on'] });
    expect(withExposureOf(desk, other)).toEqual({ ...desk, catalogFile: plugFile, isComposed: false, hiddenFeatures: ['meter'], addedFeatures: ['x.on'] });
  });
});
