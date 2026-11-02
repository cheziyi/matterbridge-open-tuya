/**
 * @file src/accessory/matterState.ts
 * @description This file contains how the controls a Tuya device reports are written to its Matter endpoints.
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

import type { MatterbridgeEndpoint } from 'matterbridge';
import {
  BooleanState,
  ColorControl,
  ElectricalEnergyMeasurement,
  ElectricalPowerMeasurement,
  IlluminanceMeasurement,
  LevelControl,
  OccupancySensing,
  OnOff,
  PowerSource,
  RelativeHumidityMeasurement,
  TemperatureMeasurement,
} from 'matterbridge/matter/clusters';
import type { ControlValues } from 'open-tuya';

import { type LightFeature, readValue } from '../features.js';
import { getBrightness, isShowingColor } from '../lightState.js';
import {
  criticalBatteryInPercent,
  lowBatteryInPercent,
  toBoolean,
  toMatterBatteryPercent,
  toMatterHueOrSaturation,
  toMatterHumidity,
  toMatterIlluminance,
  toMatterLevel,
  toMatterMeterReading,
  toMatterMireds,
  toMatterTemperature,
  toMatterXy,
} from '../mapping.js';
import { getTemperatureUnit } from '../temperatureUnit.js';
import { getLightKelvins } from './endpoints.js';
import type { AccessoryLayout, LayoutUnit } from './layout.js';

/** The endpoint of each unit of a device, as the accessory built them. */
export interface AccessoryEndpoints {
  /** The endpoint of the main unit. */
  readonly endpoint: MatterbridgeEndpoint;
  /** The endpoint of each side unit, by the id of its feature. */
  readonly sideEndpoints: ReadonlyMap<string, MatterbridgeEndpoint>;
}

/**
 * Write what a light reports to its endpoint
 *
 * The level is the brightness of its colour while it shows its colour, and the brightness of its white otherwise.
 *
 * Edge cases:
 *  - written only when the changed values carry a control of the light: then every attribute is written from every control last known, since a change of its mode changes what its level is
 *  - a value that is not a number keeps what the endpoint shows
 *  - the colour mode follows the mode of the light: its colour, or the colour temperature of its white, which a white of no colour temperature shows as well, so that the stale colour is not shown
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the light.
 * @param {LightFeature} light The light.
 * @param {ControlValues} values Every control the device reports, as last known.
 * @param {ControlValues} changed The controls that changed, among them.
 * @returns {Promise<void>} Resolves when the attributes are written.
 */
async function applyLight(endpoint: MatterbridgeEndpoint, light: LightFeature, values: ControlValues, changed: ControlValues): Promise<void> {
  if (changed[light.component] === undefined) return;
  const read = (control: string): ControlValues[string][string] | undefined => readValue(values, { component: light.component, control });
  const isOn = read(light.control);
  if (isOn !== undefined) await endpoint.updateAttribute(OnOff, 'onOff', toBoolean(isOn));
  const isColor = isShowingColor(light, values);
  const brightness = getBrightness(light, isColor);
  const level = brightness === undefined ? null : toMatterLevel(read(brightness.control), brightness);
  if (level !== null) await endpoint.updateAttribute(LevelControl, 'currentLevel', level);
  if (light.colorTemperature !== undefined) {
    const mireds = toMatterMireds(read(light.colorTemperature.control), getLightKelvins(light));
    if (mireds !== null) await endpoint.updateAttribute(ColorControl, 'colorTemperatureMireds', mireds);
  }
  if (light.color !== undefined) {
    const hueValue = read(light.color.hue.control);
    const saturationValue = read(light.color.saturation.control);
    const hue = toMatterHueOrSaturation(hueValue, light.color.hue);
    const saturation = toMatterHueOrSaturation(saturationValue, light.color.saturation);
    if (hue !== null && saturation !== null) {
      await endpoint.updateAttribute(ColorControl, 'currentHue', hue);
      await endpoint.updateAttribute(ColorControl, 'currentSaturation', saturation);
      const { currentX, currentY } = toMatterXy({ hue: (hue / 254) * 360, saturation: saturation / 254 });
      await endpoint.updateAttribute(ColorControl, 'currentX', currentX);
      await endpoint.updateAttribute(ColorControl, 'currentY', currentY);
    }
  }
  if (isColor) await setColorMode(endpoint, ColorControl.ColorMode.CurrentHueAndCurrentSaturation, ColorControl.EnhancedColorMode.CurrentHueAndCurrentSaturation);
  else if (light.colorTemperature !== undefined || light.mode?.white !== undefined) {
    await setColorMode(endpoint, ColorControl.ColorMode.ColorTemperatureMireds, ColorControl.EnhancedColorMode.ColorTemperatureMireds);
  }
}

