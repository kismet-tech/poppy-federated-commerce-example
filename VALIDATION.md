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

## Draft 0.3 review: October 27, 2026

Reviewed upstream main `a95b757872533a6ef1e1a9bcf29802857d2e5ff4` and the
[in-progress 0.3 changelog](https://personalagentprotocol.org/docs/changelog#v0-3).
This was a documentation and compatibility-gap review, not a 0.3 validation run.
The executable example and vendored inputs remain pinned to 0.2.

Relevant migration work before claiming 0.3 compatibility:

- Name Sessions by per-Session DPoP Session Keys instead of `session_id`; review
  renewal, ended-key rejection and isolation tests.
- Obtain MCP Bearer tokens using RFC 8693 Token Exchange; test resource/type
  rejection and preservation of the source Session's authority.
- Replace `poppy_domains` with `protected_resources`, update required issuer
  metadata, and enforce the final discovery well-known path and absence of query.
- Update token response/error assumptions, including removed `signed_in` and
  `invalid_session`, and Company-defined scopes where applicable.
- Replace conversation `sender` with `author.type`; refresh upstream schemas and
  provenance hashes only as part of the actual implementation migration.

The 0.3 task-grants and standing-permission discussions are proposals, not
implemented capabilities here. The fixture does not test token-expiry recovery,
Company-side proof of human approval, or real payment settlement. Recovery tests
cover retries and concurrent confirmation within the fixture's supported scope.
