/**
 * @file vitest/accessory/layout.test.ts
 * @description This file contains the tests for how the features of a device are laid out on its Matter endpoints.
 * @author Calvin Che
 */

import { getAccessoryLayout, listUnits } from '../../src/accessory/layout.js';
import { defaultExposure } from '../../src/config.js';
import { getDeviceFeatures } from '../../src/features.js';
import { entryOf, multiSensorFile, plugFile, stripFile } from '../fakeTuya.js';

describe('getAccessoryLayout', () => {
  test('should make the first outlet the device, with its meter, and code every feature by its place', () => {
    const layout = getAccessoryLayout(defaultExposure, getDeviceFeatures(entryOf(plugFile)));
    expect(layout?.main).toMatchObject({ type: 'outlet', code: '1', feature: { id: 'device.on' } });
    expect(layout?.sides).toEqual([]);
    expect(layout?.meter?.power?.unit).toBe('W');
    expect(layout?.isComposed).toBe(true);
  });

  test('should leave out the meter and the outlets hidden, and show the setting switches added', () => {
    const features = getDeviceFeatures(entryOf(stripFile));
    const layout = getAccessoryLayout(
      { hiddenFeatures: ['device.outlet1', 'device.outlet3', 'meter', 'nothing'], addedFeatures: ['device.childLock'], isComposed: false },
      features,
    );
    // The first outlet is the device, whatever is hidden.
    expect(layout?.main.feature.id).toBe('device.outlet1');
    expect(layout?.sides.map((unit) => [unit.feature.id, unit.code])).toEqual([
      ['device.outlet2', '2'],
      ['device.outlet4', '4'],
      ['device.outlet5', '5'],
      ['device.childLock', '6'],
    ]);
    expect(layout === undefined ? [] : listUnits(layout)).toHaveLength(5);
    expect(getAccessoryLayout({ ...defaultExposure, hiddenFeatures: ['meter'] }, getDeviceFeatures(entryOf(plugFile)))?.meter).toBeUndefined();
  });

  test('should make the first sensor the device of a sensor, with its battery', () => {
    const layout = getAccessoryLayout(defaultExposure, getDeviceFeatures(entryOf(multiSensorFile)));
    expect(layout?.main).toMatchObject({ type: 'sensor', feature: { kind: 'temperature' } });
    expect(layout?.sides.map((unit) => unit.feature.id)).toEqual(['device.humidityInPercent', 'device.illuminanceInLux', 'device.occupancy']);
    expect(layout?.battery?.control).toBe('batteryInPercent');
    expect(layout?.meter).toBeUndefined();
  });

  test('should lay out nothing for a device with no outlet and no sensor', () => {
    expect(getAccessoryLayout(defaultExposure, { outlets: [], sensors: [], settingSwitches: [] })).toBeUndefined();
    const settingOnly = { outlets: [], sensors: [], settingSwitches: [{ id: 'backlight.on', component: 'backlight', control: 'on', label: 'Backlight' }] };
    expect(getAccessoryLayout(defaultExposure, settingOnly)).toBeUndefined();
  });

  test('should show no meter on a device whose first unit is a sensor', () => {
    const features = getDeviceFeatures(entryOf(multiSensorFile));
    const layout = getAccessoryLayout(defaultExposure, { ...features, meter: { power: { component: 'device', control: 'powerInW', unit: 'W' } } });
    expect(layout?.meter).toBeUndefined();
  });
});
