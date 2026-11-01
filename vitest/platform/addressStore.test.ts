/**
 * @file vitest/platform/addressStore.test.ts
 * @description This file contains the tests for the store of the address each device was last heard at on the LAN.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import type { NodeStorage } from 'node-persist-manager';

import { AddressStore, parseLanAddress } from '../../src/platform/addressStore.js';

describe('AddressStore', () => {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  } as unknown as NodeStorage;

  test('should read an address with a valid host and version, and nothing else', () => {
    expect(parseLanAddress({ host: '192.168.1.20', version: '3.4', extra: 1 })).toEqual({ host: '192.168.1.20', version: '3.4' });
    expect(parseLanAddress({ host: '192.168.1.20', version: '4.0' })).toBeUndefined();
    expect(parseLanAddress({ host: 'not a host', version: '3.3' })).toBeUndefined();
    expect(parseLanAddress('192.168.1.20')).toBeUndefined();
  });

  test('should keep the address of a device under its device ID, and forget it', async () => {
    const store = new AddressStore(() => storage);
    expect(await store.read('bf0000000000000001aa')).toBeUndefined();
    await store.write('bf0000000000000001aa', { host: '192.168.1.20', version: '3.3' });
    expect(values.get('lan:bf0000000000000001aa')).toEqual({ host: '192.168.1.20', version: '3.3' });
    expect(await store.read('bf0000000000000001aa')).toEqual({ host: '192.168.1.20', version: '3.3' });
    await store.remove('bf0000000000000001aa');
    expect(await store.read('bf0000000000000001aa')).toBeUndefined();
  });

  test('should read and store nothing before the platform storage is ready', async () => {
    const store = new AddressStore(() => undefined);
    await store.write('bf0000000000000001aa', { host: '192.168.1.20', version: '3.3' });
    await store.remove('bf0000000000000001aa');
    expect(await store.read('bf0000000000000001aa')).toBeUndefined();
  });
});
