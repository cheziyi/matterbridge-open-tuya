/**
 * @file src/platform/cloudRoute.ts
 * @description This file contains the route to a device through a Tuya cloud account, built in the background.
 * @author Calvin Che
 * @created 2026-10-29
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026 Calvin Che.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { type DataPoints, type TuyaClient, TuyaError } from 'open-tuya';

import { ignoreFailure } from '../errors.js';

/** How long, in milliseconds, a build that failed waits before it is tried again: it doubles each time, up to `maxRetryDelayInMs`. */
export const firstRetryDelayInMs = 5000;
const maxRetryDelayInMs = 60_000;

/**
 * A device reached through a cloud account, whose client the account builds when the route is created
 *
 * It does as open-tuya's own cloud route of `createTuyaClient`, which open-tuya does not export: the plugin builds the
 * routes of a device itself, so that it knows which of them answers. A build that fails is tried again 5 s later,
 * doubling to 60 s, but not after an error that is not a `TuyaError`, or one with code `SESSION_EXPIRED` or
 * `PERMISSION_DENIED`, none of which clears by waiting. A request waits for a build in flight, and fails at once with
 * the last build's error while none is.
 */
export class CloudRoute implements TuyaClient {
  private client: TuyaClient | undefined;
  private building: Promise<TuyaClient> | undefined;
  private lastError: unknown;
  private retryDelayInMs = firstRetryDelayInMs;
  private retryTimer: NodeJS.Timeout | undefined;
  private isClosed = false;
  private readonly listeners = new Set<(dataPoints: DataPoints) => void>();

  /**
   * Start building the client
   *
   * @param {() => Promise<TuyaClient>} createClient Builds the client of the device, such as `account.createClient(deviceId)`.
   */
  constructor(private readonly createClient: () => Promise<TuyaClient>) {
    this.build();
  }

  /**
   * Tell whether a request goes out at once
   *
   * @returns {boolean} True once the client is built and while it is connected, until the route is closed.
   */
  get connected(): boolean {
    return !this.isClosed && (this.client?.connected ?? false);
  }

  /**
   * Read the data points of the device through the cloud
   *
   * @returns {Promise<DataPoints>} The data points the cloud reports.
   */
  async readDataPoints(): Promise<DataPoints> {
    return (await this.built()).readDataPoints();
  }

  /**
   * Write data points through the cloud
   *
   * @param {DataPoints} dataPoints The data points.
   * @returns {Promise<void>} Resolves once the cloud takes the write.
   */
  async writeDataPoints(dataPoints: DataPoints): Promise<void> {
    await (await this.built()).writeDataPoints(dataPoints);
  }

  /**
   * Listen to the data points the cloud pushes
   *
   * @param {(dataPoints: DataPoints) => void} listener Called with each push.
   * @returns {() => void} Removes the listener.
   */
  onDataPoints(listener: (dataPoints: DataPoints) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Stop the route, and close the client once a build in flight ends
   *
   * @returns {Promise<void>} Resolves once the client is closed.
   */
  async close(): Promise<void> {
    this.isClosed = true;
    clearTimeout(this.retryTimer);
    const building = this.building;
    this.building = undefined;
    let client: TuyaClient | undefined;
    try {
      client = await building;
    } catch {
      // The build failed: there is no client to close.
    }
    await client?.close().catch(ignoreFailure);
  }

  /**
   * Close the route at the end of an `await using` scope
   *
   * @returns {Promise<void>} Resolves once the client is closed.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private build(): void {
    const building = this.createClient();
    this.building = building;
    void this.settle(building);
  }

  // Takes the client a build gave, or schedules the next build after a failure that may clear by waiting.
  private async settle(building: Promise<TuyaClient>): Promise<void> {
    let client: TuyaClient;
    try {
      client = await building;
    } catch (error) {
      if (this.building === building) this.building = undefined;
      this.lastError = error;
      if (this.isClosed || !(error instanceof TuyaError) || error.code === 'SESSION_EXPIRED' || error.code === 'PERMISSION_DENIED') return;
      this.retryTimer = setTimeout(() => this.build(), this.retryDelayInMs);
      this.retryTimer.unref();
      this.retryDelayInMs = Math.min(this.retryDelayInMs * 2, maxRetryDelayInMs);
      return;
    }
    if (this.isClosed) return;
    this.client = client;
    client.onDataPoints((dataPoints) => {
      for (const listener of this.listeners) listener(dataPoints);
    });
  }

  private async built(): Promise<TuyaClient> {
    if (this.isClosed) throw new TuyaError('CONNECTION_LOST', 'The client is closed');
    if (this.building === undefined) throw this.lastError;
    return this.building;
  }
}