/**
 * Write the colour mode of a light, which says whether its colour is its hue and saturation or its colour temperature
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the light.
 * @param {ColorControl.ColorMode} mode The mode.
 * @param {ColorControl.EnhancedColorMode} enhancedMode The same mode, as the enhanced mode names it.
 * @returns {Promise<void>} Resolves when the mode and the enhanced mode are written.
 */
async function setColorMode(endpoint: MatterbridgeEndpoint, mode: ColorControl.ColorMode, enhancedMode: ColorControl.EnhancedColorMode): Promise<void> {
  await endpoint.updateAttribute(ColorControl, 'colorMode', mode);
  await endpoint.updateAttribute(ColorControl, 'enhancedColorMode', enhancedMode);
}

/**
 * Write the value of one unit to its endpoint
 *
 * Edge cases:
 *  - a control the changed values do not carry, such as one a push leaves out, keeps what the endpoint shows
 *  - a reading that is not a number keeps what the endpoint shows
 *  - a contact sensor that reads open shows no contact
 *  - a temperature is read in the unit the device last reported, pushed with the temperature or before it
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the unit.
 * @param {LayoutUnit} unit The unit.
 * @param {ControlValues} values Every control the device reports, as last known.
 * @param {ControlValues} changed The controls that changed, among them: the ones to write.
 * @returns {Promise<void>} Resolves when the attribute is written.
 */
async function applyUnit(endpoint: MatterbridgeEndpoint, unit: LayoutUnit, values: ControlValues, changed: ControlValues): Promise<void> {
  if (unit.type === 'light') {
    await applyLight(endpoint, unit.feature, values, changed);
    return;
  }
  const value = readValue(changed, unit.feature);
  if (value === undefined) return;
  if (unit.type !== 'sensor') {
    await endpoint.updateAttribute(OnOff, 'onOff', toBoolean(value));
    return;
  }
  const { kind } = unit.feature;
  if (kind === 'temperature') {
    const temperature = toMatterTemperature(value, getTemperatureUnit(values, unit.feature));
    if (temperature !== null) await endpoint.updateAttribute(TemperatureMeasurement, 'measuredValue', temperature);
  } else if (kind === 'humidity') {
    const humidity = toMatterHumidity(value);
    if (humidity !== null) await endpoint.updateAttribute(RelativeHumidityMeasurement, 'measuredValue', humidity);
  } else if (kind === 'illuminance') {
    const illuminance = toMatterIlluminance(value);
    if (illuminance !== null) await endpoint.updateAttribute(IlluminanceMeasurement, 'measuredValue', illuminance);
  } else {
    const isDetected = toBoolean(value);
    if (kind === 'occupancy') await endpoint.updateAttribute(OccupancySensing, 'occupancy', { occupied: isDetected });
    // A contact sensor holds true while it is closed: the device reports whether it is open.
    else if (kind === 'contact') await endpoint.updateAttribute(BooleanState, 'stateValue', !isDetected);
    else await endpoint.updateAttribute(BooleanState, 'stateValue', isDetected);
  }
}

