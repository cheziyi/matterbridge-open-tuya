/**
 * @file src/features.ts
 * @description This file contains what a device of the open-tuya catalog can show in Matter: its outlets, its setting switches, its sensors, its meter and its battery.
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

import { CATALOG, type ControlValue, type ControlValues, createDeviceEntry, type Measure, type TuyaControl, type TuyaDeviceEntry, type TuyaDeviceModel } from 'open-tuya';

/**
 * The components a device in reach of this plugin is made of: the device itself, and the lights of its buttons or its
 * display. A light, a fan, a thermostat or any other component makes a kind of device the plugin does not control yet.
 */
export const SUPPORTED_COMPONENTS = ['device', 'backlight', 'indicator', 'display', 'nightlight'] as const;

/** The readings that each get a sensor of their own in Matter. */
export const SENSOR_KINDS = ['temperature', 'humidity', 'illuminance', 'occupancy', 'contact', 'waterLeak'] as const;

/** A reading that gets a sensor of its own in Matter: one of `SENSOR_KINDS`. */
export type SensorKind = (typeof SENSOR_KINDS)[number];

/** Whether a catalog entry describes a device this plugin controls, or why not. */
export type EntrySupport = 'supported' | 'otherKind' | 'noControls';

/** Where a control is in the controls `readControls` gives: its component and its name. */
export interface ControlRef {
  component: string;
  control: string;
}

/** An on/off control of the device: an outlet, or a setting such as the light of its buttons. */
export interface SwitchFeature extends ControlRef {
  /** `<component>.<control>`, which tells the feature apart in the stored options. */
  id: string;
  /** What the switch is, such as `Outlet 2` or `Child Lock`. */
  label: string;
}

/** A reading that gets a sensor of its own. */
export interface SensorFeature extends ControlRef {
  id: string;
  kind: SensorKind;
  label: string;
  /** The unit the catalog gives the value in, such as `F` for a temperature. */
  unit?: string;
  /** The control of the same component whose value is the unit, on a device that switches its unit. */
  unitFrom?: string;
}

/** A reading of the meter of a device, and the unit the catalog gives it in. */
export interface MeterReading extends ControlRef {
  unit: string;
}

/** The meter of a device that measures what flows through it. */
export interface MeterFeature {
  /** In `W` or `kW`. */
  power?: MeterReading;
  /** In `V` or `mV`. */
  voltage?: MeterReading;
  /** In `A` or `mA`. */
  current?: MeterReading;
  /** The energy used so far, in `kWh` or `Wh`. */
  energy?: MeterReading;
}

/** What a device can show in Matter, as its catalog entry describes it. */
export interface DeviceFeatures {
  /** The controls of its main function that turn something on and off, in the order of the catalog. */
  outlets: SwitchFeature[];
  /** The on/off settings, such as a child lock or the light of its buttons: each offered as a switch, none shown unless chosen. */
  settingSwitches: SwitchFeature[];
  /** The readings that each get a sensor, one of each kind at most. */
  sensors: SensorFeature[];
  /** The meter, when the device measures the power, the voltage, the current or the energy that flows through it. */
  meter?: MeterFeature;
  /** The charge of its battery in percent, on a device that runs on one. */
  battery?: ControlRef;
}

/** The measures each sensor kind reads, a binary one detecting it and a numeric one in its unit. */
const sensorMeasures: Readonly<Record<SensorKind, { measures: readonly Measure[]; isBinary: boolean }>> = {
  temperature: { measures: ['temperature'], isBinary: false },
  humidity: { measures: ['humidity'], isBinary: false },
  illuminance: { measures: ['illuminance'], isBinary: false },
  occupancy: { measures: ['motion', 'occupancy', 'presence'], isBinary: true },
  contact: { measures: ['door', 'opening', 'window', 'garageDoor'], isBinary: true },
  waterLeak: { measures: ['moisture', 'water'], isBinary: true },
};

/** What each sensor kind is called, for the label of its endpoint. */
const sensorLabels: Readonly<Record<SensorKind, string>> = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  illuminance: 'Light',
  occupancy: 'Motion',
  contact: 'Contact',
  waterLeak: 'Water Leak',
};

/** The units the meter takes each reading in: a reading in another unit is left out. */
const meterUnits: Readonly<Record<keyof MeterFeature, readonly string[]>> = {
  power: ['W', 'kW'],
  voltage: ['V', 'mV'],
  current: ['A', 'mA'],
  energy: ['kWh', 'Wh'],
};

/** What each component that is a light of the device is called, for the label of its switch. */
const componentLabels: Readonly<Record<string, string>> = {
  backlight: 'Backlight',
  indicator: 'Indicator',
  display: 'Display',
  nightlight: 'Night Light',
};

// The control of one phase of three, a calibration or a limit, which no Matter reading stands for.
const sideReadingPattern = /Phase[ABC]|Calibration|^maximum|^minimum|^last/;

// The controls named after the device's power alone, which need no label of their own.
const powerNames = new Set(['on', 'switch', 'power', 'mainSwitch', 'relay']);

