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
  ElectricalEnergyMeasurement,
  ElectricalPowerMeasurement,
  IlluminanceMeasurement,
  OccupancySensing,
  OnOff,
  PowerSource,
  RelativeHumidityMeasurement,
  TemperatureMeasurement,
} from 'matterbridge/matter/clusters';
import type { ControlValues } from 'open-tuya';

import { readValue, type SensorFeature } from '../features.js';
import {
  criticalBatteryInPercent,
  lowBatteryInPercent,
  toBoolean,
  toMatterBatteryPercent,
  toMatterHumidity,
  toMatterIlluminance,
  toMatterMeterReading,
  toMatterTemperature,
} from '../mapping.js';
import type { AccessoryLayout, LayoutUnit } from './layout.js';

/** The endpoint of each unit of a device, as the accessory built them. */
export interface AccessoryEndpoints {
  /** The endpoint of the main unit. */
  readonly endpoint: MatterbridgeEndpoint;
  /** The endpoint of each side unit, by the id of its feature. */
  readonly sideEndpoints: ReadonlyMap<string, MatterbridgeEndpoint>;
}

/**
 * Get the unit of a temperature, on a device that switches its unit at runtime as well
 *
 * @param {ControlValues} values The controls the device reports.
 * @param {SensorFeature} feature The temperature sensor.
 * @returns {string | undefined} The unit the device reports, or the one the catalog gives.
 */
function getTemperatureUnit(values: ControlValues, feature: SensorFeature): string | undefined {
  if (feature.unitFrom === undefined) return feature.unit;
  const unit = readValue(values, { component: feature.component, control: feature.unitFrom });
  return typeof unit === 'string' ? unit : feature.unit;
}

/**
 * Write the value of one unit to its endpoint
 *
 * Edge cases:
 *  - a control the values do not carry, such as one a push leaves out, keeps what the endpoint shows
 *  - a reading that is not a number keeps what the endpoint shows
 *  - a contact sensor that reads open shows no contact
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint of the unit.
 * @param {LayoutUnit} unit The unit.
 * @param {ControlValues} values The controls the device reports.
 * @returns {Promise<void>} Resolves when the attribute is written.
 */
async function applyUnit(endpoint: MatterbridgeEndpoint, unit: LayoutUnit, values: ControlValues): Promise<void> {
  const value = readValue(values, unit.feature);
  if (value === undefined) return;
  if (unit.type !== 'sensor') {
    const isOn = toBoolean(value);
    if (isOn !== null) await endpoint.updateAttribute(OnOff, 'onOff', isOn);
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
    if (isDetected === null) return;
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
 * Write the charge of the battery to the main endpoint
 *
 * @param {MatterbridgeEndpoint} endpoint The main endpoint.
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
 * The values can be all of the controls, as a read gives them, or some, as a push gives them: what they leave out
 * stays as it is.
 *
 * @param {AccessoryEndpoints} accessory The endpoints of the device.
 * @param {AccessoryLayout} layout How the features of the device are laid out.
 * @param {ControlValues} values The controls the device reports.
 * @returns {Promise<void>} Resolves when every value is written.
 */
export async function applyValues(accessory: AccessoryEndpoints, layout: AccessoryLayout, values: ControlValues): Promise<void> {
  await applyUnit(accessory.endpoint, layout.main, values);
  for (const unit of layout.sides) {
    const endpoint = accessory.sideEndpoints.get(unit.feature.id);
    if (endpoint !== undefined) await applyUnit(endpoint, unit, values);
  }
  if (layout.meter !== undefined) await applyMeter(accessory.endpoint, layout.meter, values);
  if (layout.battery !== undefined) await applyBattery(accessory.endpoint, layout.battery, values);
}
