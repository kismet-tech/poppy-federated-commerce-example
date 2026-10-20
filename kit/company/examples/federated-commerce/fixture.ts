import { randomId, type EcPublicJwk } from "../../validate/jose.ts";
import { Authority, type Session } from "./auth.ts";
import {
    json,
    metadataUrl,
    Problem,
    shoppingIntent,
    type Intent,
    type Listing,
    type Manifest,
    type Operation,
} from "./model.ts";

export const DIRECTORY = "directory.example";
export const SUPPLIERS = ["cedar.example", "harbor.example"] as const;
type StoredOperation = { session: string; intent: string; value: Operation };
type Conversation = { client: string; subject: string; response: object; events: object[] };

// Only these fictional hosts are routed. There is deliberately no fallback to global fetch.
export class CommerceFixture {
    readonly authority = new Authority();
    readonly manifests = new Map<string, Manifest>();
    readonly domains = new Map<string, string[]>();
    readonly redirects = new Map<string, string>();
    readonly requests: Request[] = []; // Test-only, in memory; never printed by the demo.
    readonly listings: Listing[] = SUPPLIERS.map((company_domain) => ({
        company_domain,
        listing_url: `https://${company_domain}/stays/cabin`,
    }));
    readonly ledger = new Map<string, { reservation_id: string; terms: Operation["terms"] }>();
    readonly unavailable = new Set<string>();
    readonly prices = new Map<string, string>();
    requireAccount = false;
    dropNextConfirmation = false;
    deferFulfillment = false;
    companyText = "Here is the proposed reservation. Nothing is booked until you confirm.";
    clock = () => Date.now();
    private operations = new Map<string, StoredOperation>();
    private conversations = new Map<string, Conversation>();
    private messages = new Map<string, { body: string; response: object }>();

    constructor() {
        for (const domain of [DIRECTORY, ...SUPPLIERS]) {
            const issuer =
                domain === DIRECTORY
                    ? `https://${DIRECTORY}/auth`
                    : `https://platform.example/${domain.split(".")[0]}`;
            this.manifests.set(domain, {
                protocol_version: "0.2",
                organization: {
                    name:
                        domain === DIRECTORY
                            ? "Example Travel Directory"
                            : `${domain.split(".")[0]} Stays`,
                    domain,
                },
                auth: { issuer },
                apis: [
                    {
                        type: "mcp",
                        url: `${issuer}/mcp`,
                        description:
                            domain === DIRECTORY
                                ? "Search public supplier listings."
                                : "Propose a demonstration reservation for a public listing.",
                    },
                ],
                ...(domain === DIRECTORY
                    ? {}
                    : {
                          agent: {
                              protocols: [{ type: "poppy", endpoint: `${issuer}/conversations` }],
                          },
                          extensions: {
                              operations: { version: "1", endpoint: `${issuer}/operations` },
                          },
                      }),
            });
            this.domains.set(issuer, [domain]);
            this.prices.set(domain, "350.00");
        }
    }

    registerClient(clientId: string, key: EcPublicJwk, operations = true) {
        // Registration is outside Poppy. The fixture pins the generated public client key here;
        // production implementations fetch and validate client metadata/JWKS instead.
        this.authority.clients.set(clientId, { key, operations });
    }

    readonly fetch = async (request: Request): Promise<Response> => {
        this.requests.push(request.clone());
        try {
            if (this.redirects.has(request.url))
                return new Response(null, {
                    status: 302,
                    headers: { location: this.redirects.get(request.url)! },
                });
            const url = new URL(request.url);
            const manifest = this.manifests.get(url.host);
            if (request.method === "GET" && url.pathname === "/.well-known/poppy.json" && manifest)
                return json(manifest);
            for (const [domain, company] of this.manifests) {
                const issuer = company.auth.issuer;
                if (request.url === metadataUrl(issuer) && request.method === "GET")
                    return json({
                        issuer,
                        token_endpoint: `${issuer}/token`,
                        revocation_endpoint: `${issuer}/revoke`,
                        poppy_domains: this.domains.get(issuer),
                        dpop_signing_alg_values_supported: ["ES256"],
                    });
                const mcp = `${issuer}/mcp`;
                const mcpUrl = new URL(mcp);
                if (
                    request.url ===
                    `${mcpUrl.origin}/.well-known/oauth-protected-resource${mcpUrl.pathname}`
                )
                    return json({
                        resource: mcp,
                        authorization_servers: [issuer],
                        dpop_signing_alg_values_supported: ["ES256"],
                    });
                if (request.url === `${issuer}/token` && request.method === "POST")
                    return json(await this.authority.issue(request, issuer, mcp), 200, {
                        "cache-control": "no-store",
                    });
                if (request.url === mcp && request.method === "POST") {
                    const session = await this.authority.authorize(request, issuer, mcp);
                    return await this.mcp(request, domain, session);
                }
                if (request.url.startsWith(`${issuer}/operations/`)) {
                    const session = await this.authority.authorize(request, issuer);
                    return await this.operation(request, issuer, session);
                }
                if (request.url.startsWith(`${issuer}/conversations`)) {
                    const session = await this.authority.authorize(request, issuer);
                    return await this.conversation(request, domain, issuer, session);
                }
            }
            return json({ error: "not_found" }, 404);
        } catch (error) {
            if (!(error instanceof Problem)) throw error; // Simulated lost responses are transport errors.
            return json(
                {
                    error: error.code,
                    ...(error.code === "extension_required" ? { extension: "operations" } : {}),
                    ...(error.operation ? { operation: error.operation } : {}),
                },
                error.status,
                error.status === 401 ? { "www-authenticate": `DPoP error="${error.code}"` } : {},
            );
        }
    };

