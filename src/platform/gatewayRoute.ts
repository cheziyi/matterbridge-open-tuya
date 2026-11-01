/**
 * @file src/platform/gatewayRoute.ts
 * @description This file contains the route of a gateway to itself, through the client the devices behind it share.
 * @author Calvin Che
 * @created 2026-11-01
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

import type { DataPoints, TuyaClient } from 'open-tuya';

/**
 * A gateway reached through the client the devices behind it share
 *
 * A gateway holds one connection on the LAN: a second client takes it from the first. So a gateway that is a device
 * of its own, such as one with a switch or a night light, goes through the client of the devices behind it, which
 * the platform owns. Closing the route leaves that client open, as closing the route of a device behind the gateway
 * does.
 */
export class GatewayRoute implements TuyaClient {
  /**
   * Wrap the client of the gateway
   *
   * @param {TuyaClient} client The client the devices behind the gateway share.
   */
  constructor(private readonly client: TuyaClient) {}

  /**
   * Tell whether a request goes out at once
   *
   * @returns {boolean} True while the client of the gateway is connected.
   */
  get connected(): boolean {
    return this.client.connected;
  }

  /**
   * Read the data points of the gateway itself
   *
   * @returns {Promise<DataPoints>} The data points the gateway reports.
   */
  async readDataPoints(): Promise<DataPoints> {
    return this.client.readDataPoints();
  }

  /**
   * Write data points to the gateway itself
   *
   * @param {DataPoints} dataPoints The data points.
   * @returns {Promise<void>} Resolves once the gateway takes the write.
   */
  async writeDataPoints(dataPoints: DataPoints): Promise<void> {
    await this.client.writeDataPoints(dataPoints);
  }

  /**
   * Listen to the data points the gateway reports for itself
   *
   * @param {(dataPoints: DataPoints) => void} listener Called with each report.
   * @returns {() => void} Removes the listener.
   */
  onDataPoints(listener: (dataPoints: DataPoints) => void): () => void {
    return this.client.onDataPoints(listener);
  }

  /**
   * Leave the route: the client stays open for the devices behind the gateway, and the platform closes it
   *
   * @returns {Promise<void>} Resolves at once.
   */
  async close(): Promise<void> {
    // The client belongs to the platform.
  }

  /**
   * Leave the route at the end of an `await using` scope
   *
   * @returns {Promise<void>} Resolves at once.
   */
  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
