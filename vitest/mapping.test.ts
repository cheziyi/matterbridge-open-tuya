/**
 * @file vitest/mapping.test.ts
 * @description This file contains the tests for the conversions between the values of a Tuya device and those of Matter.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import {
  composeDeviceName,
  fromKelvin,
  fromMatterHueOrSaturation,
  fromMatterLevel,
  fromMatterMireds,
  fromMatterXy,
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
  toMiredsRange,
  toNumber,
} from '../src/mapping.js';

describe('mapping', () => {
  test('should read a finite number, and nothing else', () => {
    expect(toNumber(21.5)).toBe(21.5);
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber('21')).toBeNull();
    expect(toNumber(undefined)).toBeNull();
  });

  test('should convert a temperature in °C or °F to hundredths of a degree Celsius', () => {
    expect(toMatterTemperature(21.5)).toBe(2150);
    expect(toMatterTemperature(21.5, 'C')).toBe(2150);
    expect(toMatterTemperature(212, 'F')).toBe(10_000);
    expect(toMatterTemperature(32, 'fahrenheit')).toBe(0);
    expect(toMatterTemperature('warm')).toBeNull();
  });

  test('should convert a humidity to hundredths of a percent, within 0 to 100 %', () => {
    expect(toMatterHumidity(45)).toBe(4500);
    expect(toMatterHumidity(120)).toBe(10_000);
    expect(toMatterHumidity(-5)).toBe(0);
    expect(toMatterHumidity(undefined)).toBeNull();
  });

  test('should convert an illuminance in lux to the logarithmic value of Matter', () => {
    expect(toMatterIlluminance(1)).toBe(1);
    expect(toMatterIlluminance(1000)).toBe(30_001);
    expect(toMatterIlluminance(0)).toBe(0);
    expect(toMatterIlluminance(-1)).toBe(0);
    expect(toMatterIlluminance(1e10)).toBe(0xfffe);
    expect(toMatterIlluminance(0.5)).toBe(1);
    expect(toMatterIlluminance(true)).toBeNull();
  });

  test('should convert a reading of the meter to milliwatts, millivolts, milliamps and milliwatt hours', () => {
    expect(toMatterMeterReading(12.3, 'W')).toBe(12_300);
    expect(toMatterMeterReading(1.5, 'kW')).toBe(1_500_000);
    expect(toMatterMeterReading(230.5, 'V')).toBe(230_500);
    expect(toMatterMeterReading(230_500, 'mV')).toBe(230_500);
    expect(toMatterMeterReading(0.25, 'A')).toBe(250);
    expect(toMatterMeterReading(250, 'mA')).toBe(250);
    expect(toMatterMeterReading(2.5, 'kWh')).toBe(2_500_000);
    expect(toMatterMeterReading(2.5, 'Wh')).toBe(2500);
    expect(toMatterMeterReading(1, 'kvar')).toBeNull();
    expect(toMatterMeterReading('1', 'W')).toBeNull();
  });

  test('should convert the charge of a battery to half percent, within 0 to 100 %', () => {
    expect(toMatterBatteryPercent(85)).toBe(170);
    expect(toMatterBatteryPercent(150)).toBe(200);
    expect(toMatterBatteryPercent(-1)).toBe(0);
    expect(toMatterBatteryPercent('low')).toBeNull();
  });

  test('should read a value as on or off', () => {
    expect(toBoolean(true)).toBe(true);
    expect(toBoolean(false)).toBe(false);
    expect(toBoolean(1)).toBe(true);
    expect(toBoolean(0)).toBe(false);
    for (const text of ['true', ' ON ', 'open', '1']) expect(toBoolean(text)).toBe(true);
    expect(toBoolean('closed')).toBe(false);
  });

  test('should join the name of a device and what an endpoint is in 32 characters, cutting the name', () => {
    expect(composeDeviceName('Desk', 'Outlet 2')).toBe('Desk Outlet 2');
    // The name is cut to leave room for the label, and the space it was cut at is dropped.
    expect(composeDeviceName('A very long name for a power strip', 'Outlet 2')).toBe('A very long name for a Outlet 2');
    expect(composeDeviceName('Desk', 'A label that is far too long to fit in 32')).toBe('A label that is far too long to ');
  });

  test('should stretch the brightness of a light over the levels of Matter, both ways', () => {
    const range = { min: 10, max: 1000 };
    expect(toMatterLevel(10, range)).toBe(1);
    expect(toMatterLevel(1000, range)).toBe(254);
    expect(toMatterLevel(505, range)).toBe(128);
    expect(toMatterLevel(5000, range)).toBe(254);
    expect(toMatterLevel('bright', range)).toBeNull();
    expect(fromMatterLevel(1, range)).toBe(10);
    expect(fromMatterLevel(254, range)).toBe(1000);
    expect(fromMatterLevel(0, range)).toBe(10);
    expect(fromMatterLevel(128, range)).toBe(507);
  });

  test('should stretch a hue or a saturation over 0 to 254, both ways', () => {
    expect(toMatterHueOrSaturation(180, { min: 0, max: 360 })).toBe(127);
    expect(toMatterHueOrSaturation(1000, { min: 0, max: 1000 })).toBe(254);
    expect(toMatterHueOrSaturation(-5, { min: 0, max: 1000 })).toBe(0);
    expect(toMatterHueOrSaturation(undefined, { min: 0, max: 1000 })).toBeNull();
    expect(fromMatterHueOrSaturation(127, { min: 0, max: 360 })).toBe(180);
    expect(fromMatterHueOrSaturation(300, { min: 0, max: 1000 })).toBe(1000);
  });

  test('should convert a colour temperature between K and mireds, within the range of the light', () => {
    const kelvins = { min: 2700, max: 6500 };
    expect(toMiredsRange(kelvins)).toEqual({ min: 154, max: 370 });
    expect(toMatterMireds(4000, kelvins)).toBe(250);
    expect(toMatterMireds(2000, kelvins)).toBe(370);
    expect(toMatterMireds(0, kelvins)).toBeNull();
    expect(toMatterMireds('warm', kelvins)).toBeNull();
    expect(fromMatterMireds(250, kelvins)).toBe(4000);
    expect(fromMatterMireds(500, kelvins)).toBe(2700);
    expect(fromMatterMireds(0, kelvins)).toBe(6500);
  });

  test('should turn a hue and a saturation into x and y, and back', () => {
    const red = toMatterXy({ hue: 0, saturation: 1 });
    expect(red.currentX).toBeGreaterThan(40_000);
    expect(fromMatterXy(red.currentX, red.currentY)).toMatchObject({ hue: 0 });
    const green = toMatterXy({ hue: 120, saturation: 1 });
    expect(fromMatterXy(green.currentX, green.currentY).hue).toBe(120);
    const blue = toMatterXy({ hue: 240, saturation: 1 });
    expect(fromMatterXy(blue.currentX, blue.currentY).hue).toBe(240);
    const magenta = toMatterXy({ hue: 300, saturation: 1 });
    expect(fromMatterXy(magenta.currentX, magenta.currentY).hue).toBeCloseTo(300, -1);
    expect(fromMatterXy(magenta.currentX, magenta.currentY).saturation).toBeGreaterThan(0.9);
    expect(toMatterXy({ hue: -60, saturation: 0 })).toEqual(toMatterXy({ hue: 300, saturation: 0 }));
    expect(fromMatterXy(0, 0).saturation).toBeGreaterThanOrEqual(0);
  });

  test('should give the colour nearest to a white of a colour temperature', () => {
    expect(fromKelvin(6600)).toEqual({ hue: 0, saturation: 0 });
    const warm = fromKelvin(2700);
    expect(warm.hue).toBeGreaterThan(20);
    expect(warm.hue).toBeLessThan(40);
    expect(warm.saturation).toBeGreaterThan(0.4);
  });
});
