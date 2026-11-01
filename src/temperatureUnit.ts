/**
 * @file src/temperatureUnit.ts
 * @description This file contains how the unit of a temperature is read, which Matter and the setup page share.
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

import type { ControlValues } from 'open-tuya';

import type { SensorFeature } from './features.js';

/**
 * Get the unit of a temperature, on a device that switches its unit at runtime as well
 *
 * The setup page bundles this file, so it imports nothing at runtime.
 *
 * @param {ControlValues} values The controls the device reports.
 * @param {SensorFeature} feature The temperature sensor.
 * @returns {string | undefined} The unit the device reports, or the one the catalog gives.
 */
export function getTemperatureUnit(values: ControlValues, feature: SensorFeature): string | undefined {
  if (feature.unitFrom === undefined) return feature.unit;
  const unit = values[feature.component]?.[feature.unitFrom];
  return typeof unit === 'string' ? unit : feature.unit;
}
