/**
 * @file vitest/platform/gatewayRoute.test.ts
 * @description This file contains the tests for the route of a gateway to itself, through the client the devices behind it share.
 * @author Calvin Che
 */

import { GatewayRoute } from '../../src/platform/gatewayRoute.js';
import { createFakeRoute } from '../fakeTuya.js';

describe('GatewayRoute', () => {
  test('should read, write and hand on the reports of the client of the gateway, and leave it open when closed', async () => {
    const client = createFakeRoute({ '1': true });
    const route = new GatewayRoute(client);
    expect(route.connected).toBe(true);
    expect(await route.readDataPoints()).toEqual({ '1': true });
    await route.writeDataPoints({ '1': false });
    expect(client.writeDataPoints).toHaveBeenCalledWith({ '1': false });
    const listener = vi.fn();
    const stop = route.onDataPoints(listener);
    client.push({ '1': true });
    expect(listener).toHaveBeenCalledWith({ '1': true });
    stop();
    client.push({ '1': false });
    expect(listener).toHaveBeenCalledTimes(1);
    await route.close();
    await route[Symbol.asyncDispose]();
    expect(client.close).not.toHaveBeenCalled();
    client.connected = false;
    expect(route.connected).toBe(false);
  });
});
