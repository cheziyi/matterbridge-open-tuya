## Chip tests

The Matter CHIP conformance tests run against this plugin inside the `luligu/matterbridge:chip-test` container, driven by [scripts/run-chip-tests.mjs](./scripts/run-chip-tests.mjs) and configured by [chipTests.json](./chipTests.json). How the harness works is in [.agents/rules/chip-tests.instructions.md](./.agents/rules/chip-tests.instructions.md).

### What the configured tests cover

The plugin builds the Matter endpoints of a device from its catalog entry and the device list of a Tuya account, which needs an account signed in, and the container has none. `chipTests.json` therefore starts the plugin with no account and no devices, so the bridge exposes its root node and its aggregator alone, and the three generic tests check the composition, the conformance and the default warnings of that node. They cover none of the clusters of a device: see [Testing a device](#testing-a-device).

### Create and start the container (Linux, macOS, and Windows)

Run the `luligu/matterbridge:chip-test` docker image:

- frontend on port 8585
- plugin mapped to .
- container test logs directory mapped on ./temp directory

```shell
node scripts/run-chip-tests.mjs --start
```

### Run all configured tests inside the container

```shell
node scripts/run-chip-tests.mjs
```

### Manually run the tests inside the container

Open a shell in the container

```shell
docker exec -it chip-test bash
```

In the shell:

```bash
# Generic device composition and conformance
python3 src/python_testing/TC_DeviceBasicComposition.py
python3 src/python_testing/TC_DeviceConformance.py
python3 src/python_testing/TC_DefaultWarnings.py --bool-arg pixit_allow_default_vendor_id:true
```

### Stop the container

```shell
node scripts/run-chip-tests.mjs --stop
```

### Testing a device

The cluster tests need a device the container can reach: one of a Tuya account, on the network of the Docker host or through the Tuya cloud. The account is stored as the session or the cloud project the plugin signs in with, so sign in inside the container instead of writing the account into `chipTests.json`:

1. Start the container, open the Matterbridge frontend it serves at `http://localhost:8585` and open the setup page of the plugin from its row. Sign in and add the device, with the options to test. The plugin stores the account and the device in the configuration of the container, which `--start` writes over: add them again after each `--start`.
2. Read the endpoint numbers with the wildcard read of section 4 of the harness guide rather than counting: Matter numbers the endpoints in the order they are registered and keeps the numbers in the node storage afterwards. The plugin registers the main endpoint of a device first, then its other outlets, its other sensors and its setting switches, in the order of the catalog: see `getAccessoryLayout` in [src/accessory/layout.ts](./src/accessory/layout.ts). A composed device has those as child endpoints of the main one.
3. Add the tests to `chipTests.json` with `--endpoint` set accordingly, and a `chip:test:<cluster>` script to `package.json` for each cluster.

What a device exposes, so which clusters have tests to run, is in the README under [How it is built in Matter](./README.md#how-it-is-built-in-matter): On/Off on each outlet and setting switch (`OO`), Electrical Power and Electrical Energy Measurement with Power Topology on a device that measures them (`EPM`, `EEM`, `PWRTL`), Temperature, Relative Humidity and Illuminance Measurement, Occupancy Sensing and Boolean State on the sensors (`TMP`, `RH`, `ILL`, `OCC`, `BOOL`), Power Source on every device (`PS`) and Bridged Device Basic Information on every device (`BRBINFO`). Find the runnable YAML and Python tests of each with the two list commands of section 5 of the harness guide.
