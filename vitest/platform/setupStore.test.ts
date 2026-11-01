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
  test('should read back what it wrote, and nothing from a value that is not an object', async () => {
    const { storage, values } = createStorage();
    const store = new SetupStore(() => storage);
    expect(await store.read()).toEqual({});
    await store.write({ account: { type: 'developer' }, devices: [] });
    expect(await store.read()).toEqual({ account: { type: 'developer' }, devices: [] });
    values.set('setup', 'junk');
    expect(await store.read()).toEqual({});
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

  test('should do nothing without the storage', async () => {
    const store = new SetupStore(() => undefined);
    await store.write({ devices: [] });
    expect(await store.read()).toEqual({});
  });
});
