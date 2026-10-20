# Validation record

Local verification: October 20, 2026. Runtime: Node.js 24.20.0.
Upstream draft 0.2 pin: `39b35bdf240fc07f157d6ca4e29b5a41d4b36b5d`.

Run `npm run check` from a clean copy of this companion. No dependency installation,
credentials, network service or Kismet account is required.

Expected results:

- All pinned upstream helper/schema/license hashes match.
- 25 tests pass, with zero failures or skips.
- Demo completes the MCP and Company Agent paths, recovers dropped confirmation
  responses and ends with exactly two simulated fulfillment records.

These are synthetic local compatibility results. Hosted results are available in [GitHub Actions](https://github.com/kismet-tech/poppy-federated-commerce-example/actions/workflows/validate.yml); check the run for the commit you use. No independent
Personal Agent has validated the example, and this does not establish production
OAuth, payment, TLS or full Company conformance.
