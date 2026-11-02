/**
 * @file src/accessory/lightControl.ts
 * @description This file contains what a Matter controller asks of a light, as the controls of the Tuya device that set it.
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

import type { MatterbridgeEndpoint } from 'matterbridge';
import { ColorControl, OnOff } from 'matterbridge/matter/clusters';
import type { ControlValue, ControlValues } from 'open-tuya';

import type { LightFeature, RangedControl } from '../features.js';
import { fromKelvin, fromMatterHueOrSaturation, fromMatterLevel, fromMatterMireds, fromMatterXy, type HueSaturation } from '../mapping.js';
import { getLightKelvins } from './endpoints.js';
import { isShowingColor } from './matterState.js';

/** What a controller changed on a light: its on/off, its level, or its colour, which is also its colour temperature. */
export type LightChange = 'onOff' | 'level' | 'color';

/** What the endpoint of a light holds, as a controller left it. */
export interface MatterLightState {
  isOn: boolean;
  /** 1 to 254, or null without a level. */
  level: number | null;
  /** Which of the colour attributes holds the colour, a `ColorControl.ColorMode`, or null without a colour. */
  colorMode: number | null;
  /** 0 to 254. */
  hue: number | null;
  /** 0 to 254. */
  saturation: number | null;
  mireds: number | null;
  /** As a fraction of 65536. */
  currentX: number | null;
  currentY: number | null;
}

/** The colour a controller asks for: a white of a colour temperature, or a hue and a saturation. */
type ColorTarget = { kind: 'white'; kelvin: number } | { kind: 'color'; color: HueSaturation };

/**
 * Read an attribute of a light that is a number
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the light.
 * @param {'LevelControl' | 'ColorControl'} cluster The name of the cluster.
 * @param {string} attribute The attribute.
 * @returns {number | null} Its value, or null when the endpoint has no such attribute, or it holds no number.
 */
function readNumber(endpoint: MatterbridgeEndpoint, cluster: 'LevelControl' | 'ColorControl', attribute: string): number | null {
  if (!endpoint.hasAttributeServer(cluster, attribute)) return null;
  const value: unknown = endpoint.getAttribute(cluster, attribute);
  return typeof value === 'number' ? value : null;
}

/**
 * Read what the endpoint of a light holds
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the light.
 * @returns {MatterLightState} The attributes a controller sets.
 */
export function readMatterLight(endpoint: MatterbridgeEndpoint): MatterLightState {
  return {
    isOn: endpoint.getAttribute(OnOff, 'onOff') === true,
    level: readNumber(endpoint, 'LevelControl', 'currentLevel'),
    colorMode: readNumber(endpoint, 'ColorControl', 'colorMode'),
    hue: readNumber(endpoint, 'ColorControl', 'currentHue'),
    saturation: readNumber(endpoint, 'ColorControl', 'currentSaturation'),
    mireds: readNumber(endpoint, 'ColorControl', 'colorTemperatureMireds'),
    currentX: readNumber(endpoint, 'ColorControl', 'currentX'),
    currentY: readNumber(endpoint, 'ColorControl', 'currentY'),
  };
}

/**
 * Read the colour a controller asks for, from the attribute its colour mode names
 *
 * @param {LightFeature} light The light.
 * @param {MatterLightState} state What the endpoint holds.
 * @returns {ColorTarget | undefined} The colour, or undefined when the attributes of its mode hold none.
 */
function readColorTarget(light: LightFeature, state: MatterLightState): ColorTarget | undefined {
  if (state.colorMode === ColorControl.ColorMode.ColorTemperatureMireds) {
    return state.mireds === null ? undefined : { kind: 'white', kelvin: fromMatterMireds(state.mireds, getLightKelvins(light)) };
  }
  if (state.colorMode === ColorControl.ColorMode.CurrentXAndCurrentY) {
    return state.currentX === null || state.currentY === null ? undefined : { kind: 'color', color: fromMatterXy(state.currentX, state.currentY) };
  }
  if (state.hue === null || state.saturation === null) return undefined;
  return { kind: 'color', color: { hue: (state.hue / 254) * 360, saturation: state.saturation / 254 } };
}

