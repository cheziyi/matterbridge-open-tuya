/**
 * @file src/accessory/endpoints.ts
 * @description This file contains the creation of the Matter endpoints of a Tuya device.
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

import {
  bridgedNode,
  contactSensor,
  type DeviceTypeDefinition,
  electricalSensor,
  humiditySensor,
  lightSensor,
  MatterbridgeEndpoint,
  occupancySensor,
  onOffPlugInUnit,
  powerSource,
  temperatureSensor,
  waterLeakDetector,
} from 'matterbridge';
import { CommonNumberTag } from 'matterbridge/matter';
import { BridgedDeviceBasicInformation, PowerSource } from 'matterbridge/matter/clusters';
import type { Semtag } from 'matterbridge/matter/types';

import { maxDeviceNameLength } from '../config.js';
import type { SensorKind } from '../features.js';
import { composeDeviceName } from '../mapping.js';
import type { EndpointIds } from '../platform/endpointIds.js';
import type { AccessoryLayout, LayoutUnit } from './layout.js';

const vendorName = 'Tuya';

/** The longest product name Matter takes. */
const maxProductNameLength = 32;

/** What every endpoint of a device says about the device it belongs to. */
export interface EndpointIdentity {
  /** The name the user gave the device: the label of the device in Matter, which is what the Matter apps show. */
  label: string;
  /** The device ID, which neither a new name nor a new address changes. */
  serial: string;
  /** The name the product is sold under, such as `TopGreener TGWF115PRM`, as the catalog gives it: shown as the product name, and kept out of the unique id, which the catalog must not change. */
  productName: string;
  /** The vendor id of the bridge, used for the bridged device information. */
  vendorId: number;
  /** The endpoint ids of the device, which give an endpoint that comes back after it was taken away a new id. */
  ids: EndpointIds;
}

/** What each endpoint beside the main one is, such as `Outlet 2`, for the endpoints that are devices of their own in Matter. */
const labels = new WeakMap<MatterbridgeEndpoint, string>();

/** The product name every endpoint is made with, which the unique id is made from: see `createBasicInformation`. */
const stableProductName = `${vendorName} device`;

/** The device type of each sensor kind. */
const sensorDeviceTypes: Readonly<Record<SensorKind, DeviceTypeDefinition>> = {
  temperature: temperatureSensor,
  humidity: humiditySensor,
  illuminance: lightSensor,
  occupancy: occupancySensor,
  contact: contactSensor,
  waterLeak: waterLeakDetector,
};

/**
 * Get the name of a device in Matterbridge, which never changes
 *
 * Matterbridge derives the unique id of a bridged device from its name, which the Matter apps use to tell a device they
 * know from a new one. The name is therefore made of the device ID, and the name the user gives the device is its
 * label: see `getDeviceLabel`.
 *
 * @param {string} serial The device ID.
 * @returns {string} The name, such as `Tuya bf1234567890abcdefgh`.
 */
export function getDeviceName(serial: string): string {
  return `${vendorName} ${serial}`;
}

/**
 * Get the label of an endpoint of a device, which the Matter apps show as its name: the name the user gave the device,
 * followed by what the endpoint is when it is not the main endpoint
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint: the main endpoint, or a device of its own beside it.
 * @param {string} name The name the user gave the device.
 * @returns {string} The label, of at most 32 characters.
 */
export function getDeviceLabel(endpoint: MatterbridgeEndpoint, name: string): string {
  const label = labels.get(endpoint);
  return label === undefined ? name.slice(0, maxDeviceNameLength) : composeDeviceName(name, label);
}

/**
 * Write the name the user gave a device to the endpoints that are devices of their own in Matter
 *
 * @param {readonly MatterbridgeEndpoint[]} endpoints The endpoints: the main endpoint, and the devices of their own beside it.
 * @param {string} name The name the user gave the device.
 * @returns {Promise<void>} Resolves when every label is written.
 */
export async function applyDeviceLabel(endpoints: readonly MatterbridgeEndpoint[], name: string): Promise<void> {
  for (const endpoint of endpoints) await endpoint.updateAttribute(BridgedDeviceBasicInformation, 'nodeLabel', getDeviceLabel(endpoint, name));
}

