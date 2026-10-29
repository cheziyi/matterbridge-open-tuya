/**
 * @file vitest/setup/setupApi.test.ts
 * @description This file contains the tests for the REST API of the guided setup page.
 * @author Calvin Che
 */

import type { Mock } from 'vitest';

import { handleSetupRequest, type SetupPlatform, type SetupState } from '../../src/setup/setupApi.js';
import { createDeviceConfig, plugFile } from '../fakeTuya.js';

const state: SetupState = { devices: [] };

/**
 * Build a platform whose every call is a mock
 *
 * @returns {{ [K in keyof SetupPlatform]: Mock<SetupPlatform[K]> }} The platform.
 */
function createPlatform(): { [K in keyof SetupPlatform]: Mock<SetupPlatform[K]> } {
  return {
    getSetupState: vi.fn(async () => Promise.resolve(state)),
    startQrLogin: vi.fn(async () => Promise.resolve({ status: 'waiting' as const, qrCode: 'tuyaSmart--qrLogin?token=1' })),
    getQrLogin: vi.fn(() => ({ status: 'idle' as const })),
    cancelQrLogin: vi.fn<() => void>(),
    signInDeveloper: vi.fn(async () => Promise.resolve()),
    signOut: vi.fn(async () => Promise.resolve()),
    listDevices: vi.fn(async () => Promise.resolve([])),
    syncDevices: vi.fn(async () => Promise.resolve()),
    probe: vi.fn(async (deviceId: string) => Promise.resolve({ status: 'ready' as const, deviceId })),
    saveDevice: vi.fn(async () => Promise.resolve()),
    removeDevice: vi.fn(async (deviceId: string) => Promise.resolve(deviceId === 'bf0000000000000001aa')),
  };
}