    private propose(domain: string, session: Session, input: Intent): Operation {
        if (!this.authority.clients.get(session.clientId)?.operations)
            throw new Problem("extension_required", 403);
        if (this.requireAccount) throw new Problem("sign_in_required", 403);
        const intent = shoppingIntent(
            { company_domain: domain, listing_url: input.listing_url },
            input,
        );
        if (
            !this.listings.some((l) => l.listing_url === intent.listing_url) ||
            this.unavailable.has(intent.listing_url)
        )
            throw new Problem("listing_unavailable", 409);
        const key = JSON.stringify(intent);
        const existing = [...this.operations.values()].find(
            (op) => op.session === session.id && op.intent === key,
        );
        if (existing) return structuredClone(existing.value);
        const value: Operation = {
            operation_id: `op_${randomId()}`,
            revision: 1,
            state: "proposed",
            summary: this.summary(domain, intent, this.prices.get(domain)!),
            terms: {
                ...intent,
                total: { amount: this.prices.get(domain)!, currency: "USD" },
                cancellation: "Free before arrival",
                fulfillment: "Simulated reservation; no payment taken",
            },
            expires_at: new Date(this.clock() + 300_000).toISOString(),
            user_approval_required: true,
            confirmation: null,
            result: null,
        };
        this.operations.set(`${session.issuer}:${value.operation_id}`, {
            session: session.id,
            intent: key,
            value,
        });
        return structuredClone(value);
    }

    private summary(domain: string, intent: Intent, price: string) {
        return `Reserve the demonstration cabin at ${domain} for ${intent.guests} guests, ${intent.check_in} to ${intent.check_out}, total USD ${price}. Cancellation is free before arrival. This fixture records a simulated reservation and takes no payment.`;
    }

    revise(issuer: string, id: string, amount: string) {
        const op = this.operations.get(`${issuer}:${id}`)!.value;
        if (op.state !== "proposed") throw new Error("Only a proposal can be revised");
        op.revision++;
        op.terms.total.amount = amount;
        op.summary = this.summary(new URL(op.terms.listing_url).host, op.terms, amount);
        op.expires_at = new Date(this.clock() + 300_000).toISOString();
        return structuredClone(op);
    }

    private async mcp(request: Request, domain: string, session: Session) {
        const rpc = await request.json();
        let result: object;
        if (rpc.method === "initialize")
            result = {
                protocolVersion: "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: domain, version: "1.0.0" },
            };
        else if (rpc.method === "notifications/initialized")
            return new Response(null, { status: 202 });
        else if (rpc.method === "tools/list")
            result = {
                tools: [
                    {
                        name: domain === DIRECTORY ? "search_stays" : "propose_reservation",
                        description:
                            domain === DIRECTORY
                                ? "Return public supplier listing references."
                                : "Propose a demonstration reservation; confirmation is separate.",
                        inputSchema:
                            domain === DIRECTORY
                                ? { type: "object", properties: {}, additionalProperties: false }
                                : {
                                      type: "object",
                                      properties: {
                                          listing_url: { type: "string" },
                                          check_in: { type: "string" },
                                          check_out: { type: "string" },
                                          guests: { type: "integer" },
                                      },
                                      required: ["listing_url", "check_in", "check_out", "guests"],
                                      additionalProperties: false,
                                  },
                    },
                ],
            };
        else if (rpc.method === "tools/call") {
            try {
                if (domain === DIRECTORY && rpc.params.name === "search_stays")
                    result = {
                        content: [
                            {
                                type: "text",
                                text: "Public listings. Choose a supplier before continuing.",
                            },
                        ],
                        structuredContent: { listings: this.listings },
                    };
                else if (domain !== DIRECTORY && rpc.params.name === "propose_reservation") {
                    const operation = this.propose(domain, session, rpc.params.arguments);
                    result = {
                        content: [{ type: "text", text: operation.summary }],
                        structuredContent: { operation },
                    };
                } else throw new Problem("unknown_tool");
            } catch (error) {
                if (!(error instanceof Problem)) throw error;
                result = { isError: true, content: [{ type: "text", text: error.code }] };
            }
        } else
            return json({
                jsonrpc: "2.0",
                id: rpc.id,
                error: { code: -32601, message: "Method not found" },
            });
        return json({ jsonrpc: "2.0", id: rpc.id, result });
    }