/**
 * Create the bridged device basic information of an endpoint, with the product name it shows
 *
 * Matterbridge makes the unique id of a bridged device, which the Matter apps use to tell a device they know from a new
 * one, from its name, its serial number, its vendor name and its product name. The product name the catalog gives can
 * change with a release of the catalog, or with another entry chosen for the device: the unique id is made with one
 * that never changes, and the product name shown is written afterwards.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint, with no bridged device basic information yet.
 * @param {string} name The name of the endpoint in Matterbridge, which never changes.
 * @param {string} serial The serial number of the endpoint, which never changes.
 * @param {number} vendorId The vendor id of the bridge.
 * @param {string} productName The product name to show, cut to the 32 characters Matter takes.
 * @returns {MatterbridgeEndpoint} The endpoint.
 */
function createBasicInformation(endpoint: MatterbridgeEndpoint, name: string, serial: string, vendorId: number, productName: string): MatterbridgeEndpoint {
  endpoint.createDefaultBridgedDeviceBasicInformationClusterServer(name, serial, vendorId, vendorName, stableProductName);
  const shown = productName.slice(0, maxProductNameLength);
  endpoint.productName = shown;
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the bridged device basic information was just created
  endpoint.getClusterServerOptions(BridgedDeviceBasicInformation)!.productName = shown;
  return endpoint;
}

/**
 * Give an endpoint its label from the start, before it is active
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint, with its bridged device basic information created.
 * @param {EndpointIdentity} identity The device the endpoint belongs to.
 * @param {string} [label] What the endpoint is, such as `Outlet 2`, for a device of its own beside the main endpoint.
 * @returns {MatterbridgeEndpoint} The endpoint.
 */
function setInitialLabel(endpoint: MatterbridgeEndpoint, identity: EndpointIdentity, label?: string): MatterbridgeEndpoint {
  if (label !== undefined) labels.set(endpoint, label);
  // oxlint-disable-next-line typescript/no-non-null-assertion -- the bridged device basic information was just created
  endpoint.getClusterServerOptions(BridgedDeviceBasicInformation)!.nodeLabel = getDeviceLabel(endpoint, identity.label);
  return endpoint;
}

/**
 * Get the device type of the endpoint of a unit
 *
 * An outlet and a setting switch are an outlet: the on/off device type every Matter app shows.
 *
 * @param {LayoutUnit} unit The unit.
 * @returns {DeviceTypeDefinition} The device type.
 */
function getDeviceType(unit: LayoutUnit): DeviceTypeDefinition {
  return unit.type === 'sensor' ? sensorDeviceTypes[unit.feature.kind] : onOffPlugInUnit;
}

/**
 * Get what tells the endpoint of a unit apart in its endpoint id
 *
 * @param {LayoutUnit} unit The unit.
 * @returns {string} Such as `device-outlet2`: the component and the control of its feature.
 */
function getUnitKey(unit: LayoutUnit): string {
  return `${unit.feature.component}-${unit.feature.control}`;
}

/**
 * Add the clusters of the device type of a unit
 *
 * Every sensor shows no reading until the first read: a contact sensor shows closed, a water leak detector no leak and
 * an occupancy sensor no one.
 *
 * @param {MatterbridgeEndpoint} endpoint The endpoint.
 * @param {LayoutUnit} unit The unit.
 * @returns {void}
 */
function addUnitClusters(endpoint: MatterbridgeEndpoint, unit: LayoutUnit): void {
  if (unit.type !== 'sensor') {
    // An outlet takes the on/off with the lighting feature, which Matter requires of it.
    endpoint.createDefaultOnOffClusterServer(false);
    return;
  }
  const kind = unit.feature.kind;
  if (kind === 'temperature') endpoint.createDefaultTemperatureMeasurementClusterServer(null);
  else if (kind === 'humidity') endpoint.createDefaultRelativeHumidityMeasurementClusterServer(null);
  else if (kind === 'illuminance') endpoint.createDefaultIlluminanceMeasurementClusterServer(null);
  else if (kind === 'occupancy') endpoint.createDefaultOccupancySensingClusterServer(false);
  else if (kind === 'contact') endpoint.createDefaultBooleanStateClusterServer(true);
  else endpoint.createDefaultBooleanStateClusterServer(false);
}

/**
 * Create the main endpoint of a device: its first outlet, or its first sensor
 *
 * A device that measures what flows through its outlet is also an electrical sensor, with its power and its energy.
 * A device that runs on a battery has its charge as its power source, any other is wired.
 *
 * @param {EndpointIdentity} identity The device the endpoint belongs to.
 * @param {AccessoryLayout} layout How the features of the device are laid out.
 * @returns {MatterbridgeEndpoint} The endpoint, with its clusters and nothing subscribed yet.
 */
