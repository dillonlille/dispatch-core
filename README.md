# Dispatch Core

Shared services and dashboard for Dispatch. This project owns the complete web
application, platform-owner features, API, SDK source, authentication/browser
coordination, host management and update coordination.

DSP runtime and plugin source belong to the separate `dispatch-dsp` project.
Each product builds independently, with explicit versioned dependency packages.
Every DSP retains its own installed code and private state.

- [Directory map](AGENTS.md)
- [Local development](DEVELOPMENT.md)
- [PR and release workflow](RELEASES.md)
- [Architecture and storage](docs/architecture.md)
- [Security policy](SECURITY.md)

This source is being prepared locally for repository creation. No repository,
release version, permanent preview deployment or production cutover is implied.
