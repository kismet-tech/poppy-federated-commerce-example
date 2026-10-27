import {
    dpopProof,
    generateKey,
    randomId,
    signAssertion,
    thumbprint,
    type SigningKey,
} from "../../validate/jose.ts";
import {
    body,
    https,
    metadataUrl,
    Problem,
    shoppingIntent,
    type Fetch,
    type Intent,
    type Listing,
    type Manifest,
    type Metadata,
    type Operation,
} from "./model.ts";

type Identity = { subject: string; dpop: SigningKey };
export type CompanySession = {
    manifest: Manifest;
    metadata: Metadata;
    identity: Identity;
    id: string;
    token: string;
    mcpToken?: string;
    mcpBearer?: boolean;
    ended?: boolean;
};
export type Proposal = { session: CompanySession; operation: Operation };
type Rpc = {
    result: {
        isError?: boolean;
        content?: { text: string }[];
        structuredContent?: { listings?: Listing[]; operation?: Operation };
        tools?: { name: string }[];
    };
};
export type Choice = {
    name: string;
    domain: string;
    issuer: string;
    listing: string;
};
export type Approval = Choice & {
    summary: string;
    terms: Operation["terms"];
    operationId: string;
    revision: number;
};

// User callbacks are supplied by the Personal Agent's own UI. Company data never calls them.
export class PersonalAgent {
    private identities = new Map<string, string>();
    private transport: Fetch;
    private nonces = new Map<string, string>();
    readonly clientId: string;
    readonly key: SigningKey;
    constructor(transport: Fetch, clientId: string, key: SigningKey) {
        this.transport = transport;
        this.clientId = clientId;
        this.key = key;
    }

    private async request(url: string, init: RequestInit = {}) {
        https(url);
        const response = await this.transport(new Request(url, { ...init, redirect: "manual" }));
        if (response.status >= 300 && response.status < 400)
            throw new Problem("endpoint_redirect_refused");
        return response;
    }

    private async proofRequest(
        session: CompanySession,
        url: string,
        build: () => Promise<RequestInit>,
        accessToken?: string,
    ) {
        if (session.ended) throw new Problem("invalid_grant");
        // Nonces are scoped to the exact endpoint, never propagated to another Company.
        for (let attempt = 0; attempt < 2; attempt++) {
            const init = await build();
            const headers = new Headers(init.headers);
            headers.set(
                "DPoP",
                await dpopProof({
                    key: session.identity.dpop,
                    method: init.method ?? "GET",
                    url,
                    accessToken,
                    nonce: this.nonces.get(url),
                }),
            );
            const response = await this.request(url, { ...init, headers });
            const nonce = response.headers.get("DPoP-Nonce");
            if (nonce) this.nonces.set(url, nonce);
            if (!response.ok) {
                const error = await response
                    .clone()
                    .json()
                    .catch(() => ({}));
                if (error.error === "use_dpop_nonce" && nonce && attempt === 0) continue;
                if (error.error === "invalid_grant" && url === session.metadata.token_endpoint)
                    session.ended = true;
            }
            return response;
        }
        throw new Problem("use_dpop_nonce");
    }

