# Matterbridge Open Tuya changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - Unreleased

### Added

- [devices]: Control Tuya switches, plugs, power strips and sensors from Matter, built on open-tuya 0.3.0 and its device catalog: each outlet, the power and the energy of a device that measures them, the temperature, humidity, light, motion, contact and water leak sensors, the battery, and optional switches for settings such as the child lock and the light of the buttons.
- [devices]: Reach each device on the LAN first, found by the discovery or at a host given, and through the Tuya cloud otherwise, and the devices behind a gateway through the gateway.
- [setup]: Sign in by scanning a QR code with the Smart Life app, or with a cloud project of the Tuya developer platform.
- [setup]: Add the guided setup page: find the devices of the account, check each one, and choose its name and how it appears in Matter.
- [setup]: Name the controls of a sensor whose product the catalog does not list by the Tuya cloud's model of the device, before matching the catalog by its data points alone, which took a motion sensor for a water leak sensor.
