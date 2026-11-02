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

import { kelvinToRGB, type RGB, rgbColorToXYColor, xyColorToRgbColor } from 'matterbridge/utils';
import type { ControlValue } from 'open-tuya';

import { maxDeviceNameLength } from './config.js';

/** The highest illuminance Matter takes, as `10000 * log10(lux) + 1`. */
const maxMatterIlluminance = 0xfffe;

/** The lowest and the highest level of a light in Matter, of its Level Control cluster. */
const minMatterLevel = 1;
const maxMatterLevel = 254;

/** The highest hue and saturation in Matter, of its Color Control cluster: the hue runs over the whole circle, the saturation up to full. */
const maxMatterHueOrSaturation = 254;

/** The highest x and y of a colour in Matter, which takes them as fractions of 65536. */
const maxMatterColorCoordinate = 0xfeff;

/** A range of values, such as the brightness of a light from 10 to 1000. */
export interface ValueRange {
  min: number;
  max: number;
}

/** A colour as a hue and a saturation, the brightness left apart. */
export interface HueSaturation {
  /** In degrees, 0 to 360. */
  hue: number;
  /** As a fraction of full, 0 to 1. */
  saturation: number;
}

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
 *
 * @param {ControlValue} value The value.
 * @returns {boolean} Whether it is on.
 */