export function createMainEndpoint(identity: EndpointIdentity, layout: AccessoryLayout): MatterbridgeEndpoint {
  const deviceTypes = [getDeviceType(layout.main), ...(layout.meter === undefined ? [] : [electricalSensor]), bridgedNode, powerSource] as [
    DeviceTypeDefinition,
    ...DeviceTypeDefinition[],
  ];
  const endpoint = createBasicInformation(
    new MatterbridgeEndpoint(deviceTypes, { id: identity.ids.resolve(identity.serial) }).createDefaultIdentifyClusterServer(),
    getDeviceName(identity.serial),
    identity.serial,
    identity.vendorId,
    identity.productName,
  );
  if (layout.battery === undefined) endpoint.createDefaultPowerSourceWiredClusterServer();
  else endpoint.createDefaultPowerSourceBatteryClusterServer(null, PowerSource.BatChargeLevel.Ok, null);
  setInitialLabel(endpoint, identity);
  addUnitClusters(endpoint, layout.main);
  if (layout.meter !== undefined) {
    endpoint.createDefaultPowerTopologyClusterServer().createDefaultElectricalPowerMeasurementClusterServer();
    if (layout.meter.energy !== undefined) endpoint.createImportedElectricalEnergyMeasurementClusterServer();
  }
  return endpoint.addRequiredClusters();
}

/**
 * Create an endpoint of a device beside its main endpoint, as a device of its own
 *
 * @param {EndpointIdentity} identity The device the endpoint belongs to.
 * @param {LayoutUnit} unit What the endpoint shows.
 * @returns {MatterbridgeEndpoint} The endpoint.
 */
function createExtraEndpoint(identity: EndpointIdentity, unit: LayoutUnit): MatterbridgeEndpoint {
  const { label } = unit.feature;
  const endpoint = createBasicInformation(
    new MatterbridgeEndpoint([getDeviceType(unit), bridgedNode, powerSource], {
      id: identity.ids.resolve(`${identity.serial}-${getUnitKey(unit)}`),
    }).createDefaultIdentifyClusterServer(),
    `${getDeviceName(identity.serial)} ${label}`,
    `${identity.serial}-${unit.code}`.slice(0, maxDeviceNameLength),
    identity.vendorId,
    `${vendorName} ${label}`,
  ).createDefaultPowerSourceWiredClusterServer();
  return setInitialLabel(endpoint, identity, label);
}

/**
 * Tag the next part of a main endpoint
 *
 * Matter wants the parts of one device that have the same device type told apart by their tags, so each part gets a
 * number: its place among the parts of its device type, in the order they are created. The tag carries what the part is
 * as its label, for the Matter apps that show it.
 *
 * @param {MatterbridgeEndpoint} main The main endpoint the part is a part of.
 * @param {DeviceTypeDefinition} deviceType The device type of the part.
 * @param {string} label What the part is, such as `Outlet 2`.
 * @returns {Semtag} The tag.
 */
function getNumberTag(main: MatterbridgeEndpoint, deviceType: DeviceTypeDefinition, label: string): Semtag {
  const count = main.getChildEndpoints().filter((part) => part.deviceTypes.has(deviceType.code)).length;
  // In the namespace of the numbers, the tag of a number is the number itself.
  return { ...CommonNumberTag.One, tag: count + 1, label };
}

/**
 * Create the endpoint of a unit beside the main one, as a part of it or as a device of its own
 *
 * A part has no name and no serial number: in Matter those are of the device, which is the main endpoint. It moves
 * between the rooms of a Matter app with it, and is unreachable when it is.
 *
 * @param {EndpointIdentity} identity The device the endpoint belongs to.
 * @param {LayoutUnit} unit What the endpoint shows.
 * @param {MatterbridgeEndpoint} [main] The main endpoint the endpoint is a part of. Left out, the endpoint is a device of its own.
 * @returns {MatterbridgeEndpoint} The endpoint, with its clusters and nothing subscribed yet.
 */
export function createSideEndpoint(identity: EndpointIdentity, unit: LayoutUnit, main?: MatterbridgeEndpoint): MatterbridgeEndpoint {
  const deviceType = getDeviceType(unit);
  const endpoint =
    main === undefined
      ? createExtraEndpoint(identity, unit)
      : main
          .addChildDeviceType(identity.ids.resolve(getUnitKey(unit)), deviceType, { tagList: [getNumberTag(main, deviceType, unit.feature.label)] })
          .createDefaultIdentifyClusterServer();
  addUnitClusters(endpoint, unit);
  return endpoint.addRequiredClusters();
}
