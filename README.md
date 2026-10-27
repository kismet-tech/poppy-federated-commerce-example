# Poppy federated commerce example

> **Version status (October 27, 2026):** this companion targets the signed-out
> flows of **in-progress draft 0.3**, pinned to `a95b757872533a6ef1e1a9bcf29802857d2e5ff4`.
> It is a tested, single-process reference example, not a complete Company or
> Personal Agent conformance suite. See [validation and scope](VALIDATION.md).

Use this example to connect **finding an offer in one service** with **completing a user-approved
action at the supplier responsible for it**. It shows a Personal Agent searching a travel directory,
choosing a supplier, obtaining current terms through MCP or a Company Agent, and recovering the
result when the confirmation response is lost.

For example, a user asks an agent to find a cabin for two guests. The directory helps the agent
find a property; the supplier supplies the reservation terms and performs the approved action.
The Personal Agent keeps the destination choice and approval in its own user interface. A shared
infrastructure provider can host both suppliers while keeping their Sessions and user identities
separate.

## What this helps you build

- **Personal Agent builders:** continue from a public catalog result to the right Company's
  advertised interface, carry only the shopping details needed, and bind approval and recovery to
  that Company's Operation.
- **Company and Company Agent builders:** accept a request discovered elsewhere, provide current
  terms through an MCP tool or conversation, and use one Operation for approval and execution
  across those interfaces.
- **Infrastructure providers:** host independent suppliers on shared systems while preserving
  Company-specific issuers, credentials and records.

