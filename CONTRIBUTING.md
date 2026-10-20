# Contributing

Use Node.js 24.20.0 (`nvm use` if installed). No package installation is needed.
Run `npm run check` before proposing changes. It verifies pinned upstream files,
runs the 25 boundary tests, then runs the fictional demo. CI runs the same command.

Keep this example focused on directory-to-independent-Company authority, approval
and recovery using existing Poppy primitives. Add a regression test for behavior
changes. Do not add production credentials, real inventory, booking or payment
calls, telemetry, or automatic network access to the fixture.

Changes to the demo's automatic approval callbacks must continue to label them as
simulated user input. Preserve the limitations in the README. This repository is
not an official conformance suite and does not define protocol requirements.

## Tracking upstream revisions

Jason Cincotta is the maintenance owner for Kismet. For each draft revision:

1. Review the upstream spec, Operations and Company-kit changes against the pin in
   `upstream.json`. Record relevant semantic changes, not just the version label.
2. Update copied schemas/helpers from the reviewed upstream commit. Preserve its
   license and any NOTICE. Do not hand-edit vendored files to make tests pass.
3. Update the SHA-256 entries in `upstream.json`, the revision in README and
   ATTRIBUTION, and add the compatibility results to VALIDATION.md.
4. Adapt the example only where needed, add meaningful negative tests, and run
   `npm run check` on the documented Node version.
5. Have the diff reviewed before publication. Never imply compatibility with an
   untested draft or independent interoperability from this single-process fixture.

Contributions to this companion are under Apache-2.0. Upstream protocol feedback
has separate terms; contributing here does not submit feedback upstream.
