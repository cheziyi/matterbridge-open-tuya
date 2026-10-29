/**
 * @file vitest/platform/endpointIds.test.ts
 * @description This file contains the tests for the endpoint ids of a device, and their store.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import type { NodeStorage } from 'node-persist-manager';

import { EndpointIds, EndpointIdStore, isStoredEndpointIds } from '../../src/platform/endpointIds.js';

describe('EndpointIds', () => {
  test('should give every endpoint its base id when the device was never built before', () => {
    const ids = new EndpointIds();
    expect(ids.resolve('NK6-EU-MHA0001A')).toBe('NK6-EU-MHA0001A');
    expect(ids.resolve('NK6-EU-MHA0001A-night-mode')).toBe('NK6-EU-MHA0001A-night-mode');
    expect(ids.toStore()).toEqual({ built: ['NK6-EU-MHA0001A', 'NK6-EU-MHA0001A-night-mode'], generations: {} });
  });

  test('should give an endpoint that was not built last time a new id, and keep the ids of the ones that were', () => {
    const ids = new EndpointIds({ built: ['NK6-EU-MHA0001A', 'NK6-EU-MHA0001A-night-mode'], generations: {} });
    expect(ids.resolve('NK6-EU-MHA0001A')).toBe('NK6-EU-MHA0001A');
    expect(ids.resolve('auto-mode')).toBe('auto-mode-1');
    expect(ids.toStore()).toEqual({ built: ['NK6-EU-MHA0001A', 'auto-mode'], generations: { 'auto-mode': 1 } });

    // Built last time, the auto mode switch keeps its id. Taken away last time, the night mode switch comes back under a new one.
    const again = new EndpointIds(ids.toStore());
    expect(again.resolve('auto-mode')).toBe('auto-mode-1');
    expect(again.resolve('NK6-EU-MHA0001A-night-mode')).toBe('NK6-EU-MHA0001A-night-mode-1');
    const once = new EndpointIds({ ...again.toStore(), built: ['NK6-EU-MHA0001A'] });
    expect(once.resolve('NK6-EU-MHA0001A-night-mode')).toBe('NK6-EU-MHA0001A-night-mode-2');
  });

  test('should tell stored endpoint ids from anything else', () => {
    expect(isStoredEndpointIds({ built: [], generations: {} })).toBe(true);
    expect(isStoredEndpointIds({ built: ['fan'], generations: { fan: 2 } })).toBe(true);
    expect(isStoredEndpointIds('ids')).toBe(false);
    expect(isStoredEndpointIds({ built: 'fan', generations: {} })).toBe(false);
    expect(isStoredEndpointIds({ built: [1], generations: {} })).toBe(false);
    expect(isStoredEndpointIds({ built: [], generations: [] })).toBe(false);
    expect(isStoredEndpointIds({ built: [], generations: { fan: 0 } })).toBe(false);
  });
});

describe('EndpointIdStore', () => {
  const values = new Map<string, unknown>();
  const storage = {
    get: vi.fn(async (key: string) => values.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
  } as unknown as NodeStorage;
  const device = { deviceId: 'bf0000000000000001aa' };

  test('should keep the endpoint ids of a device under its device ID', async () => {
    const store = new EndpointIdStore(() => storage);
    const ids = { built: ['NK6-EU-MHA0001A', 'auto-mode'], generations: { 'auto-mode': 1 } };
    expect(await store.read(device)).toBeUndefined();
    await store.write(device, ids);
    expect(values.get('endpointIds:bf0000000000000001aa')).toEqual(ids);
    expect(await store.read(device)).toEqual(ids);
    values.set('endpointIds:bf0000000000000001aa', { built: 'auto-mode', generations: {} });
    expect(await store.read(device)).toBeUndefined();
  });

  test('should read and store nothing before the platform storage is ready', async () => {
    const store = new EndpointIdStore(() => undefined);
    await store.write(device, { built: [], generations: {} });
    expect(await store.read(device)).toBeUndefined();
  });
});