/**
 * Turn the name of a control into the words of a label
 *
 * Edge cases:
 *  - a name that is the device's power, such as `on` or `switch` -> `Power`
 *  - a number at the end gets a space before it: `outlet2` -> `Outlet 2`
 *  - `usb` -> `USB`, and a `Switch` that follows it is dropped
 *
 * @param {string} name The name of the control, in camel case, such as `childLock`.
 * @returns {string} The label, such as `Child Lock`.
 */
export function labelControl(name: string): string {
  if (powerNames.has(name)) return 'Power';
  const words = name
    .replace(/^usbSwitch/, 'usb')
    .replaceAll(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replaceAll(/(\d+)/g, ' $1')
    .split(' ')
    .filter((word) => word !== '');
  return words.map((word) => (word.toLowerCase() === 'usb' ? 'USB' : word.charAt(0).toUpperCase() + word.slice(1))).join(' ');
}

/**
 * Tell whether a control reads true or false, as a detector does
 *
 * @param {TuyaDeviceEntry} entry The entry the control is in.
 * @param {TuyaControl} control The control.
 * @returns {boolean} True when its data point is a boolean, or the catalog turns its raw values into booleans.
 */
function isBinaryControl(entry: TuyaDeviceEntry, control: TuyaControl): boolean {
  if (control.unit !== undefined) return false;
  if ((control.type ?? entry.dataPoints[control.dataPoint]?.type) === 'boolean') return true;
  return control.values?.some((mapping) => typeof mapping.value === 'boolean') === true || typeof control.otherwise === 'boolean';
}

/**
 * List the sensor controls of a component, those of the device's main function first
 *
 * @param {Readonly<Record<string, TuyaControl>>} controls The controls of the component.
 * @returns {[string, TuyaControl][]} The name and the control of each sensor, in the order of the catalog within each group.
 */
function listSensors(controls: Readonly<Record<string, TuyaControl>>): [string, TuyaControl][] {
  const sensors = Object.entries(controls).filter(([name, control]) => control.kind === 'sensor' && !sideReadingPattern.test(name));
  return [...sensors.filter(([, control]) => control.category === undefined), ...sensors.filter(([, control]) => control.category !== undefined)];
}

/**
 * Tell whether a catalog entry describes a device this plugin controls
 *
 * Edge cases:
 *  - a component outside `SUPPORTED_COMPONENTS`, such as a light or a fan -> `otherKind`
 *  - no outlet and no reading that gets a sensor -> `noControls`
 *
 * @param {TuyaDeviceEntry} entry The entry.
 * @returns {EntrySupport} `supported`, or why the plugin does not control the device.
 */
export function getEntrySupport(entry: TuyaDeviceEntry): EntrySupport {
  const components = Object.keys(entry.components);
  if (!components.every((name) => (SUPPORTED_COMPONENTS as readonly string[]).includes(name))) return 'otherKind';
  const features = getDeviceFeatures(entry);
  return features.outlets.length > 0 || features.sensors.length > 0 ? 'supported' : 'noControls';
}

/**
 * Pick the readings of the meter of a component
 *
 * @param {string} component The name of the component.
 * @param {[string, TuyaControl][]} sensors Its sensor controls, as `listSensors` gives them.
 * @returns {MeterFeature | undefined} The first reading of each measure in a unit the meter takes, or undefined when there is none.
 */
function pickMeter(component: string, sensors: [string, TuyaControl][]): MeterFeature | undefined {
  const meter: MeterFeature = {};
  for (const key of ['power', 'voltage', 'current', 'energy'] as const) {
    const found = sensors.find(([, control]) => control.measures === key && control.unit !== undefined && meterUnits[key].includes(control.unit));
    if (found?.[1].unit !== undefined) meter[key] = { component, control: found[0], unit: found[1].unit };
  }
  return Object.keys(meter).length > 0 ? meter : undefined;
}

/**
 * Work out what a device can show in Matter from its catalog entry
 *
 * The outlets are the switches of the device's main function, in its `device` component. The setting switches are its
 * other switches, those the catalog marks as changing how the device behaves, and the `on` switch of each component
 * that is a light of the device, such as its backlight. Each sensor kind takes the first reading of its measure, one
 * of the device's main function before a diagnostic one. A component outside `SUPPORTED_COMPONENTS` gives nothing.
 *
 * @param {TuyaDeviceEntry} entry The entry.
 * @returns {DeviceFeatures} The features, empty lists when there is none.
 */
export function getDeviceFeatures(entry: TuyaDeviceEntry): DeviceFeatures {
  const features: DeviceFeatures = { outlets: [], settingSwitches: [], sensors: [] };
  const device = entry.components.device ?? {};
  for (const [name, control] of Object.entries(device)) {
    if (control.kind !== 'switch' || control.readOnly === true) continue;
    const feature: SwitchFeature = { id: `device.${name}`, component: 'device', control: name, label: labelControl(name) };
    if (control.category === undefined) features.outlets.push(feature);
    else if (control.category === 'config') features.settingSwitches.push(feature);
  }
  for (const [component, label] of Object.entries(componentLabels)) {
    const control = entry.components[component]?.on;
    if (control?.kind === 'switch' && control.readOnly !== true) features.settingSwitches.push({ id: `${component}.on`, component, control: 'on', label });
  }
  const sensors = listSensors(device);
  for (const kind of SENSOR_KINDS) {
    const { measures, isBinary } = sensorMeasures[kind];
    const found = sensors.find(([, control]) => control.measures !== undefined && measures.includes(control.measures) && isBinaryControl(entry, control) === isBinary);
    if (found === undefined) continue;
    const [name, control] = found;
    const sensor: SensorFeature = { id: `device.${name}`, kind, label: sensorLabels[kind], component: 'device', control: name };
    if (control.unit !== undefined) sensor.unit = control.unit;
    if (control.unitFrom !== undefined) sensor.unitFrom = control.unitFrom;
    features.sensors.push(sensor);
  }
  const meter = pickMeter('device', sensors);
  if (meter !== undefined) features.meter = meter;
  const battery = sensors.find(([, control]) => control.measures === 'battery' && control.unit === '%');
  if (battery !== undefined) features.battery = { component: 'device', control: battery[0] };
  return features;
}

/**
 * Find a catalog entry by the tuya-local file it was converted from
 *
 * @param {string} file The `source.file` of the entry, such as `smartplugv1.yaml`.
 * @returns {TuyaDeviceEntry | undefined} The entry, or undefined when the catalog of this version has none from that file.
 */
export function findCatalogEntry(file: string): TuyaDeviceEntry | undefined {
  return CATALOG.find((entry) => entry.source?.file === file);
}

/**
 * The Tuya categories whose devices the plugin names by the cloud's model of the device, when the catalog does not
 * list their product, and the product name each is shown with: the sensors open-tuya's `MODEL_CATEGORIES` lists. The
 * model reads what a sensor is for, but not a plug's meter nor a heater's set point: a device of another category is
 * left to the catalog entry that names most of its data points.
 */
export const MODEL_CATEGORIES: Readonly<Record<string, string>> = {
  hps: 'Presence Sensor',
  mcs: 'Contact Sensor',
  pir: 'Motion Sensor',
  sj: 'Water Leak Sensor',
  wsdcg: 'Temperature and Humidity Sensor',
};

/**
 * Build the entry of a device from the cloud's model of it
 *
 * @param {TuyaDeviceModel} model The model.
 * @param {string | undefined} category The category the cloud lists the device in, such as `pir`.
 * @returns {TuyaDeviceEntry | undefined} The entry, or undefined for a category outside `MODEL_CATEGORIES`, or a model none of whose data points it knows.
 */
export function createModelEntry(model: TuyaDeviceModel, category: string | undefined): TuyaDeviceEntry | undefined {
  if (category === undefined || !Object.hasOwn(MODEL_CATEGORIES, category)) return undefined;
  return createDeviceEntry(model, { category, name: MODEL_CATEGORIES[category] });
}

/**
 * Find the entry the controls of a stored device are named by
 *
 * @param {{ catalogFile?: string; model?: TuyaDeviceModel; category?: string }} device The device.
 * @returns {TuyaDeviceEntry | undefined} The catalog entry from its file, or the entry built from its model, or undefined when this version has neither.
 */
export function findDeviceEntry(device: { catalogFile?: string; model?: TuyaDeviceModel; category?: string }): TuyaDeviceEntry | undefined {
  if (device.catalogFile !== undefined) return findCatalogEntry(device.catalogFile);
  return device.model === undefined ? undefined : createModelEntry(device.model, device.category);
}

/**
 * Pick the entry to name the controls of a device by, from the candidates the catalog gives
 *
 * @param {readonly TuyaDeviceEntry[]} entries The candidates, best first.
 * @returns {TuyaDeviceEntry | undefined} The best candidate the plugin controls, or undefined when it controls none.
 */
export function pickSupportedEntry(entries: readonly TuyaDeviceEntry[]): TuyaDeviceEntry | undefined {
  return entries.find((entry) => getEntrySupport(entry) === 'supported');
}

/**
 * Get the name a product is sold under, from the catalog entry of the device
 *
 * @param {TuyaDeviceEntry} entry The entry.
 * @param {string} productKey The product key of the device.
 * @returns {string} Such as `TopGreener TGWF115PRM`: the maker and the model of the product, or the name of the entry when the entry names neither.
 */
export function getProductName(entry: TuyaDeviceEntry, productKey: string): string {
  const product = entry.products.find((candidate) => candidate.productKey === productKey);
  const name = [product?.manufacturer, product?.model].filter((part) => part !== undefined).join(' ');
  return name === '' ? entry.name : name;
}

/**
 * Read the value of one control from the controls a device reports
 *
 * @param {ControlValues} values The controls, as `readControls` or `onControls` gives them.
 * @param {ControlRef} ref Where the control is.
 * @returns {ControlValue | undefined} Its value, or undefined when the controls do not carry it.
 */
export function readValue(values: ControlValues, ref: ControlRef): ControlValue | undefined {
  return values[ref.component]?.[ref.control];
}
