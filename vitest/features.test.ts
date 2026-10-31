/**
 * @file vitest/features.test.ts
 * @description This file contains the tests for what a device of the catalog can show in Matter.
 * @author Calvin Che
 */

import { MODEL_CATEGORIES as modelCategories, type TuyaDeviceEntry } from 'open-tuya';

import {
  createModelEntry,
  findCatalogEntry,
  findDeviceEntry,
  getDeviceFeatures,
  getEntrySupport,
  getProductName,
  labelControl,
  MODEL_CATEGORIES,
  pickSupportedEntry,
  readValue,
} from '../src/features.js';
import { entryOf, leakFile, lightFile, motionModel, multiSensorFile, plugFile, stripFile } from './fakeTuya.js';

describe('labelControl', () => {
  test('should name the power of a device Power', () => {
    for (const name of ['on', 'switch', 'power', 'mainSwitch', 'relay']) expect(labelControl(name)).toBe('Power');
  });

  test('should turn a camel case name with a number into words', () => {
    expect(labelControl('outlet2')).toBe('Outlet 2');
    expect(labelControl('switch12')).toBe('Switch 12');
    expect(labelControl('childLock')).toBe('Child Lock');
    expect(labelControl('cameraPrivacy')).toBe('Camera Privacy');
  });

  test('should spell USB in capitals and drop a Switch after it', () => {
    expect(labelControl('usb')).toBe('USB');
    expect(labelControl('usbSwitch')).toBe('USB');
    expect(labelControl('usb2')).toBe('USB 2');
  });
});

describe('getDeviceFeatures', () => {
  test('should give a plug one outlet and a meter in the units of the catalog', () => {
    const features = getDeviceFeatures(entryOf(plugFile));
    expect(features.outlets).toEqual([{ id: 'device.on', component: 'device', control: 'on', label: 'Power' }]);
    expect(features.sensors).toEqual([]);
    expect(features.meter).toEqual({
      power: { component: 'device', control: 'powerInW', unit: 'W' },
      voltage: { component: 'device', control: 'voltageInV', unit: 'V' },
      current: { component: 'device', control: 'currentInMilliamps', unit: 'mA' },
    });
    expect(features.battery).toBeUndefined();
  });

  test('should give a power strip an outlet for each socket and its child lock as a setting switch', () => {
    const features = getDeviceFeatures(entryOf(stripFile));
    expect(features.outlets.map((outlet) => outlet.label)).toEqual(['Outlet 1', 'Outlet 2', 'Outlet 3', 'Outlet 4', 'Outlet 5']);
    expect(features.settingSwitches).toEqual([{ id: 'device.childLock', component: 'device', control: 'childLock', label: 'Child Lock' }]);
    expect(features.meter).toBeUndefined();
  });

  test('should give a sensor each reading once, its battery and its indicator light', () => {
    const features = getDeviceFeatures(entryOf(multiSensorFile));
    expect(features.outlets).toEqual([]);
    expect(features.sensors.map((sensor) => [sensor.kind, sensor.control])).toEqual([
      ['temperature', 'temperature'],
      ['humidity', 'humidityInPercent'],
      ['illuminance', 'illuminanceInLux'],
      ['occupancy', 'occupancy'],
    ]);
    expect(features.sensors[0]).toMatchObject({ label: 'Temperature', unitFrom: 'temperatureUnit' });
    expect(features.sensors[1]).toMatchObject({ label: 'Humidity', unit: '%' });
    expect(features.battery).toEqual({ component: 'device', control: 'batteryInPercent' });
    expect(features.settingSwitches).toEqual([{ id: 'indicator.on', component: 'indicator', control: 'on', label: 'Indicator' }]);
  });

  test('should take a reading of moisture without a unit for a water leak', () => {
    const features = getDeviceFeatures(entryOf(leakFile));
    expect(features.sensors).toEqual([{ id: 'device.moisture', kind: 'waterLeak', label: 'Water Leak', component: 'device', control: 'moisture' }]);
  });

  test('should leave out a switch that is read-only, and give an entry without a device component nothing', () => {
    const entry: TuyaDeviceEntry = {
      name: 'Test',
      products: [],
      dataPoints: { '1': { type: 'boolean' }, '2': { type: 'boolean' } },
      components: {
        device: { on: { dataPoint: '1', kind: 'switch', readOnly: true }, keytone: { dataPoint: '2', kind: 'switch', category: 'diagnostic' } },
        backlight: { on: { dataPoint: '2', kind: 'switch', readOnly: true } },
      },
      source: { file: 'test.yaml', commit: '0' },
    };
    expect(getDeviceFeatures(entry)).toEqual({ outlets: [], settingSwitches: [], sensors: [] });
    expect(getDeviceFeatures({ ...entry, components: {} })).toEqual({ outlets: [], settingSwitches: [], sensors: [] });
  });

  test('should take the open door of a binary sensor as a contact, read from the catalog or from its type', () => {
    const entry: TuyaDeviceEntry = {
      name: 'Door',
      products: [],
      dataPoints: { '1': { type: 'boolean' }, '2': { type: 'string' } },
      components: {
        device: {
          door: { dataPoint: '1', kind: 'sensor', measures: 'door', readOnly: true },
          motion: { dataPoint: '2', kind: 'sensor', measures: 'motion', readOnly: true, otherwise: true },
          maximumTemperatureInC: { dataPoint: '1', kind: 'sensor', measures: 'temperature', unit: 'C' },
        },
      },
      source: { file: 'door.yaml', commit: '0' },
    };
    expect(getDeviceFeatures(entry).sensors.map((sensor) => sensor.kind)).toEqual(['occupancy', 'contact']);
  });
});

