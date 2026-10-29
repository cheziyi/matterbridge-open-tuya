/**
 * @file src/accessory/layout.ts
 * @description This file contains how the features of a device are laid out on its Matter endpoints.
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

import { meterFeatureId, type TuyaDeviceExposure } from '../config.js';
import type { ControlRef, DeviceFeatures, MeterFeature, SensorFeature, SwitchFeature } from '../features.js';

/** One endpoint of a device: an outlet, a sensor, or a setting switch. */
export type LayoutUnit =
  | { type: 'outlet'; feature: SwitchFeature; code: string }
  | { type: 'setting'; feature: SwitchFeature; code: string }
  | { type: 'sensor'; feature: SensorFeature; code: string };

/** How the features of a device are laid out on its Matter endpoints. */
export interface AccessoryLayout {
  /** The device itself: its first outlet, or its first sensor when it has no outlet. */
  main: LayoutUnit;
  /** The other outlets, the other sensors and the setting switches shown, in that order. */
  sides: LayoutUnit[];
  /** The meter of the main outlet, when it is shown. */
  meter?: MeterFeature;
  /** The charge of the battery of the device, on the main endpoint. */
  battery?: ControlRef;
  /** Whether the sides are parts of the main endpoint, instead of devices of their own. */
  isComposed: boolean;
}

/**
 * Lay out the features of a device on its Matter endpoints
 *
 * Each feature has a code that tells its endpoint apart in its serial number: its place among the features of the
 * device, so that it stays the same whichever features are shown.
 *
 * Edge cases:
 *  - a device with neither an outlet nor a sensor -> undefined: it has nothing to show
 *  - the main unit is shown whatever `hiddenFeatures` says
 *  - an id in `hiddenFeatures` or `addedFeatures` the features do not have is ignored
 *  - the meter needs an outlet to measure: a device without one shows none
 *
 * @param {TuyaDeviceExposure} exposure How the device is exposed.
 * @param {DeviceFeatures} features What it can show.
 * @returns {AccessoryLayout | undefined} The layout, or undefined when the device has nothing to show.
 */
export function getAccessoryLayout(exposure: TuyaDeviceExposure, features: DeviceFeatures): AccessoryLayout | undefined {
  const units: LayoutUnit[] = [
    ...features.outlets.map((feature): LayoutUnit => ({ type: 'outlet', feature, code: '' })),
    ...features.sensors.map((feature): LayoutUnit => ({ type: 'sensor', feature, code: '' })),
    ...features.settingSwitches.map((feature): LayoutUnit => ({ type: 'setting', feature, code: '' })),
  ].map((unit, index) => ({ ...unit, code: String(index + 1) }));
  const [main, ...rest] = units;
  if (main === undefined || main.type === 'setting') return undefined;
  const isShown = (unit: LayoutUnit): boolean => (unit.type === 'setting' ? exposure.addedFeatures.includes(unit.feature.id) : !exposure.hiddenFeatures.includes(unit.feature.id));
  const layout: AccessoryLayout = { main, sides: rest.filter(isShown), isComposed: exposure.isComposed };
  if (main.type === 'outlet' && features.meter !== undefined && !exposure.hiddenFeatures.includes(meterFeatureId)) layout.meter = features.meter;
  if (features.battery !== undefined) layout.battery = features.battery;
  return layout;
}

/**
 * List the units of a layout, the main one first
 *
 * @param {AccessoryLayout} layout The layout.
 * @returns {LayoutUnit[]} The main unit, then the sides.
 */
export function listUnits(layout: AccessoryLayout): LayoutUnit[] {
  return [layout.main, ...layout.sides];
}
