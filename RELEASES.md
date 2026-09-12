# Repository and release workflow

Core and DSP are separate repositories, release versions and installation tracks.
The SDK is developed in Core but distributed as a versioned dependency artifact.
Updating Core never rewrites an installed DSP's runtime, plugins or SDK copies.

1. Create a feature branch and develop there.
2. Run applicable checks and open a PR against `main`.
3. Present the PR URL, changes, verified commit and test results in chat.
4. Wait for the user's explicit chat approval before merging that PR. Recheck the
   approved commit and required checks immediately before merging.
5. Only when the user says **prepare a release**, inspect the latest merged main,
   report the currently published and deployed versions for the selected product,
   and ask for the next version number. Do not choose it automatically.
6. Build and verify immutable artifacts from that main commit, collect a readable
   changelog, and publish the selected product's release. Publishing does not install.

The future owner Updates area has independent Core and DSP pages. Core shows its
changelog and an Update Core action. Shared dashboard/API features should first be
validated in a separate Core preview connected only to the permanent Dev DSP.

For DSP releases, Update Dev installs only the permanent testing DSP. Successful
installation and health checks enable Rollout Update. A newer release before
rollout resets the required Dev test. Rollout processes DSPs one at a time, checks
each DSP and pauses on failure. A rollout already started stays pinned to its exact
artifact even if another release is published. Retain previous code and a compatible
state snapshot for rollback; reverting code alone cannot undo a database migration.

Local foundations are implemented in `core/updates/local-releases.js`,
`host/releases/runtime.js` and the package catalog's per-DSP approvals. These are
internal lifecycle ports, not public HTTP installation endpoints. Activation hooks
must drain processes, snapshot private state, start selected code, verify health
and restore on failure. Recover interrupted operations explicitly before continuing.
The persistent state directory is private and is never included in source exports.

The GitHub feed, signed release provenance, repository configuration, permanent Dev
DSP deployment, separate Core preview, privileged activation hooks and owner Updates
UI are subsequent work. The development builder intentionally cannot publish a
production release. Release versions and the deployment baseline are not assigned
by local repository preparation.

Legacy `core/installations/RELEASES.md` documents old native/OCI recovery formats.
It does not authorize or describe the new release workflow.