/**
 * Write the readings of the meter to the main endpoint
 *
 * @param {MatterbridgeEndpoint} endpoint The main endpoint.
 * @param {NonNullable<AccessoryLayout['meter']>} meter The meter.
 * @param {ControlValues} values The controls the device reports.
 * @returns {Promise<void>} Resolves when every reading the values carry is written.
 */
async function applyMeter(endpoint: MatterbridgeEndpoint, meter: NonNullable<AccessoryLayout['meter']>, values: ControlValues): Promise<void> {
  const read = (reading: (typeof meter)['power']): number | null => (reading === undefined ? null : toMatterMeterReading(readValue(values, reading), reading.unit));
  const power = read(meter.power);
  const voltage = read(meter.voltage);
  const current = read(meter.current);
  const energy = read(meter.energy);
  if (power !== null) await endpoint.updateAttribute(ElectricalPowerMeasurement, 'activePower', power);
  if (voltage !== null) await endpoint.updateAttribute(ElectricalPowerMeasurement, 'voltage', voltage);
  if (current !== null) await endpoint.updateAttribute(ElectricalPowerMeasurement, 'activeCurrent', current);
  // The energy used so far never runs backwards in Matter: a device that reports less, such as after its counter was cleared, has a lower total from then on.
  if (energy !== null && energy >= 0) await endpoint.updateAttribute(ElectricalEnergyMeasurement, 'cumulativeEnergyImported', { energy });
}

/**
 * Write the charge of the battery to an endpoint that is a device in Matter
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint.
 * @param {NonNullable<AccessoryLayout['battery']>} battery The battery.
 * @param {ControlValues} values The controls the device reports.
 * @returns {Promise<void>} Resolves when the charge and its level are written.
 */
async function applyBattery(endpoint: MatterbridgeEndpoint, battery: NonNullable<AccessoryLayout['battery']>, values: ControlValues): Promise<void> {
  const charge = toMatterBatteryPercent(readValue(values, battery));
  if (charge === null) return;
  let level = PowerSource.BatChargeLevel.Ok;
  if (charge < criticalBatteryInPercent * 2) level = PowerSource.BatChargeLevel.Critical;
  else if (charge < lowBatteryInPercent * 2) level = PowerSource.BatChargeLevel.Warning;
  await endpoint.updateAttribute(PowerSource, 'batPercentRemaining', charge);
  await endpoint.updateAttribute(PowerSource, 'batChargeLevel', level);
}

/**
 * Write the controls a device reports to its Matter endpoints
 *
 * A read gives all of the controls, which are written. A push gives the controls that changed, which are written,
 * while the others stay as they are: a value that is read with another control, such as a temperature with its unit,
 * takes that control from every control last known.
 *
 * @param {AccessoryEndpoints} accessory The endpoints of the device.
 * @param {AccessoryLayout} layout How the features of the device are laid out.
 * @param {ControlValues} values Every control the device reports, as last known.
 * @param {ControlValues} [changed] The controls that changed, among them. Defaults to every control.
 * @returns {Promise<void>} Resolves when every value is written.
 */
export async function applyValues(accessory: AccessoryEndpoints, layout: AccessoryLayout, values: ControlValues, changed: ControlValues = values): Promise<void> {
  await applyUnit(accessory.endpoint, layout.main, values, changed);
  for (const unit of layout.sides) {
    const endpoint = accessory.sideEndpoints.get(unit.feature.id);
    if (endpoint !== undefined) await applyUnit(endpoint, unit, values, changed);
  }
  if (layout.meter !== undefined) await applyMeter(accessory.endpoint, layout.meter, changed);
  if (layout.battery !== undefined) {
    // A part of a composed device has no power source of its own: each device of its own has one.
    for (const endpoint of [accessory.endpoint, ...(layout.isComposed ? [] : accessory.sideEndpoints.values())]) await applyBattery(endpoint, layout.battery, changed);
  }
}