    private async conversation(request: Request, domain: string, issuer: string, session: Session) {
        if (request.url === `${issuer}/conversations` && request.method === "POST") {
            const input = await request.json();
            const key = `${issuer}:${session.clientId}:${session.subject}:${input.message.id}`;
            const serialized = JSON.stringify(input);
            const previous = this.messages.get(key);
            if (previous) {
                if (previous.body !== serialized) throw new Problem("message_id_conflict", 409);
                return json(previous.response, 201);
            }
            const operation = this.propose(domain, session, input.message.data);
            const id = `cnv_${randomId()}`;
            const response = { conversation_id: id, status: "idle", responder: "agent" };
            const events = [
                {
                    id: `evt_${randomId()}`,
                    type: "message",
                    created_at: new Date(this.clock()).toISOString(),
                    message: { ...input.message, role: "user" },
                },
                {
                    id: `evt_${randomId()}`,
                    type: "message",
                    created_at: new Date(this.clock()).toISOString(),
                    message: {
                        id: `msg_${randomId()}`,
                        role: "company",
                        sender: "agent",
                        text: this.companyText,
                        operation,
                    },
                },
            ];
            this.conversations.set(`${issuer}:${id}`, {
                client: session.clientId,
                subject: session.subject,
                response,
                events,
            });
            this.messages.set(key, { body: serialized, response });
            return json(response, 201);
        }
        const id = new URL(request.url).pathname.split("/").at(-2)!;
        const conversation = this.conversations.get(`${issuer}:${id}`);
        if (
            request.method !== "GET" ||
            !request.url.endsWith("/events") ||
            !conversation ||
            conversation.client !== session.clientId ||
            conversation.subject !== session.subject
        )
            throw new Problem("conversation_not_found", 404);
        return json({
            ...conversation.response,
            events: conversation.events,
            cursor: (conversation.events.at(-1) as { id: string }).id,
            has_more: false,
        });
    }

    private async operation(request: Request, issuer: string, session: Session) {
        const rest = new URL(request.url).pathname
            .slice(new URL(`${issuer}/operations/`).pathname.length)
            .split("/");
        const key = `${issuer}:${rest[0]}`;
        const record = this.operations.get(key);
        if (!record || record.session !== session.id) throw new Problem("operation_not_found", 404);
        const op = record.value;
        if (request.method === "GET" && rest.length === 1)
            return json(op, 200, op.state === "in_progress" ? { "retry-after": "1" } : {});
        if (request.method !== "POST" || rest[1] !== "confirm") throw new Problem("not_found", 404);
        const input = await request.json();
        if (input.revision !== op.revision)
            throw new Problem("terms_changed", 409, structuredClone(op));
        if (input.approved_by !== "user") throw new Problem("user_approval_required", 403);
        if (op.state !== "proposed")
            return json(op, 200, op.state === "in_progress" ? { "retry-after": "1" } : {});
        if (Date.parse(op.expires_at) <= this.clock()) {
            op.state = "expired";
            op.result = { summary: "Proposal expired. No reservation or payment was made." };
            return json(op);
        }
        op.confirmation = {
            revision: op.revision,
            approved_by: "user",
            confirmed_at: new Date(this.clock()).toISOString(),
        };
        op.state = "in_progress"; // Record before doing work, including before any await.
        if (!this.deferFulfillment) this.complete(issuer, op.operation_id);
        if (this.dropNextConfirmation) {
            this.dropNextConfirmation = false;
            throw new TypeError("Simulated lost confirmation response");
        }
        return json(op, 200, op.state === "in_progress" ? { "retry-after": "1" } : {});
    }

    complete(issuer: string, id: string) {
        const key = `${issuer}:${id}`;
        const op = this.operations.get(key)!.value;
        if (op.state !== "in_progress") return;
        if (!this.ledger.has(key))
            this.ledger.set(key, {
                reservation_id: `res_${randomId()}`,
                terms: structuredClone(op.terms),
            });
        op.state = "succeeded";
        op.result = {
            summary: "Demonstration reservation recorded. No payment was taken.",
            data: { reservation_id: this.ledger.get(key)!.reservation_id },
        };
    }
}