export function toBoolean(value: ControlValue): boolean {
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

/**
 * Clamp a number into a range
 *
 * @param {number} value The number.
 * @param {ValueRange} range The range.
 * @returns {number} The number, or the end of the range it is beyond.
 */
function clamp(value: number, range: ValueRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

/**
 * Convert the brightness of a light to its level in Matter
 *
 * Edge cases:
 *  - the lowest brightness of the range is level 1, the highest 254; a brightness beyond the range is clamped
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The brightness, in the units of the range.
 * @param {ValueRange} range The range of the brightness.
 * @returns {number | null} The level, 1 to 254, or null.
 */
export function toMatterLevel(value: ControlValue | undefined, range: ValueRange): number | null {
  const brightness = toNumber(value);
  if (brightness === null) return null;
  const fraction = (clamp(brightness, range) - range.min) / (range.max - range.min);
  return Math.round(minMatterLevel + fraction * (maxMatterLevel - minMatterLevel));
}

/**
 * Convert the level of a light in Matter to its brightness
 *
 * Edge cases:
 *  - a level beyond 1 to 254 is clamped
 *
 * @param {number} level The level.
 * @param {ValueRange} range The range of the brightness.
 * @returns {number} The brightness, in the units of the range, rounded.
 */
export function fromMatterLevel(level: number, range: ValueRange): number {
  const fraction = (clamp(level, { min: minMatterLevel, max: maxMatterLevel }) - minMatterLevel) / (maxMatterLevel - minMatterLevel);
  return Math.round(range.min + fraction * (range.max - range.min));
}

/**
 * Convert a hue or a saturation to Matter
 *
 * Edge cases:
 *  - the range is stretched over 0 to 254; a value beyond it is clamped
 *  - not a number -> null
 *
 * @param {ControlValue | undefined} value The hue or the saturation, in the units of the range.
 * @param {ValueRange} range Its range, such as 0 to 360 degrees.
 * @returns {number | null} The hue or the saturation in Matter, 0 to 254, or null.
 */
export function toMatterHueOrSaturation(value: ControlValue | undefined, range: ValueRange): number | null {
  const number = toNumber(value);
  if (number === null) return null;
  return Math.round(((clamp(number, range) - range.min) / (range.max - range.min)) * maxMatterHueOrSaturation);
}

/**
 * Convert a hue or a saturation of Matter to the range of the device
 *
 * @param {number} value The hue or the saturation in Matter, 0 to 254, clamped.
 * @param {ValueRange} range Its range on the device.
 * @returns {number} The value, in the units of the range, rounded.
 */
export function fromMatterHueOrSaturation(value: number, range: ValueRange): number {
  const fraction = clamp(value, { min: 0, max: maxMatterHueOrSaturation }) / maxMatterHueOrSaturation;
  return Math.round(range.min + fraction * (range.max - range.min));
}

/**
 * Get the range of colour temperatures of a light in mireds, as Matter takes them
 *
 * @param {ValueRange} kelvins The range of the light in K.
 * @returns {ValueRange} The range in mireds: the warmest end is the highest.
 */
export function toMiredsRange(kelvins: ValueRange): ValueRange {
  return { min: Math.ceil(1_000_000 / kelvins.max), max: Math.floor(1_000_000 / kelvins.min) };
}

/**
 * Convert a colour temperature to Matter
 *
 * Edge cases:
 *  - clamped to the range of the light
 *  - not a positive number -> null
 *
 * @param {ControlValue | undefined} value The colour temperature in K.
 * @param {ValueRange} kelvins The range of the light in K.
 * @returns {number | null} The colour temperature in mireds, or null.
 */
export function toMatterMireds(value: ControlValue | undefined, kelvins: ValueRange): number | null {
  const kelvin = toNumber(value);
  if (kelvin === null || kelvin <= 0) return null;
  return clamp(Math.round(1_000_000 / kelvin), toMiredsRange(kelvins));
}

/**
 * Convert a colour temperature of Matter to K
 *
 * Edge cases:
 *  - clamped to the range of the light; 0 mireds or less is its coldest end
 *
 * @param {number} mireds The colour temperature in mireds.
 * @param {ValueRange} kelvins The range of the light in K.
 * @returns {number} The colour temperature in K, rounded.
 */
export function fromMatterMireds(mireds: number, kelvins: ValueRange): number {
  if (mireds <= 0) return kelvins.max;
  return Math.round(clamp(1_000_000 / mireds, kelvins));
}

/**
 * Convert a colour of full brightness to its hue and saturation
 *
 * @param {RGB} rgb The colour, each channel 0 to 255.
 * @returns {HueSaturation} Its hue and saturation, as HSV takes them.
 */
function toHueSaturation(rgb: RGB): HueSaturation {
  const red = rgb.r / 255;
  const green = rgb.g / 255;
  const blue = rgb.b / 255;
  const max = Math.max(red, green, blue);
  const delta = max - Math.min(red, green, blue);
  if (delta === 0) return { hue: 0, saturation: 0 };
  let sector = (red - green) / delta + 4;
  if (max === red) sector = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) sector = (blue - red) / delta + 2;
  return { hue: Math.round(sector * 60) % 360, saturation: delta / max };
}

/**
 * Convert a hue and a saturation at full brightness to a colour
 *
 * @param {HueSaturation} color The hue and the saturation.
 * @returns {RGB} The colour, each channel 0 to 255.
 */
function toRgb(color: HueSaturation): RGB {
  const sector = (((color.hue % 360) + 360) % 360) / 60;
  const channel = (offset: number): number => {
    const position = (offset + sector) % 6;
    return Math.round(255 * (1 - color.saturation * Math.max(0, Math.min(position, 4 - position, 1))));
  };
  return { r: channel(5), g: channel(3), b: channel(1) };
}

/**
 * Convert a colour of Matter in x and y to a hue and a saturation
 *
 * @param {number} currentX The x of the colour in Matter, as a fraction of 65536.
 * @param {number} currentY The y of the colour in Matter, as a fraction of 65536.
 * @returns {HueSaturation} The hue and the saturation of the colour at full brightness.
 */
export function fromMatterXy(currentX: number, currentY: number): HueSaturation {
  // y is 0 only off the colours a light shows: the nearest one has a y of one step.
  return toHueSaturation(xyColorToRgbColor(currentX / 65536, Math.max(currentY, 1) / 65536));
}

/**
 * Convert a hue and a saturation to a colour of Matter in x and y
 *
 * Edge cases:
 *  - a colour with no saturation is white, the x and the y of a white of 6500 K
 *
 * @param {HueSaturation} color The hue and the saturation.
 * @returns {{ currentX: number; currentY: number }} The x and the y of the colour, as fractions of 65536, at most 65279.
 */
export function toMatterXy(color: HueSaturation): { currentX: number; currentY: number } {
  const { x, y } = rgbColorToXYColor(toRgb(color));
  const toCoordinate = (value: number): number => Math.min(Math.round(value * 65536), maxMatterColorCoordinate);
  return { currentX: toCoordinate(x), currentY: toCoordinate(y) };
}

/**
 * Get the hue and the saturation a light that shows only colours takes for a white of a colour temperature
 *
 * @param {number} kelvin The colour temperature in K.
 * @returns {HueSaturation} The hue and the saturation that come nearest.
 */
export function fromKelvin(kelvin: number): HueSaturation {
  return toHueSaturation(kelvinToRGB(kelvin));
}
