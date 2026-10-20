// Application-specific example data, not a new Poppy extension or commerce schema.
export type Fetch = (request: Request) => Promise<Response>;
export type Listing = { company_domain: string; listing_url: string };
export type Intent = { listing_url: string; check_in: string; check_out: string; guests: number };
export type Manifest = {
    protocol_version: string;
    organization: { name: string; domain: string };
    auth: { issuer: string };
    apis: { type: string; url: string; description: string }[];
    agent?: { protocols: { type: string; endpoint: string }[] };
    extensions?: { operations?: { version: string; endpoint: string } };
};
export type Metadata = { issuer: string; token_endpoint: string; poppy_domains: string[] };
export type Operation = {
    operation_id: string;
    revision: number;
    state: "proposed" | "in_progress" | "succeeded" | "expired";
    summary: string;
    terms: Intent & {
        total: { amount: string; currency: string };
        cancellation: "Free before arrival";
        fulfillment: "Simulated reservation; no payment taken";
    };
    expires_at: string;
    user_approval_required: true;
    confirmation: { revision: number; approved_by: "user"; confirmed_at: string } | null;
    result: { summary: string; data?: { reservation_id: string } } | null;
};

export class Problem extends Error {
    code: string;
    status: number;
    operation?: Operation;
    constructor(code: string, status = 400, operation?: Operation) {
        super(code);
        this.code = code;
        this.status = status;
        this.operation = operation;
    }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });
}

export function https(value: string): URL {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw new Problem("unsafe_url");
    return url;
}

export function metadataUrl(issuer: string) {
    const url = https(issuer);
    return `${url.origin}/.well-known/oauth-authorization-server${url.pathname === "/" ? "" : url.pathname}`;
}

export async function body<T>(response: Response): Promise<T> {
    const data = await response.json();
    if (!response.ok)
        throw new Problem(data.error ?? "http_error", response.status, data.operation);
    return data as T;
}

// Only these fields cross the handoff. Never spread a catalog response into a supplier request.
export function shoppingIntent(listing: Listing, dates: Omit<Intent, "listing_url">): Intent {
    const url = https(listing.listing_url);
    if (url.host !== listing.company_domain || url.search) throw new Problem("foreign_listing");
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(dates.check_in) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(dates.check_out) ||
        dates.check_in >= dates.check_out ||
        !Number.isInteger(dates.guests) ||
        dates.guests < 1 ||
        dates.guests > 8
    )
        throw new Problem("invalid_shopping_intent");
    return {
        listing_url: url.href,
        check_in: dates.check_in,
        check_out: dates.check_out,
        guests: dates.guests,
    };
}
