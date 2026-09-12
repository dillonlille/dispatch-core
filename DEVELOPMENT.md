# Core development

Requires Node 22 or 24, npm, Python 3 and Linux `flock` for lifecycle tests.
The complete shared dashboard and platform owner features live here. DSP plugin
source and its compiler are in a separate project; Core consumes metadata and
runs installed packages through authenticated, DSP-scoped services.

From this repository:

```sh
npm run bootstrap -- /absolute/build/platform-packages
npm run check
npm test
npm run build -- /absolute/build/core-candidate
npm run export -- /absolute/build/core-source
```

Bootstrap creates three versioned packages (SDK, protocol and runtime kit),
installs real copies into `node_modules`, and installs the dashboard's locked
compiler dependencies. Output directories must be new and outside the source.
A build produces an immutable **development** candidate with `release.json`,
file hashes and dependency versions. It does not publish or activate anything.
The root version `0.0.0` is an unreleased placeholder.

DSP bootstrap consumes the platform package bundle, including its standalone
`install.cjs`. The shared packages are supplied as release artifacts when GitHub
is configured. No sibling source checkout or private host configuration is needed.

For integration tests, install an explicit exported DSP test fixture:

```sh
node tooling/integration-package.js /absolute/dsp-source-export . /absolute/build/platform-packages
npm run test:integration
```

The fixture is a development dependency only. Native acceptance also needs an
isolated Linux lab with systemd namespace permissions, sealed Node/tini tools and,
for authentication acceptance, a sealed browser. Set `DISPATCH_WORKER_TEST_TOOLS`
to the private Node/tini bundle, then run the selected `tests/architecture/*.acceptance.js`
with Node's test runner. Never use a real DSP or provider credentials.

Create and preview a plugin with the Core development runner:

```sh
bin/dispatch create plugin sample-notes
bin/dispatch plugin dev /absolute/plugin/source
```

Run that command from a DSP project or explicit plugin workspace. The runner
builds a sealed package and starts a separate API/dashboard with two synthetic
DSPs, persisted independently. Stop it with Ctrl+C. Output belongs outside source;
`prepareDevelopment(pluginPath, buildPath)` supports an explicit output root.

`tooling/tests.json` separates standalone unit coverage from cross-product
integration coverage. Older native/OCI restore fixtures remain beside their
components and are selected explicitly when changing compatibility code.
Historical monolithic release automation has been retired from these repositories.
See `RELEASES.md` for the human-approved branch, PR and release workflow.
