/**
 * @file vitest/mapping.test.ts
 * @description This file contains the tests for the conversions between the values of a Tuya device and those of Matter.
 * @author Calvin Che
 */

/* oxlint-disable unicorn/no-useless-undefined */

import {
  composeDeviceName,
  toBoolean,
  toMatterBatteryPercent,
  toMatterHumidity,
  toMatterIlluminance,
  toMatterMeterReading,
  toMatterTemperature,
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
    expect(toBoolean(undefined)).toBeNull();
  });

  test('should join the name of a device and what an endpoint is in 32 characters, cutting the name', () => {
    expect(composeDeviceName('Desk', 'Outlet 2')).toBe('Desk Outlet 2');
    // The name is cut to leave room for the label, and the space it was cut at is dropped.
    expect(composeDeviceName('A very long name for a power strip', 'Outlet 2')).toBe('A very long name for a Outlet 2');
    expect(composeDeviceName('Desk', 'A label that is far too long to fit in 32')).toBe('A label that is far too long to ');
  });
});
