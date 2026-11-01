/**
 * @file vitest/platform/setupStore.test.ts
 * @description This file contains the tests for the storage of the account and the devices.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import type { NodeStorage } from 'node-persist-manager';

import { SetupStore } from '../../src/platform/setupStore.js';

/**
 * Create a storage held in memory
 *
 * @returns {{ storage: NodeStorage; values: Map<string, unknown> }} The storage, and what it holds.
 */
function createStorage(): { storage: NodeStorage; values: Map<string, unknown> } {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => Promise.resolve(values.get(key))),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    }),
  };
  return { storage: storage as unknown as NodeStorage, values };
}

describe('SetupStore', () => {
  test('should read back what it wrote, saying nothing of a storage with nothing in it', async () => {
    const { storage } = createStorage();
    const store = new SetupStore(() => storage);
    const report = vi.fn();
    expect(await store.read(report)).toEqual({});
    await store.write({ account: { type: 'developer' }, devices: [] });
    expect(await store.read(report)).toEqual({ account: { type: 'developer' }, devices: [] });
    expect(report).not.toHaveBeenCalled();
  });

  test('should read the copy, and say so, when the first cannot be read or reads as nothing, as a damaged file does', async () => {
    const { storage, values } = createStorage();
    const store = new SetupStore(() => storage);
    const report = vi.fn();
    await store.write({ devices: ['kept'] });
    values.set('setup', 'junk');
    expect(await store.read(report)).toEqual({ devices: ['kept'] });
    values.delete('setup');
    expect(await store.read(report)).toEqual({ devices: ['kept'] });
    expect(report).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenCalledWith('The stored Tuya account and devices cannot be read: using the copy from the write before');
  });

  test('should say so when neither copy can be read', async () => {
    const { storage, values } = createStorage();
    const store = new SetupStore(() => storage);
    const report = vi.fn();
    values.set('setup', 'junk');
    expect(await store.read(report)).toEqual({});
    expect(report).toHaveBeenCalledWith('The stored Tuya account and devices cannot be read: sign in and add the devices again in the setup page');
  });

  test('should keep the copy of the write before when the write of the first fails', async () => {
    const { storage, values } = createStorage();
    const store = new SetupStore(() => storage);
    await store.write({ devices: ['before'] });
    vi.mocked(storage.set).mockRejectedValueOnce(new Error('disk full'));
    await expect(store.write({ devices: ['after'] })).rejects.toThrow('disk full');
    expect(values.get('setup.copy')).toEqual({ devices: ['before'] });
  });

  test('should write one after the other, and go on after a write that fails', async () => {
    const { storage, values } = createStorage();
    const store = new SetupStore(() => storage);
    vi.mocked(storage.set).mockRejectedValueOnce(new Error('disk full'));
    const failing = store.write({ devices: ['first'] });
    const last = store.write({ devices: ['last'] });
    await expect(failing).rejects.toThrow('disk full');
    await last;
    await store.flush();
    expect(values.get('setup')).toEqual({ devices: ['last'] });
  });

  test('should refuse a write without the storage, and read nothing', async () => {
    const store = new SetupStore(() => undefined);
    await expect(store.write({ devices: [] })).rejects.toThrow('The storage of the platform is closed');
    expect(await store.read(vi.fn())).toEqual({});
  });
});
