import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKey, dpopProof, signAssertion, thumbprint } from "../jose.ts";
import { CommerceFixture, SUPPLIERS } from "../../examples/federated-commerce/fixture.ts";
import { PersonalAgent } from "../../examples/federated-commerce/agent.ts";
import { Problem } from "../../examples/federated-commerce/model.ts";
const dates = {
    listing_url: "https://cedar.example/stays/cabin",
    check_in: "2030-06-10",
    check_out: "2030-06-12",
    guests: 2,
};
const code = (c: string) => (e: unknown) => e instanceof Problem && e.code === c;
async function setup(bearer = false) {
    const fixture = new CommerceFixture();
    const key = await generateKey();
    const clientId = "https://agent.example/client.json";
    fixture.registerClient(clientId, key.publicJwk);
    const issuer = fixture.manifests.get(SUPPLIERS[0])!.auth.issuer;
    if (bearer) fixture.bearerOnly.add(issuer);
    const agent = new PersonalAgent(fixture.fetch, clientId, key);
    const session = await agent.open(await agent.discover(SUPPLIERS[0]));
    return { fixture, key, clientId, issuer, agent, session };
}
async function token(
    s: Awaited<ReturnType<typeof setup>>,
    fields: Record<string, string>,
    proofKey = s.session.identity.dpop,
    clientId = s.clientId,
    key = s.key,
) {
    const url = `${s.issuer}/token`;
    return s.fixture.fetch(
        new Request(url, {
            method: "POST",
            headers: {
                DPoP: await dpopProof({ key: proofKey, method: "POST", url }),
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                client_assertion: await signAssertion({
                    key,
                    iss: clientId,
                    sub: clientId,
                    aud: s.issuer,
                }),
                ...fields,
            }),
        }),
    );
}
const exchange = (s: Awaited<ReturnType<typeof setup>>) => ({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token: s.session.token,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
    resource: `${s.issuer}/mcp`,
});
test("0.3: same User gets separate Session Keys; renewal retains original operation access", async () => {
    const s = await setup();
    const p = await s.agent.propose(s.session, dates, "mcp");
    const old = s.session.token;
    const second = await s.agent.open(await s.agent.discover(SUPPLIERS[0]));
    assert.equal(second.identity.subject, s.session.identity.subject);
    assert.notEqual(second.id, s.session.id);
    await s.agent.renew(s.session);
    assert.notEqual(s.session.token, old);
    assert.equal((await s.agent.read(p)).operation_id, p.operation.operation_id);
    await assert.rejects(s.agent.read({ ...p, session: second }), code("operation_not_found"));
    const reqs = s.fixture.requests.filter((r) => r.url.endsWith("/token"));
    for (const r of reqs)
        assert.equal(new URLSearchParams(await r.clone().text()).has("session_id"), false);
});
test("0.3: a Session Key cannot be rebound to a different User or client, or resurrected after ending", async () => {
    const s = await setup();
    const fields = {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await signAssertion({
            key: s.key,
            iss: s.clientId,
            sub: "different-user",
            aud: s.issuer,
        }),
    };
    assert.equal((await (await token(s, fields)).json()).error, "invalid_grant");
    const other = await generateKey();
    const id = "https://other.example/client.json";
    s.fixture.registerClient(id, other.publicJwk);
    fields.assertion = await signAssertion({
        key: other,
        iss: id,
        sub: s.session.identity.subject,
        aud: s.issuer,
    });
    assert.equal(
        (await (await token(s, fields, s.session.identity.dpop, id, other)).json()).error,
        "invalid_grant",
    );
    s.fixture.authority.end([...s.fixture.authority.sessions.values()][0]);
    await assert.rejects(s.agent.renew(s.session), code("invalid_grant"));
});
test("0.3: Bearer-only MCP uses Token Exchange, same Session, and cannot access Operations", async () => {
    const s = await setup(true);
    const p = await s.agent.propose(s.session, dates, "mcp");
    assert.equal(s.session.mcpBearer, true);
    assert.equal(s.fixture.authority.sessions.size, 1);
    assert.equal(
        s.fixture.authority.tokens.get(s.session.mcpToken!)!.session,
        s.fixture.authority.tokens.get(s.session.token)!.session,
    );
    const url = `${s.issuer}/operations/${p.operation.operation_id}`;
    assert.equal((await s.agent.authorized(s.session, url, "GET", undefined, true)).status, 401);
    assert.equal((await s.agent.confirm(p, async () => true)).state, "succeeded");
});
test("0.3: Token Exchange rejects wrong resource, DPoP-capable MCP, key, client, issuer and expired subject", async () => {
    const normal = await setup();
    assert.equal((await (await token(normal, exchange(normal))).json()).error, "invalid_target");
    const s = await setup(true);
    assert.equal(
        (await (await token(s, { ...exchange(s), resource: `${s.issuer}/operations` })).json())
            .error,
        "invalid_target",
    );
    assert.equal(
        (await (await token(s, exchange(s), await generateKey())).json()).error,
        "invalid_grant",
    );
    const other = await generateKey();
    const id = "https://other.example/client.json";
    s.fixture.registerClient(id, other.publicJwk);
    assert.equal(
        (await (await token(s, exchange(s), s.session.identity.dpop, id, other)).json()).error,
        "invalid_grant",
    );
    const foreign = await s.agent.open(await s.agent.discover(SUPPLIERS[1]));
    assert.equal(
        (
            await (
                await token(
                    s,
                    { ...exchange(s), subject_token: foreign.token },
                    foreign.identity.dpop,
                )
            ).json()
        ).error,
        "invalid_grant",
    );
    s.fixture.authority.tokens.get(s.session.token)!.expires = 0;
    assert.equal((await (await token(s, exchange(s))).json()).error, "invalid_grant");
});
test("0.3: JWT grant cannot mint a token directly for Bearer-only MCP", async () => {
    const s = await setup(true);
    const r = await token(s, {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        resource: `${s.issuer}/mcp`,
        assertion: await signAssertion({
            key: s.key,
            iss: s.clientId,
            sub: s.session.identity.subject,
            aud: s.issuer,
        }),
    });
    assert.equal((await r.json()).error, "invalid_target");
});
test("0.3: discovery redirects cannot terminate at uploaded paths or query URLs", async () => {
    for (const suffix of ["/uploaded.json", "/.well-known/poppy.json?upload=1"]) {
        const s = await setup();
        s.fixture.redirects.set(
            "https://cedar.example/.well-known/poppy.json",
            `https://cedar.example${suffix}`,
        );
        await assert.rejects(
            s.agent.discover(SUPPLIERS[0]),
            code(suffix.startsWith("/uploaded") ? "not_found" : "invalid_discovery_location"),
        );
    }
});
test("0.3: expired Session Token can renew with same key and recover pending outcome", async () => {
    const s = await setup();
    const p = await s.agent.propose(s.session, dates, "conversation");
    s.fixture.deferFulfillment = true;
    s.fixture.dropNextConfirmation = true;
    assert.equal((await s.agent.confirm(p, async () => true)).state, "in_progress");
    s.fixture.authority.tokens.get(s.session.token)!.expires = 0;
    await assert.rejects(s.agent.read(p), code("invalid_token"));
    await s.agent.renew(s.session);
    s.fixture.complete(s.issuer, p.operation.operation_id);
    assert.equal((await s.agent.read(p)).state, "succeeded");
    assert.equal(s.fixture.ledger.size, 1);
});
test("0.3: token, MCP and Operation nonce challenges retry with fresh proofs", async () => {
    const s = await setup();
    s.fixture.requiredNonces.set(`${s.issuer}/token`, "token-nonce");
    await s.agent.renew(s.session);
    s.fixture.requiredNonces.set(`${s.issuer}/mcp`, "mcp-nonce");
    const p = await s.agent.propose(s.session, dates, "mcp");
    const url = `${s.issuer}/operations/${p.operation.operation_id}`;
    s.fixture.requiredNonces.set(url, "operation-nonce");
    assert.equal((await s.agent.read(p)).operation_id, p.operation.operation_id);
    assert.equal(s.fixture.authority.sessions.size, 1);
});
test("0.3: exchange nonce retry retains the original Session and is bounded", async () => {
    const s = await setup(true);
    s.fixture.requiredNonces.set(`${s.issuer}/token`, "exchange-nonce");
    await s.agent.propose(s.session, dates, "mcp");
    assert.equal(s.fixture.authority.sessions.size, 1);
    let calls = 0;
    const alwaysNonce = new PersonalAgent(
        async () => {
            calls++;
            return new Response(JSON.stringify({ error: "use_dpop_nonce" }), {
                status: 400,
                headers: { "DPoP-Nonce": String(calls) },
            });
        },
        s.clientId,
        s.key,
    );
    await assert.rejects(
        alwaysNonce.open(await s.agent.discover(SUPPLIERS[0])),
        code("use_dpop_nonce"),
    );
    assert.equal(calls, 2);
});
test("0.3: valid manifest data at an upload URL or query cannot speak for the Company", async () => {
    for (const suffix of ["/uploaded.json", "/.well-known/poppy.json?upload=1"]) {
        const s = await setup();
        const base = "https://cedar.example/.well-known/poppy.json";
        const agent = new PersonalAgent(
            async (r) =>
                r.url === base
                    ? new Response(null, {
                          status: 302,
                          headers: { location: `https://cedar.example${suffix}` },
                      })
                    : new Response(JSON.stringify(s.fixture.manifests.get(SUPPLIERS[0]))),
            s.clientId,
            s.key,
        );
        await assert.rejects(agent.discover(SUPPLIERS[0]), code("invalid_discovery_location"));
    }
});
test("0.3: protected_resources is an exact origin, and obsolete versions fail closed", async () => {
    const s = await setup();
    const agent = new PersonalAgent(
        async (r) => {
            const response = await s.fixture.fetch(r);
            if (r.url.includes("oauth-authorization-server")) {
                const data = await response.json();
                data.protected_resources = ["https://cedar.example/"];
                return new Response(JSON.stringify(data));
            }
            return response;
        },
        s.clientId,
        s.key,
    );
    await assert.rejects(agent.discover(SUPPLIERS[0]), code("issuer_domain_mismatch"));
    s.fixture.manifests.get(SUPPLIERS[0])!.protocol_version = "0.2";
    await assert.rejects(s.agent.discover(SUPPLIERS[0]), code("discovery_domain_mismatch"));
});
