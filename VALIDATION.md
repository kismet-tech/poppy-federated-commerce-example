# Validation record

Runtime: Node.js 24.20.0. Local validation: October 27, 2026.
Upstream in-progress draft 0.3 pin: `a95b757872533a6ef1e1a9bcf29802857d2e5ff4`.

Run `npm run check` from a clean clone. No dependency installation, credentials,
Kismet account or external service is required. CI runs the same command.

- All 25 vendored upstream helper/schema/license files match the recorded SHA-256 hashes.
- 36 tests pass with no failures or skips: 25 original boundary tests plus 11 draft 0.3 regressions.
- Both MCP and Company Agent demos recover dropped confirmation responses and end
  with exactly two simulated fulfillment records.

## What was migrated and tested

- Fresh DPoP Session Keys per Session, stable issuer-local User IDs, same-key renewal,
  wrong-user/client key rejection, and ended-key rejection without resurrection.
- Token responses omit `session_id`, `signed_in` and signed-out `scope`.
- Exact-origin `protected_resources`, required grant metadata, final well-known
  discovery path/no query, and rejection of unsupported protocol versions.
- Conversation messages use `author.type`; illustrated requests and responses are
  checked against unmodified upstream 0.3 schemas.
- DPoP-capable MCP uses resource-bound DPoP tokens. Bearer-only MCP uses RFC 8693
  Token Exchange; wrong resources, clients, issuers, keys and expired subject tokens
  are rejected. An exchange cannot target a DPoP-capable server. Bearer tokens
  cannot read supplier Operations.
- Bounded nonce retry on token, MCP and Operation endpoints, including Token Exchange.
- Explicit renewal after token expiry recovers the same pending Operation and one
  fulfillment record. Confirmation retry and concurrent confirmation preserve one effect.

## Limits of this evidence

This is a single-process synthetic fixture and client, with pinned test-client
registration, no DNS/TLS transport and no independent implementation. It is not
full Company or Personal Agent conformance, production OAuth, or payment evidence.
Direct/Device/Mediated Sign-In, Account Tokens and account scopes, browser sessions,
complete conversation/MCP lifecycles, cancellations, task grants and standing-permission
proofs are outside the example. No production Kismet service was migrated by this change.

Approval callbacks simulate the Personal Agent's UI. They are not cryptographic
proof that a human saw or approved terms. Task-grant recovery (#28) has a different
authorization lifecycle; the ordinary Session renewal test here does not implement it.

[Hosted CI](https://github.com/kismet-tech/poppy-federated-commerce-example/actions/workflows/validate.yml)
records results for each published commit. Prior 0.2 evidence is retained in Git
history at `4ca9cf01fd135322055bb56bdc3c6b9253dfec5e`. The draft can change; use the
exact pin above rather than interpreting “0.3” as compatibility with future edits.
