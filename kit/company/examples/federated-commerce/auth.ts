// Small cryptographic fixture for this example, not a production authorization server.
import {
    ath,
    decodeJwt,
    htuOf,
    nowSeconds,
    randomId,
    thumbprint,
    verifyJwt,
    type EcPublicJwk,
} from "../../validate/jose.ts";
import { Problem } from "./model.ts";

export type Session = { id: string; issuer: string; clientId: string; subject: string };
export type Token = { session: Session; jkt: string; resource?: string; expires: number };
export type Client = { key: EcPublicJwk; operations: boolean };

export class Authority {
    readonly sessions = new Map<string, Session>();
    readonly clients = new Map<string, Client>();
    readonly tokens = new Map<string, Token>();
    private seen = new Set<string>();

    async proof(request: Request, accessToken?: string): Promise<string> {
        try {
            const raw = request.headers.get("dpop") ?? "";
            const decoded = decodeJwt(raw);
            const jwk = decoded.header.jwk as EcPublicJwk & { d?: string };
            const p = decoded.payload;
            if (
                decoded.header.typ !== "dpop+jwt" ||
                decoded.header.alg !== "ES256" ||
                !jwk ||
                jwk.kty !== "EC" ||
                jwk.crv !== "P-256" ||
                "d" in jwk ||
                !(await verifyJwt(raw, jwk)) ||
                p.htm !== request.method ||
                p.htu !== htuOf(request.url) ||
                typeof p.iat !== "number" ||
                Math.abs(nowSeconds() - p.iat) > 60 ||
                typeof p.jti !== "string" ||
                p.jti.length < 16 ||
                (accessToken !== undefined && p.ath !== (await ath(accessToken)))
            )
                throw new Error("proof");
            const jkt = await thumbprint(jwk);
            const replay = `proof:${jkt}:${p.jti}`;
            if (this.seen.has(replay)) throw new Error("replay");
            this.seen.add(replay);
            return jkt;
        } catch {
            throw new Problem("invalid_dpop_proof", accessToken === undefined ? 400 : 401);
        }
    }

    private async assertion(raw: string, clientId: string, issuer: string, client: boolean) {
        const error = () =>
            new Problem(client ? "invalid_client" : "invalid_grant", client ? 401 : 400);
        try {
            const key = this.clients.get(clientId)?.key;
            if (!key) throw error();
            const decoded = await verifyJwt(raw, key);
            const p = decoded?.payload;
            if (
                !decoded ||
                decoded.header.alg !== "ES256" ||
                decoded.header.typ !== "JWT" ||
                !p ||
                p.iss !== clientId ||
                p.aud !== issuer ||
                typeof p.sub !== "string" ||
                !p.sub ||
                (client && p.sub !== clientId) ||
                typeof p.iat !== "number" ||
                typeof p.exp !== "number" ||
                p.iat > nowSeconds() + 5 ||
                p.exp <= nowSeconds() ||
                p.exp <= p.iat ||
                p.exp - p.iat > 300 ||
                typeof p.jti !== "string" ||
                p.jti.length < 16
            )
                throw error();
            const replay = `assertion:${clientId}:${p.jti}`;
            if (this.seen.has(replay)) throw error();
            this.seen.add(replay);
            return p.sub;
        } catch {
            throw error();
        }
    }

    async issue(request: Request, issuer: string, mcp: string) {
        const form = new URLSearchParams(await request.text());
        const clientId = form.get("client_id") ?? "";
        if (
            form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:jwt-bearer" ||
            form.get("client_assertion_type") !==
                "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
        )
            throw new Problem("unsupported_grant_type");
        await this.assertion(form.get("client_assertion") ?? "", clientId, issuer, true);
        const subject = await this.assertion(form.get("assertion") ?? "", clientId, issuer, false);
        const jkt = await this.proof(request);
        const resource = form.get("resource") ?? undefined;
        if (resource && resource !== mcp) throw new Problem("invalid_target");
        const id = form.get("session_id");
        let session = id ? this.sessions.get(id) : undefined;
        if (
            id &&
            (!session ||
                session.issuer !== issuer ||
                session.clientId !== clientId ||
                session.subject !== subject)
        )
            throw new Problem("invalid_session");
        session ??= { id: `ses_${randomId()}`, issuer, clientId, subject };
        this.sessions.set(session.id, session);
        const access = randomId(32);
        this.tokens.set(access, { session, jkt, resource, expires: nowSeconds() + 3600 });
        return {
            access_token: access,
            token_type: "DPoP",
            expires_in: 3600,
            scope: "",
            session_id: session.id,
            signed_in: false,
        };
    }

    async authorize(request: Request, issuer: string, resource?: string): Promise<Session> {
        const [scheme, access] = (request.headers.get("authorization") ?? "").split(" ");
        const token = this.tokens.get(access);
        if (
            scheme !== "DPoP" ||
            !token ||
            token.session.issuer !== issuer ||
            token.resource !== resource ||
            token.expires <= nowSeconds()
        )
            throw new Problem("invalid_token", 401);
        if ((await this.proof(request, access)) !== token.jkt)
            throw new Problem("invalid_dpop_proof", 401);
        return token.session;
    }
}