    async discover(domain: string): Promise<{ manifest: Manifest; metadata: Metadata }> {
        const origin = https(`https://${domain}`);
        if (origin.host !== domain || origin.pathname !== "/" || origin.search)
            throw new Problem("invalid_company_domain");
        let url = `${origin.origin}/.well-known/poppy.json`;
        let response: Response | undefined;
        for (let hop = 0; hop < 6; hop++) {
            response = await this.transport(new Request(https(url), { redirect: "manual" }));
            if (response.status < 300 || response.status >= 400) break;
            const location = response.headers.get("location");
            if (!location) throw new Problem("invalid_discovery_redirect");
            url = https(new URL(location, url).href).href;
            response = undefined;
        }
        if (!response) throw new Problem("too_many_discovery_redirects");
        const manifest = await body<Manifest>(response);
        const finalUrl = new URL(url);
        if (finalUrl.pathname !== "/.well-known/poppy.json" || finalUrl.search)
            throw new Problem("invalid_discovery_location");
        const finalDomain = finalUrl.host;
        if (
            manifest.protocol_version !== "0.3" ||
            manifest.organization.domain.toLowerCase() !== finalDomain.toLowerCase()
        )
            throw new Problem("discovery_domain_mismatch");
        const metadata = await body<Metadata>(
            await this.request(metadataUrl(manifest.auth.issuer)),
        );
        if (
            metadata.issuer !== manifest.auth.issuer ||
            !metadata.protected_resources?.some(
                (d) =>
                    /^https:\/\/[^/?#]+$/.test(d) &&
                    new URL(d).host.toLowerCase() === finalDomain.toLowerCase(),
            )
        )
            throw new Problem("issuer_domain_mismatch");
        if (
            !metadata.grant_types_supported?.includes(
                "urn:ietf:params:oauth:grant-type:jwt-bearer",
            ) ||
            !metadata.grant_types_supported.includes("refresh_token")
        )
            throw new Problem("unsupported_issuer_metadata");
        https(metadata.token_endpoint);
        return { manifest, metadata };
    }

    async open(discovery: { manifest: Manifest; metadata: Metadata }): Promise<CompanySession> {
        const issuer = discovery.manifest.auth.issuer;
        let subject = this.identities.get(issuer);
        if (!subject) {
            subject = `usr_${randomId()}`;
            this.identities.set(issuer, subject);
        }
        const identity = { subject, dpop: await generateKey() };
        const session: CompanySession = {
            ...discovery,
            identity,
            id: await thumbprint(identity.dpop.publicJwk),
            token: "",
        };
        session.token = await this.issue(session);
        return session;
    }

    private async issue(session: CompanySession, resource?: string) {
        const { metadata, identity, manifest } = session;
        const assertion = (sub: string) =>
            signAssertion({
                key: this.key,
                iss: this.clientId,
                sub,
                aud: manifest.auth.issuer,
            });
        const form = async () =>
            new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                client_id: this.clientId,
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: await assertion(this.clientId),
                assertion: await assertion(identity.subject),
                ...(resource ? { resource } : {}),
            });
        const response = await body<{
            access_token: string;
            token_type: string;
            expires_in: number;
        }>(
            await this.proofRequest(session, metadata.token_endpoint, async () => ({
                method: "POST",
                body: await form(),
            })),
        );
        if (
            response.token_type !== "DPoP" ||
            "signed_in" in response ||
            "scope" in response ||
            "session_id" in response
        )
            throw new Problem("unexpected_session_response");
        return response.access_token;
    }

    async renew(session: CompanySession) {
        session.token = await this.issue(session);
        session.mcpToken = undefined;
    }

    private async exchange(session: CompanySession, resource: string) {
        const response = await body<{
            access_token: string;
            token_type: string;
            issued_token_type: string;
        }>(
            await this.proofRequest(session, session.metadata.token_endpoint, async () => ({
                method: "POST",
                body: new URLSearchParams({
                    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
                    client_id: this.clientId,
                    client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                    client_assertion: await signAssertion({
                        key: this.key,
                        iss: this.clientId,
                        sub: this.clientId,
                        aud: session.manifest.auth.issuer,
                    }),
                    subject_token: session.token,
                    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
                    resource,
                }),
            })),
        );
        if (
            response.token_type !== "Bearer" ||
            response.issued_token_type !== "urn:ietf:params:oauth:token-type:access_token"
        )
            throw new Problem("unexpected_exchange_response");
        return response.access_token;
    }

    async authorized(
        session: CompanySession,
        url: string,
        method: string,
        payload?: unknown,
        mcp = false,
    ) {
        const token = mcp ? session.mcpToken! : session.token;
        const build = async (): Promise<RequestInit> => ({
            method,
            headers: {
                authorization: `${mcp && session.mcpBearer ? "Bearer" : "DPoP"} ${token}`,
                "content-type": "application/json",
                Accept: "application/json, text/event-stream",
                ...(mcp ? { "MCP-Protocol-Version": "2025-06-18" } : {}),
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        });
        return mcp && session.mcpBearer
            ? this.request(url, await build())
            : this.proofRequest(session, url, build, token);
    }

    private async rpc(session: CompanySession, method: string, params?: unknown) {
        const url = session.manifest.apis.find((a) => a.type === "mcp")?.url;
        if (!url) throw new Problem("mcp_not_advertised");
        return body<Rpc>(
            await this.authorized(
                session,
                url,
                "POST",
                {
                    jsonrpc: "2.0",
                    id: randomId(),
                    method,
                    ...(params ? { params } : {}),
                },
                true,
            ),
        );
    }

    private async initialize(session: CompanySession) {
        const resource = session.manifest.apis.find((a) => a.type === "mcp")?.url;
        if (!resource) throw new Problem("mcp_not_advertised");
        const url = https(resource);
        const prm = await body<{
            resource: string;
            authorization_servers: string[];
            dpop_signing_alg_values_supported: string[];
        }>(await this.request(`${url.origin}/.well-known/oauth-protected-resource${url.pathname}`));
        if (
            prm.resource !== resource ||
            !prm.authorization_servers.includes(session.manifest.auth.issuer) ||
            (prm.dpop_signing_alg_values_supported !== undefined &&
                !prm.dpop_signing_alg_values_supported.includes("ES256"))
        )
            throw new Problem("unsupported_mcp_metadata");
        session.mcpBearer = prm.dpop_signing_alg_values_supported === undefined;
        session.mcpToken = session.mcpBearer
            ? await this.exchange(session, resource)
            : await this.issue(session, resource);
        await this.rpc(session, "initialize", {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "federated-commerce-example", version: "1" },
        });
        await this.authorized(
            session,
            resource,
            "POST",
            { jsonrpc: "2.0", method: "notifications/initialized" },
            true,
        );
    }

    async search(domain: string) {
        const session = await this.open(await this.discover(domain));
        await this.initialize(session);
        const result = await this.rpc(session, "tools/call", {
            name: "search_stays",
            arguments: {},
        });
        return { session, listings: result.result.structuredContent!.listings! };
    }

    async continueWith(
        listing: Listing,
        dates: Omit<Intent, "listing_url">,
        choose: (company: Choice) => Promise<boolean>,
    ) {
        const intent = shoppingIntent(listing, dates);
        const discovery = await this.discover(listing.company_domain);
        const company = discovery.manifest;
        // A redirect may discover another Company, but cannot silently reassign this listing.
        const chosen = await choose({
            name: company.organization.name,
            domain: company.organization.domain,
            issuer: company.auth.issuer,
            listing: intent.listing_url,
        });
        if (!chosen) throw new Problem("user_declined_company");
        if (company.organization.domain.toLowerCase() !== listing.company_domain.toLowerCase())
            throw new Problem("destination_changed_reselect_listing");
        const session = await this.open(discovery);
        return { session, intent };
    }

    async propose(
        session: CompanySession,
        intent: Intent,
        channel: "mcp" | "conversation",
    ): Promise<Proposal> {
        const extension = session.manifest.extensions?.operations;
        if (extension?.version !== "1") throw new Problem("operations_not_advertised");
        let operation: Operation;
        if (channel === "mcp") {
            if (!session.mcpToken) await this.initialize(session);
            const listing = await this.rpc(session, "tools/list");
            if (!listing.result.tools?.some((t) => t.name === "propose_reservation"))
                throw new Problem("proposal_tool_missing");
            const reply = await this.rpc(session, "tools/call", {
                name: "propose_reservation",
                arguments: intent,
            });
            if (reply.result.isError)
                throw new Problem(reply.result.content?.[0]?.text ?? "tool_error");
            operation = reply.result.structuredContent!.operation!;
        } else {
            const endpoint = session.manifest.agent?.protocols.find(
                (p) => p.type === "poppy",
            )?.endpoint;
            if (!endpoint) throw new Problem("conversation_not_advertised");
            const started = await body<{ conversation_id: string }>(
                await this.authorized(session, endpoint, "POST", {
                    message: {
                        id: `msg_${randomId()}`,
                        author: { type: "agent" },
                        text: "Please propose a reservation for this public listing and these dates.",
                        data: intent,
                    },
                }),
            );
            const events = await body<{
                events: { message?: { role?: string; operation?: Operation } }[];
            }>(
                await this.authorized(
                    session,
                    `${endpoint}/${encodeURIComponent(started.conversation_id)}/events`,
                    "GET",
                ),
            );
            operation = events.events.find(
                (e) => e.message?.role === "company" && e.message.operation,
            )?.message?.operation as Operation;
        }
        if (!operation || !/^[A-Za-z0-9_-]+$/.test(operation.operation_id))
            throw new Problem("invalid_operation");
        if (
            Object.keys(intent).some(
                (key) => operation.terms[key as keyof Intent] !== intent[key as keyof Intent],
            )
        )
            throw new Problem("supplier_changed_request");
        return { session, operation };
    }

    async read(proposal: Proposal): Promise<Operation> {
        return body<Operation>(
            await this.authorized(proposal.session, this.operationUrl(proposal), "GET"),
        );
    }

    private operationUrl(proposal: Proposal) {
        return `${proposal.session.manifest.extensions!.operations!.endpoint}/${encodeURIComponent(proposal.operation.operation_id)}`;
    }

    async confirm(
        proposal: Proposal,
        approve: (shown: Approval) => Promise<boolean>,
    ): Promise<Operation> {
        // Bind both authority and terms before awaiting the UI. Later updates to a caller's
        // proposal must not move this approval (or response-loss recovery) to another action.
        const bound = structuredClone(proposal);
        const op = bound.operation;
        if (op.state !== "proposed") throw new Problem("operation_not_proposed");
        const company = bound.session.manifest;
        const approved = await approve({
            name: company.organization.name,
            domain: company.organization.domain,
            issuer: company.auth.issuer,
            listing: op.terms.listing_url,
            summary: op.summary,
            terms: structuredClone(op.terms),
            operationId: op.operation_id,
            revision: op.revision,
        });
        if (!approved) throw new Problem("user_declined_operation");
        try {
            return await body<Operation>(
                await this.authorized(
                    bound.session,
                    `${this.operationUrl(bound)}/confirm`,
                    "POST",
                    { revision: op.revision, approved_by: "user" },
                ),
            );
        } catch (error) {
            // Recover only transport uncertainty, with the original ID. A terms_changed response
            // returns to the caller/UI for another approval; it is never automatically confirmed.
            if (!(error instanceof TypeError)) throw error;
            return this.read(bound);
        }
    }
}