/**
 * Set the controls of a colour, with the brightness of the colour from the level
 *
 * @param {LightFeature} light The light.
 * @param {HueSaturation} color The colour.
 * @param {number | null} level The level in Matter, 1 to 254: full brightness without one.
 * @param {Record<string, ControlValue>} controls The controls to write, which this adds to.
 * @returns {boolean} True when the light has a colour to set.
 */
function setColor(light: LightFeature, color: HueSaturation, level: number | null, controls: Record<string, ControlValue>): boolean {
  if (light.color === undefined) return false;
  if (light.mode !== undefined) controls[light.mode.control] = light.mode.color;
  controls[light.color.hue.control] = fromMatterHueOrSaturation((color.hue / 360) * 254, light.color.hue);
  controls[light.color.saturation.control] = fromMatterHueOrSaturation(color.saturation * 254, light.color.saturation);
  if (light.color.brightness !== undefined) controls[light.color.brightness.control] = fromMatterLevel(level ?? 254, light.color.brightness);
  return true;
}

/**
 * Set the controls of a white of a colour temperature
 *
 * Edge cases:
 *  - a light with a white but no colour temperature turns to its white, whatever the temperature
 *  - a light that shows only colours shows the colour nearest to the white
 *
 * @param {LightFeature} light The light.
 * @param {number} kelvin The colour temperature in K.
 * @param {number | null} level The level in Matter, for the brightness of a colour.
 * @param {Record<string, ControlValue>} controls The controls to write, which this adds to.
 * @returns {boolean} True when the light shows a colour afterwards, false when it shows its white.
 */
function setWhite(light: LightFeature, kelvin: number, level: number | null, controls: Record<string, ControlValue>): boolean {
  if (light.colorTemperature === undefined && light.mode?.white === undefined) return setColor(light, fromKelvin(kelvin), level, controls);
  if (light.mode?.white !== undefined) controls[light.mode.control] = light.mode.white;
  if (light.colorTemperature !== undefined) controls[light.colorTemperature.control] = kelvin;
  return false;
}

/**
 * Get the brightness a level sets: that of the colour while the light shows its colour, else that of its white
 *
 * @param {LightFeature} light The light.
 * @param {boolean} isColor Whether the light shows its colour.
 * @returns {RangedControl | undefined} The brightness control, or undefined when the light has none.
 */
function getBrightness(light: LightFeature, isColor: boolean): RangedControl | undefined {
  if (isColor && light.color?.brightness !== undefined) return light.color.brightness;
  return light.brightness ?? light.color?.brightness;
}

/**
 * Turn what a controller changed on a light into the controls that set it on the device
 *
 * Edge cases:
 *  - a colour change sets the mode the colour mode of the endpoint names: the colour temperature turns the light to its
 *    white, a hue and a saturation or x and y to its colour, which takes the brightness of the level with it
 *  - a level change sets the brightness of the mode the light is in, after the colour change
 *  - a change the endpoint holds no value for sets nothing
 *
 * @param {LightFeature} light The light.
 * @param {MatterLightState} state What the endpoint holds.
 * @param {ReadonlySet<LightChange>} changes What the controller changed.
 * @param {ControlValues} values Every control the device reports, as last known, which say the mode the light is in.
 * @returns {Record<string, ControlValue>} The controls of the light's component to write, empty when there is none.
 */
export function getLightControls(light: LightFeature, state: MatterLightState, changes: ReadonlySet<LightChange>, values: ControlValues): Record<string, ControlValue> {
  const controls: Record<string, ControlValue> = {};
  if (changes.has('onOff')) controls[light.control] = state.isOn;
  let isColor = isShowingColor(light, values);
  // A colour that is written takes the brightness of the level with it.
  let hasWrittenColor = false;
  const target = changes.has('color') ? readColorTarget(light, state) : undefined;
  if (target?.kind === 'white') {
    hasWrittenColor = setWhite(light, target.kelvin, state.level, controls);
    isColor = hasWrittenColor;
  } else if (target?.kind === 'color' && setColor(light, target.color, state.level, controls)) {
    hasWrittenColor = true;
    isColor = true;
  }
  const brightness = getBrightness(light, isColor);
  const isLevelWritten = hasWrittenColor && brightness === light.color?.brightness;
  if (changes.has('level') && !isLevelWritten && brightness !== undefined && state.level !== null) controls[brightness.control] = fromMatterLevel(state.level, brightness);
  return controls;
}
