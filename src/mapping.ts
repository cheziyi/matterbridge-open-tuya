/**
 * @file src/mapping.ts
 * @description This file contains the conversions between the values of a Tuya device and those of Matter.
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

import type { ControlValue } from 'open-tuya';

import { maxDeviceNameLength } from './config.js';

/** The highest illuminance Matter takes, as `10000 * log10(lux) + 1`. */
const maxMatterIlluminance = 0xfffe;

/** A battery below this charge, in percent, is low, and below `criticalBatteryInPercent` critical. */
export const lowBatteryInPercent = 20;
export const criticalBatteryInPercent = 10;

/** How much of the unit of Matter each unit of a reading is: Matter takes the power in mW, the voltage in mV, the current in mA and the energy in mWh. */
const meterFactors: Readonly<Record<string, number>> = {
  W: 1000,
  kW: 1_000_000,
  V: 1000,
  mV: 1,
  A: 1000,
  mA: 1,
  kWh: 1_000_000,
  Wh: 1000,
};

/**
 * Read a control value as a number
 *
 * @param {ControlValue | undefined} value The value.
 * @returns {number | null} The value when it is a finite number, else null.
 */
export function toNumber(value: ControlValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Convert a temperature to Matter
 *
 * Edge cases:
 *  - a unit starting with `F`, in any case -> converted from °F; any other unit, or none, is °C
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The temperature.
 * @param {string} [unit] Its unit, such as `C` or `F`.
 * @returns {number | null} The temperature in °C * 100, or null.
 */
export function toMatterTemperature(value: ControlValue | undefined, unit?: string): number | null {
  const temperature = toNumber(value);
  if (temperature === null) return null;
  const celsius = unit !== undefined && /^f/i.test(unit) ? ((temperature - 32) * 5) / 9 : temperature;
  return Math.round(celsius * 100);
}

/**
 * Convert a relative humidity to Matter
 *
 * Edge cases:
 *  - clamps to 0..100 %
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The humidity in percent.
 * @returns {number | null} The humidity in % * 100, or null.
 */
export function toMatterHumidity(value: ControlValue | undefined): number | null {
  const humidity = toNumber(value);
  if (humidity === null) return null;
  return Math.round(Math.min(Math.max(humidity, 0), 100) * 100);
}

/**
 * Convert an illuminance to Matter
 *
 * Edge cases:
 *  - 0 lux or less -> 0, which Matter takes for too dark to measure
 *  - clamps to the highest value Matter takes, 0xfffe
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The illuminance in lux.
 * @returns {number | null} `10000 * log10(lux) + 1`, rounded, or null.
 */
export function toMatterIlluminance(value: ControlValue | undefined): number | null {
  const lux = toNumber(value);
  if (lux === null) return null;
  if (lux <= 0) return 0;
  return Math.min(Math.max(Math.round(10000 * Math.log10(lux) + 1), 1), maxMatterIlluminance);
}

/**
 * Convert a reading of the meter to the unit of Matter
 *
 * Edge cases:
 *  - a unit the meter does not take -> null
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The reading.
 * @param {string} unit Its unit: `W`, `kW`, `V`, `mV`, `A`, `mA`, `kWh` or `Wh`.
 * @returns {number | null} The reading in mW, mV, mA or mWh, rounded, or null.
 */
export function toMatterMeterReading(value: ControlValue | undefined, unit: string): number | null {
  const reading = toNumber(value);
  const factor = meterFactors[unit];
  if (reading === null || factor === undefined) return null;
  return Math.round(reading * factor);
}

/**
 * Convert the charge of a battery to Matter
 *
 * Edge cases:
 *  - clamps to 0..100 %
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The charge in percent.
 * @returns {number | null} The charge in half percent, 0..200, or null.
 */
export function toMatterBatteryPercent(value: ControlValue | undefined): number | null {
  const charge = toNumber(value);
  if (charge === null) return null;
  return Math.round(Math.min(Math.max(charge, 0), 100) * 2);
}

/**
 * Read a control value as on or off
 *
 * Edge cases:
 *  - a number -> on when it is not 0
 *  - a string -> on when it is `true`, `on`, `open` or `1`, in any case
 *  - undefined -> null
 *
 * @param {ControlValue | undefined} value The value.
 * @returns {boolean | null} Whether it is on, or null when there is no value.
 */
export function toBoolean(value: ControlValue | undefined): boolean | null {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return ['true', 'on', 'open', '1'].includes(value.trim().toLowerCase());
}

/**
 * Join the name of a device and what one of its endpoints is into the name of that endpoint
 *
 * Edge cases:
 *  - the name is cut, never the label, so that the result fits in 32 characters
 *
 * @param {string} name The name of the device.
 * @param {string} label What the endpoint is, such as `Outlet 2`.
 * @returns {string} Such as `Desk Outlet 2`, of at most 32 characters.
 */
export function composeDeviceName(name: string, label: string): string {
  const room = maxDeviceNameLength - label.length - 1;
  if (room <= 0) return label.slice(0, maxDeviceNameLength);
  return `${name.slice(0, room).trimEnd()} ${label}`;
}
