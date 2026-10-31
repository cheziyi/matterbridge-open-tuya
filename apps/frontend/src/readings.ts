/**
 * @file apps/frontend/src/readings.ts
 * @description What a device reports, in a line the page can show.
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

import type { ControlRef, DeviceFeatures, ProbeResult, SensorFeature } from './api.js';

type Values = NonNullable<ProbeResult['values']>;

function read(values: Values, ref: ControlRef): boolean | number | string | undefined {
  return values[ref.component]?.[ref.control];
}

// Such as "21.5 °C" or "Open".
function describeSensor(feature: SensorFeature, value: boolean | number | string): string {
  if (feature.kind === 'temperature') return `${String(value)} °${feature.unit !== undefined && /^f/i.test(feature.unit) ? 'F' : 'C'}`;
  if (feature.kind === 'humidity') return `${String(value)} % humidity`;
  if (feature.kind === 'illuminance') return `${String(value)} lx`;
  const isDetected = value === true || value === 1 || value === 'true';
  if (feature.kind === 'occupancy') return isDetected ? 'Motion' : 'No motion';
  if (feature.kind === 'contact') return isDetected ? 'Open' : 'Closed';
  return isDetected ? 'Water leak' : 'No leak';
}

/**
 * Describe what a device reports, such as "Outlet 1 on, Outlet 2 off, 12.3 W, 230 V"
 *
 * @param {DeviceFeatures | undefined} features What the device can show.
 * @param {Values | undefined} values The controls it reported.
 * @returns {string} The description, or an empty text when it reported none of them.
 */
export function describeReadings(features: DeviceFeatures | undefined, values: Values | undefined): string {
  if (features === undefined || values === undefined) return '';
  const parts: string[] = [];
  const isSingleOutlet = features.outlets.length === 1;
  for (const outlet of features.outlets) {
    const value = read(values, outlet);
    if (typeof value === 'boolean') parts.push(isSingleOutlet ? (value ? 'On' : 'Off') : `${outlet.label} ${value ? 'on' : 'off'}`);
  }
  for (const sensor of features.sensors) {
    const value = read(values, sensor);
    if (value !== undefined) parts.push(describeSensor(sensor, value));
  }
  const { meter } = features;
  for (const reading of [meter?.power, meter?.voltage, meter?.current, meter?.energy]) {
    if (reading === undefined) continue;
    const value = read(values, reading);
    if (typeof value === 'number') parts.push(`${value} ${reading.unit}`);
  }
  if (features.battery !== undefined) {
    const value = read(values, features.battery);
    if (typeof value === 'number') parts.push(`battery ${value} %`);
  }
  return parts.join(', ');
}
