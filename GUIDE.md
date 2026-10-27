# From a directory result to supplier authority

A directory can help a Personal Agent find an offer. It cannot authorize the agent
to act at the independent Company responsible for that offer. This example joins
existing Poppy draft 0.3 primitives across that boundary.

1. **Discover through the directory.** Its MCP result carries a public supplier
   domain and listing reference. It carries no supplier authority.
2. **Verify and choose the supplier.** Resolve the Company's own discovery and
   issuer metadata. Present the actual destination through the Personal Agent's
   UI before continuing. Shared hosting does not mean shared Company identity.
3. **Establish a separate Session.** Use an issuer-specific User ID and a fresh DPoP Session Key per Session.
   Forward only the public listing reference and necessary shopping inputs.
4. **Get current terms.** The supplier's MCP tool or Company Agent creates an
   Operation. Directory results are not binding quotes or reservations.
5. **Approve that revision.** Present the supplier and terms in the Personal
   Agent's UI. Changed terms require renewed approval, not reuse of the old one.
6. **Recover the original Operation.** If confirmation loses its response, read
   the same supplier-owned Operation. Do not create a replacement transaction.

The application-specific listing and reservation fields are illustrative; this
pattern adds no Poppy fields. The directory gets no automatic conversion callback.
Signed-in access, payment, cancellation and production fulfillment are outside
this example. See the README's precise simulation and security boundaries.

## Code map

- `kit/company/examples/federated-commerce/agent.ts`: Personal Agent client and UI callbacks.
- `fixture.ts` in that directory: three fictional Companies and simulated fulfillment ledger.
- `auth.ts`: narrow cryptographic fixture, not a production authorization server.
- `model.ts`: illustrative shopping model and protocol envelopes.
- `demo.ts`: both interface journeys, with deliberate confirmation response loss.
- `kit/company/validate/test/federated-commerce.test.ts`: boundary and recovery tests.
- `kit/company/validate/test/draft03.test.ts`: Session Keys, nonce, Token Exchange and discovery regressions.
- `kit/company/validate` helpers and `kit/company/schemas`: pinned upstream material.

The kit-shaped source directories preserve upstream relative imports and make
provenance review straightforward. Users run the root package scripts; no installed
Poppy kit or Kismet account is required.
