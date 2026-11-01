/**
 * @file vitest/platform/cloudRoute.test.ts
 * @description This file contains the tests for the route to a device through a Tuya cloud account.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import { TuyaError } from 'open-tuya';

import { CloudRoute, firstRetryDelayInMs } from '../../src/platform/cloudRoute.js';
import { createFakeRoute } from '../fakeTuya.js';

describe('CloudRoute', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('should read, write and hand on the pushes of the client the account builds', async () => {
    const client = createFakeRoute({ '1': true });
    const route = new CloudRoute(async () => client);
    expect(route.connected).toBe(false);
    expect(await route.readDataPoints()).toEqual({ '1': true });
    expect(route.connected).toBe(true);
    await route.writeDataPoints({ '1': false });
    expect(client.writeDataPoints).toHaveBeenCalledWith({ '1': false });
    const listener = vi.fn();
    const stop = route.onDataPoints(listener);
    client.push({ '1': true });
    expect(listener).toHaveBeenCalledWith({ '1': true });
    stop();
    client.push({ '1': false });
    expect(listener).toHaveBeenCalledTimes(1);
    await route[Symbol.asyncDispose]();
    expect(client.close).toHaveBeenCalled();
    expect(route.connected).toBe(false);
    await expect(route.readDataPoints()).rejects.toThrow('The client is closed');
  });

  test('should try a failed build again later, doubling the wait, and fail at once meanwhile', async () => {
    vi.useFakeTimers();
    const client = createFakeRoute({ '1': true });
    const createClient = vi
      .fn<() => Promise<typeof client>>()
      .mockRejectedValueOnce(new TuyaError('CONNECTION_FAILED', 'no cloud'))
      .mockRejectedValueOnce(new TuyaError('REQUEST_TIMED_OUT', 'slow cloud'))
      .mockResolvedValue(client);
    const route = new CloudRoute(createClient);
    await vi.advanceTimersByTimeAsync(0);
    await expect(route.readDataPoints()).rejects.toThrow('no cloud');
    await vi.advanceTimersByTimeAsync(firstRetryDelayInMs);
    expect(createClient).toHaveBeenCalledTimes(2);
    await expect(route.readDataPoints()).rejects.toThrow('slow cloud');
    // The second wait is twice the first.
    await vi.advanceTimersByTimeAsync(firstRetryDelayInMs);
    expect(createClient).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(firstRetryDelayInMs);
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(await route.readDataPoints()).toEqual({ '1': true });
    await route.close();
  });

  test('should not try again after an error that waiting does not clear', async () => {
    vi.useFakeTimers();
    for (const error of [new TuyaError('SESSION_EXPIRED', 'sign in'), new TuyaError('PERMISSION_DENIED', 'plan'), new Error('bug')]) {
      const createClient = vi.fn().mockRejectedValue(error);
      const route = new CloudRoute(createClient);
      await vi.advanceTimersByTimeAsync(firstRetryDelayInMs * 20);
      expect(createClient).toHaveBeenCalledTimes(1);
      await expect(route.writeDataPoints({})).rejects.toBe(error);
      await route.close();
    }
  });

  test('should close a client whose build ends after the route is closed, and not try again after a failure once closed', async () => {
    vi.useFakeTimers();
    const client = createFakeRoute();
    let resolveBuild: (built: typeof client) => void = () => undefined;
    const route = new CloudRoute(
      async () =>
        new Promise((resolve) => {
          resolveBuild = resolve;
        }),
    );
    const closing = route.close();
    resolveBuild(client);
    await closing;
    expect(client.close).toHaveBeenCalled();
    expect(route.connected).toBe(false);

    const failing = vi.fn().mockRejectedValue(new TuyaError('CONNECTION_FAILED', 'no cloud'));
    const closed = new CloudRoute(failing);
    await closed.close();
    await vi.advanceTimersByTimeAsync(firstRetryDelayInMs * 2);
    expect(failing).toHaveBeenCalledTimes(1);
  });
});