Finding and ranking suppliers remains outside Poppy, as clarified in
[upstream issue #29](https://github.com/personal-agent-protocol/personal-agent-protocol/issues/29#issuecomment-6399202918).
This example treats the directory as an application and demonstrates the subsequent connection
between Company discovery, authority, approval and outcome recovery. It composes existing Poppy draft 0.3 discovery, Sessions, MCP, conversations and
Operations into a runnable flow. The contribution adds implementation guidance and tests; the
wire protocol stays the same. Each supplier still defines its tools and commerce terms, so an
agent must understand that supplier's published API or tool schema.

## What a successful run demonstrates

The agent can reach either of two suppliers, obtain an Operation through MCP or a Company Agent,
and confirm the revision the user approved. The supplier's current terms govern the action.
Company identities stay separate, changed terms require fresh approval, and a repeated
confirmation does not create another fulfillment record. The demo deliberately loses a response
and then retrieves the original Operation to recover the outcome.

Travel is the worked example; the same authority and approval boundaries can apply when a catalog
points to an independent retailer or service provider. Fulfillment here is simulated. The example
does not implement payments, production sign-in or a universal booking API; the implementation
boundaries are described below.

## Run

Tested with **Node.js 24.20.0**. Use that version to reproduce the results. No dependency
installation or pnpm is required; the companion includes the helpers and schemas it uses.

Clone the companion repository, then run its tests and demo:

```sh
git clone https://github.com/kismet-tech/poppy-federated-commerce-example.git poppy-federated-commerce-example
cd poppy-federated-commerce-example
npm test
npm run demo
```

`npm test` runs the 36
companion tests. Both the tests and demo are included in this repository.

The demo prints a destination choice and approval for each of two suppliers, recovers a lost
confirmation response through both interfaces, and ends with two simulated fulfillment records.
The callbacks stand in for user input in the Personal Agent's own UI. Their automatic `true` in
the demo is not consent logic to copy into a real agent.

## The flow

`directory.example` lists two public cabins. `cedar.example` and `harbor.example` have separate
issuers at `https://platform.example/cedar` and `https://platform.example/harbor`, so hosting them
on one platform does not make them one Company.

1. The Personal Agent searches the directory's MCP server with a directory-scoped Session.
2. The user chooses a listing. The agent checks the supplier's discovery and issuer metadata and
   presents the actual Company to its own destination-choice callback before starting a Session.
   A discovery redirect can reveal another Company; it cannot silently transfer the selected
   listing or the user's approval there.
3. The agent uses a different User ID at each issuer and a fresh DPoP Session Key for each Session. It sends only the selected
   public listing URL, dates and guest count to the supplier.
4. Either `propose_reservation` in MCP or a Company Agent conversation produces an Operation. The
   supplier supplies current terms; the catalog cannot grant a price, availability or permission.
   Both interfaces resolve the same intent in one Session to the same Operation.
5. The Personal Agent shows the Company's terms to its own approval callback. It confirms only
   that revision. A changed revision returns to the caller for fresh approval.
6. A lost response is recovered by reading the original Operation. An uncertain result remains
   `in_progress` and is returned to the caller to resume later, rather than starting another
   reservation. The fixture's fulfillment ledger is keyed by issuer and operation ID.

`company_domain`, `listing_url`, shopping fields and tool names are this fictional application's
API vocabulary, not standardized Poppy fields. A different Company's published tools/API schema
can use different names. The reusable part is the authority and approval boundary, not a universal
reservation API. A third-party catalog reference is data; continuing is justified by the user's
shopping task and destination choice, never by instructions embedded in that reference.

## What is real and what is simulated

- Requests and responses use the Fetch API. Client and Session assertions are actually signed and
  verified with ES256; DPoP proofs check method, URL, time, replay, key binding and token hash.
  MCP tokens are resource-bound and are not accepted at Operations.
- All three Companies and the Personal Agent run in one process. A closed in-memory router
  implements only the illustrated endpoints; it never calls global `fetch`, opens a listener,
  resolves DNS or takes a payment. HTTPS names represent the origins a real transport would use;
  this does not test TLS, DNS rebinding, real hosting or independent implementations.
- Client registration pins an ephemeral public key and declared Operations support directly into
  the fixture. It does not implement client-metadata fetching, JWKS rotation or a registration
  policy. The small authorization fixture is not a production OAuth server or conformance suite.
- The example supports signed-out, session-owned demonstration reservations, with no customer
  account. Account-only actions return `sign_in_required`. Direct Sign-In, Account Tokens,
  post-sign-out account checks, cancellation, streaming, and complete MCP/conversation lifecycles are outside this example.
- The Company Agent is deterministic application code, not an LLM. The tests exercise protocol
  envelopes and trust boundaries, not model reasoning. Approval is a Personal Agent assertion,
  not cryptographic proof that a human saw the UI.
- Session renewal uses the same Session Key. Tests expire a token while an Operation is pending,
  renew explicitly, and recover that original Operation. Nonce challenges are retried once with
  fresh assertions/proofs. The fixture can exercise both DPoP MCP and Bearer-only MCP via RFC 8693
  Token Exchange; Bearer tokens cannot be used at Operations or conversations. This does not
  implement Account Token refresh, task grants or Company-side proof of human approval.
- The example keeps secrets only in memory. The demo prints public summaries and counts, never
  request traces, assertions, proofs, keys or tokens. The fixture's in-memory request capture is
  for test assertions and must not become a production logger.

## Tests and boundaries

The suite covers both suppliers through both interfaces, shared-provider issuer isolation, separate
user IDs and DPoP keys, destination refusal, deceptive Company text, unwanted context forwarding,
domain/issuer mismatches, redirects, stale listings, changed terms, expired proposals, wrong-company
and wrong-Session access, resource binding, DPoP key mismatch, assertion replay, extension support,
account-only work, cross-client access, concurrent confirms and response-loss recovery. Approval
and recovery remain bound to the original supplier and operation while the UI is open. The
illustrated discovery, metadata, token, conversation and error bodies are also checked against the
kit's JSON Schemas.

No referral or conversion callback goes back to the directory. A final Operation is the supplier's
account of what happened, not payment-settlement proof. A production provider can measure its own
requests and outcomes without exporting Company-specific User IDs or Sessions to other Companies.

Before proposing new handoff fields, try this pattern with independently implemented Personal
Agents and Companies. This fixture and its client share code and are not that interoperability
evidence. For production implementation requirements, use the
[specification](https://personalagentprotocol.org/docs/0.3/spec),
[Operations](https://personalagentprotocol.org/docs/0.3/extensions/operations) and
[guides](https://personalagentprotocol.org/docs/0.3/guides).

## Maintenance and provenance

Maintained by Jason Cincotta at Kismet. We will track each Poppy draft revision, rerun the example and tests, and record the supported revision explicitly. This is an independently maintained companion, not an official Poppy implementation or endorsement.

Licensed under Apache-2.0. The cryptographic helpers, schema validator and JSON schemas are copied from the Personal Agent Protocol Company kit at upstream commit `a95b757872533a6ef1e1a9bcf29802857d2e5ff4`. See ATTRIBUTION.md and LICENSE.

## Review and development

Read [the handoff guide](GUIDE.md) for the authority boundaries and code map.
Use `npm run check` to verify upstream provenance, run the tests and run the demo.
See [validation evidence](VALIDATION.md), [contribution and maintenance policy](CONTRIBUTING.md)
and [upstream provenance](upstream.json). The GitHub workflow runs the same checks.