describe('handleSetupRequest', () => {
  test('should answer the state and follow the sign in by QR code', async () => {
    const platform = createPlatform();
    expect(await handleSetupRequest(platform, 'GET', 'state')).toEqual({ ok: true, state });
    expect(await handleSetupRequest(platform, 'GET', 'qr-login')).toEqual({ ok: true, login: { status: 'idle' }, state });
    expect(await handleSetupRequest(platform, 'POST', 'qr-code', undefined, { userCode: ' abc123 ' })).toEqual({
      ok: true,
      login: { status: 'waiting', qrCode: 'tuyaSmart--qrLogin?token=1' },
    });
    expect(platform.startQrLogin).toHaveBeenCalledWith('abc123');
    expect(await handleSetupRequest(platform, 'DELETE', 'qr-code')).toEqual({ ok: true });
    expect(platform.cancelQrLogin).toHaveBeenCalled();
  });

  test('should refuse a User Code that is not one', async () => {
    const platform = createPlatform();
    for (const userCode of ['ab', 'with space', 7]) {
      expect(await handleSetupRequest(platform, 'POST', 'qr-code', undefined, { userCode })).toEqual({
        ok: false,
        error: 'Enter the User Code the Smart Life app shows under Settings > Account and Security',
      });
    }
    expect(platform.startQrLogin).not.toHaveBeenCalled();
  });

  test('should sign in to the developer platform, and say which field is missing', async () => {
    const platform = createPlatform();
    expect(await handleSetupRequest(platform, 'POST', 'developer-login', undefined, { accessId: ' id ', accessSecret: ' secret ', dataCenter: 'eu' })).toEqual({ ok: true, state });
    expect(platform.signInDeveloper).toHaveBeenCalledWith({ accessId: 'id', accessSecret: 'secret', dataCenter: 'eu' });
    expect(await handleSetupRequest(platform, 'POST', 'developer-login', undefined, { accessSecret: 'secret', dataCenter: 'eu' })).toEqual({
      ok: false,
      error: 'Enter the Access ID of your cloud project',
    });
    expect(await handleSetupRequest(platform, 'POST', 'developer-login', undefined, { accessId: 'id', dataCenter: 'eu' })).toEqual({
      ok: false,
      error: 'Enter the Access Secret of your cloud project',
    });
    expect(await handleSetupRequest(platform, 'POST', 'developer-login', undefined, { accessId: 'id', accessSecret: 'secret', dataCenter: 'moon' })).toEqual({
      ok: false,
      error: 'Pick the data center of your cloud project',
    });
  });

  test('should sign out, list, sync and probe the devices', async () => {
    const platform = createPlatform();
    expect(await handleSetupRequest(platform, 'DELETE', 'account')).toEqual({ ok: true });
    expect(platform.signOut).toHaveBeenCalled();
    expect(await handleSetupRequest(platform, 'POST', 'devices')).toEqual({ ok: true, devices: [] });
    expect(await handleSetupRequest(platform, 'POST', 'sync')).toEqual({ ok: true, state });
    expect(platform.syncDevices).toHaveBeenCalled();
    expect(await handleSetupRequest(platform, 'POST', 'probe', undefined, { deviceId: 'bf0000000000000001aa' })).toEqual({
      ok: true,
      result: { status: 'ready', deviceId: 'bf0000000000000001aa' },
    });
    expect(await handleSetupRequest(platform, 'POST', 'probe', undefined, { deviceId: 'bad id' })).toEqual({ ok: false, error: 'The device has no valid device ID' });
  });

  test('should save a valid device, and refuse one that is not', async () => {
    const platform = createPlatform();
    const device = createDeviceConfig(plugFile, { host: '192.168.1.20', version: '3.3' });
    expect(await handleSetupRequest(platform, 'POST', 'device', undefined, { device })).toEqual({ ok: true, state });
    expect(platform.saveDevice).toHaveBeenCalledWith(device);
    expect(await handleSetupRequest(platform, 'POST', 'device', undefined, { device: { name: 'Desk' } })).toEqual({
      ok: false,
      error: 'The device needs a name of at most 32 characters, its device ID, its product key and its catalog entry',
    });
    const hostless = { ok: false, error: 'Enter a host name or an IPv4 address and the protocol version for Desk, or leave the host empty to find it on your network' };
    expect(await handleSetupRequest(platform, 'POST', 'device', undefined, { device: { ...device, host: 'not a host' } })).toEqual(hostless);
    expect(await handleSetupRequest(platform, 'POST', 'device', undefined, { device: { ...device, version: undefined } })).toEqual(hostless);
    expect(await handleSetupRequest(platform, 'POST', 'device', undefined, 'junk')).toMatchObject({ ok: false });
    expect(platform.saveDevice).toHaveBeenCalledTimes(1);
  });

  test('should remove a device by its device ID', async () => {
    const platform = createPlatform();
    expect(await handleSetupRequest(platform, 'DELETE', 'device', { deviceId: 'bf0000000000000001aa' })).toEqual({ ok: true });
    expect(await handleSetupRequest(platform, 'DELETE', 'device', { deviceId: 'bf0000000000000002aa' })).toEqual({
      ok: false,
      error: 'No device has the device ID bf0000000000000002aa',
    });
    expect(await handleSetupRequest(platform, 'DELETE', 'device', {})).toEqual({ ok: false, error: 'Give the device ID of the device to remove' });
  });

  test('should answer undefined for a path it does not serve, and the error of a call that fails', async () => {
    const platform = createPlatform();
    expect(await handleSetupRequest(platform, 'GET', 'nothing')).toBeUndefined();
    expect(await handleSetupRequest(platform, 'POST', 'nothing')).toBeUndefined();
    expect(await handleSetupRequest(platform, 'DELETE', 'nothing')).toBeUndefined();
    expect(await handleSetupRequest(platform, 'POST')).toBeUndefined();
    platform.listDevices.mockRejectedValueOnce(new Error('Sign in to your Tuya account first'));
    expect(await handleSetupRequest(platform, 'POST', 'devices')).toEqual({ ok: false, error: 'Sign in to your Tuya account first' });
  });
});
