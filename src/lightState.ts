/**
 * @file src/lightState.ts
 * @description This file contains which of its brightnesses a light shows, which Matter and the setup page share.
 * @author Calvin Che
 * @created 2026-11-02
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

import type { LightFeature, RangedControl } from './features.js';

/**
 * Tell whether a light shows its colour now, rather than its white
 *
 * The setup page bundles this file, so it imports nothing at runtime.
 *
 * Edge cases:
 *  - a light without a mode control shows its colour when it has no white brightness
 *  - a mode such as a scene is no colour
 *
 * @param {LightFeature} light The light.
 * @param {ControlValues} values Every control the device reports, as last known.
 * @returns {boolean} True while it shows its colour.
 */
export function isShowingColor(light: LightFeature, values: ControlValues): boolean {
  if (light.color === undefined) return false;
  if (light.mode === undefined) return light.brightness === undefined;
  return values[light.component]?.[light.mode.control] === light.mode.color;
}

/**
 * Get the brightness a light's level stands for: that of the colour while the light shows its colour, else that of its white
 *
 * @param {LightFeature} light The light.
 * @param {boolean} isColor Whether the light shows its colour.
 * @returns {RangedControl | undefined} The brightness control, or undefined when the light has none.
 */
export function getBrightness(light: LightFeature, isColor: boolean): RangedControl | undefined {
  if (isColor && light.color?.brightness !== undefined) return light.color.brightness;
  return light.brightness ?? light.color?.brightness;
}
