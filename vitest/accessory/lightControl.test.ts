/**
 * @file vitest/accessory/lightControl.test.ts
 * @description This file contains the tests for what a Matter controller asks of a light, as the controls of the Tuya device.
 * @author Calvin Che
 */

import { ColorControl } from 'matterbridge/matter/clusters';

import { getLightControls, type LightChange, type MatterLightState } from '../../src/accessory/lightControl.js';
import { getDeviceFeatures, type LightFeature } from '../../src/features.js';
import { colorBulbFile, entryOf, pathLightsFile, whiteBulbFile } from '../fakeTuya.js';

/**
 * Get the first light of a catalog entry
 *
 * @param {string} file The tuya-local file of the entry.
 * @returns {LightFeature} The light.
 * @throws {Error} When the entry has no light.
 */
function lightOf(file: string): LightFeature {
  const [light] = getDeviceFeatures(entryOf(file)).lights;
  if (light === undefined) throw new Error(`No light in ${file}`);
  return light;
}

/**
 * Build what the endpoint of a light holds
 *
 * @param {Partial<MatterLightState>} overrides The attributes to replace.
 * @returns {MatterLightState} The state: on at full level, a red hue in hue and saturation.
 */
function stateOf(overrides: Partial<MatterLightState> = {}): MatterLightState {
  return {
    isOn: true,
    level: 254,
    colorMode: ColorControl.ColorMode.CurrentHueAndCurrentSaturation,
    hue: 0,
    saturation: 254,
    mireds: 250,
    currentX: null,
    currentY: null,
    ...overrides,
  };
}

const changes = (...list: LightChange[]): ReadonlySet<LightChange> => new Set(list);

/** A light with a colour of no brightness of its own and no mode, and no white: it always shows its colour. */
const colorOnly: LightFeature = {
  id: 'light.on',
  component: 'light',
  control: 'on',
  label: 'Light',
  color: { hue: { control: 'hue', min: 0, max: 360 }, saturation: { control: 'saturation', min: 0, max: 1000 } },
};

describe('getLightControls', () => {
  const bulb = lightOf(colorBulbFile);
  const white = { light: { colorMode: 'color_temp' } };
  const colored = { light: { colorMode: 'hs' } };

  test('should switch the light and set the brightness of its white', () => {
    expect(getLightControls(bulb, stateOf({ isOn: false, level: 128 }), changes('onOff', 'level'), white)).toEqual({ on: false, brightness: 507 });
  });

  test('should set the brightness of the colour while the light shows its colour', () => {
    expect(getLightControls(bulb, stateOf({ level: 1 }), changes('level'), colored)).toEqual({ colorBrightness: 0 });
  });

  test('should turn to the colour, with the brightness of the level, from a hue and a saturation', () => {
    expect(getLightControls(bulb, stateOf({ hue: 127, saturation: 127, level: 254 }), changes('color', 'level'), white)).toEqual({
      colorMode: 'hs',
      hue: 180,
      saturation: 500,
      colorBrightness: 1000,
    });
  });

  test('should turn to the colour from x and y', () => {
    const controls = getLightControls(bulb, stateOf({ colorMode: ColorControl.ColorMode.CurrentXAndCurrentY, currentX: 45_000, currentY: 19_000 }), changes('color'), white);
    expect(controls).toMatchObject({ colorMode: 'hs', colorBrightness: 1000 });
    expect(controls.saturation).toBeGreaterThan(500);
  });

  test('should turn to the white of a colour temperature, and set the brightness of the white', () => {
    const state = stateOf({ colorMode: ColorControl.ColorMode.ColorTemperatureMireds, mireds: 250, level: 254 });
    expect(getLightControls(bulb, state, changes('color', 'level'), colored)).toEqual({ colorMode: 'color_temp', colorTemperatureInK: 4000, brightness: 1000 });
  });

  test('should set the colour temperature of a light with no mode', () => {
    const state = stateOf({ colorMode: ColorControl.ColorMode.ColorTemperatureMireds, mireds: 370 });
    expect(getLightControls(lightOf(whiteBulbFile), state, changes('color'), {})).toEqual({ colorTemperatureInK: 2703 });
  });

  test('should turn a light with a white of no colour temperature to its white', () => {
    const state = stateOf({ colorMode: ColorControl.ColorMode.ColorTemperatureMireds, mireds: 250 });
    expect(getLightControls(lightOf(pathLightsFile), state, changes('color'), colored)).toEqual({ colorMode: 'white' });
  });

  test('should show the colour nearest to a white on a light that shows only colours', () => {
    const state = stateOf({ colorMode: ColorControl.ColorMode.ColorTemperatureMireds, mireds: 500 });
    const controls = getLightControls(colorOnly, state, changes('color', 'level'), {});
    expect(Object.keys(controls)).toEqual(['hue', 'saturation']);
    expect(controls.hue).toBeLessThan(40);
  });

  test('should set nothing for a change the endpoint holds no value for', () => {
    expect(getLightControls(bulb, stateOf({ colorMode: ColorControl.ColorMode.ColorTemperatureMireds, mireds: null }), changes('color'), white)).toEqual({});
    expect(getLightControls(bulb, stateOf({ colorMode: ColorControl.ColorMode.CurrentXAndCurrentY }), changes('color'), white)).toEqual({});
    expect(getLightControls(bulb, stateOf({ hue: null }), changes('color'), white)).toEqual({});
    expect(getLightControls(bulb, stateOf({ level: null }), changes('level'), white)).toEqual({});
    expect(getLightControls(colorOnly, stateOf(), changes('level'), {})).toEqual({});
  });

  test('should set no colour on a light without one, and the brightness of a light of a colour only from its colour', () => {
    expect(getLightControls(lightOf(whiteBulbFile), stateOf(), changes('color'), {})).toEqual({});
    const dim: LightFeature = {
      ...colorOnly,
      color: { hue: { control: 'hue', min: 0, max: 360 }, saturation: { control: 'saturation', min: 0, max: 1000 }, brightness: { control: 'colorBrightness', min: 0, max: 255 } },
    };
    expect(getLightControls(dim, stateOf({ level: 254 }), changes('level'), {})).toEqual({ colorBrightness: 255 });
    expect(getLightControls(dim, stateOf({ level: null }), changes('color'), {})).toMatchObject({ colorBrightness: 255 });
  });
});