describe('getEntrySupport', () => {
  test('should support a plug, a strip and a sensor', () => {
    for (const file of [plugFile, stripFile, multiSensorFile, leakFile]) expect(getEntrySupport(entryOf(file))).toBe('supported');
  });

  test('should not support a light, nor a device with nothing to show', () => {
    expect(getEntrySupport(entryOf(lightFile))).toBe('otherKind');
    expect(getEntrySupport(entryOf('advwin_6l_petfeeder.yaml'))).toBe('noControls');
  });

  test('should pick the first entry the plugin supports', () => {
    expect(pickSupportedEntry([entryOf(lightFile), entryOf(plugFile)])?.source?.file).toBe(plugFile);
    expect(pickSupportedEntry([entryOf(lightFile)])).toBeUndefined();
  });
});

describe('catalog helpers', () => {
  test('should find an entry by its file, and nothing for a file it does not have', () => {
    expect(findCatalogEntry(plugFile)?.name).toBe('Energy monitoring smartplug');
    expect(findCatalogEntry('nothing.yaml')).toBeUndefined();
  });

  test('should name a product by its maker and its model, or by the entry', () => {
    const entry = entryOf(plugFile);
    expect(getProductName(entry, 'bWBb4e6BTZGie0Lv')).toBe('TopGreener TGWF115PRM');
    expect(getProductName(entry, '37mnhia3pojleqfh')).toBe('SP111-A');
    expect(getProductName(entry, 'other')).toBe('Energy monitoring smartplug');
  });

  test('should read the value of one control, and nothing for a control that is not reported', () => {
    const values = { device: { on: true } };
    expect(readValue(values, { component: 'device', control: 'on' })).toBe(true);
    expect(readValue(values, { component: 'device', control: 'off' })).toBeUndefined();
    expect(readValue(values, { component: 'light', control: 'on' })).toBeUndefined();
  });
});

describe('device models', () => {
  test('should build a motion sensor from its model, with its temperature and its battery', () => {
    const entry = createModelEntry(motionModel, 'pir');
    expect(entry?.name).toBe('Motion Sensor');
    expect(entry === undefined ? undefined : getEntrySupport(entry)).toBe('supported');
    const features = entry === undefined ? undefined : getDeviceFeatures(entry);
    expect(features?.sensors.map((sensor) => [sensor.kind, sensor.control, sensor.unit])).toEqual([
      ['temperature', 'temperatureInC', 'C'],
      ['occupancy', 'motion', undefined],
    ]);
    expect(features?.battery).toEqual({ component: 'device', control: 'batteryInPercent' });
  });

  test('should build nothing for a category the plugin does not name by a model, or a model it knows nothing of', () => {
    expect(createModelEntry(motionModel, 'dj')).toBeUndefined();
    // A plug's model knows its switches but not its meter: the catalog names it.
    expect(createModelEntry({ '1': { code: 'switch_1', type: 'boolean' } }, 'cz')).toBeUndefined();
    expect(createModelEntry(motionModel, 'toString')).toBeUndefined();
    expect(createModelEntry({ '1': { code: 'work_mode', type: 'enum' } }, 'pir')).toBeUndefined();
  });

  test('should name a product for each category open-tuya names by a model, and no other', () => {
    expect(Object.keys(MODEL_CATEGORIES).toSorted()).toEqual([...modelCategories].toSorted());
  });

  test('should find the entry of a stored device from its catalog file or from its model', () => {
    expect(findDeviceEntry({ catalogFile: plugFile })?.name).toBe('Energy monitoring smartplug');
    expect(findDeviceEntry({ model: motionModel, category: 'pir' })?.name).toBe('Motion Sensor');
    expect(findDeviceEntry({ model: motionModel })).toBeUndefined();
    expect(findDeviceEntry({})).toBeUndefined();
  });
});
