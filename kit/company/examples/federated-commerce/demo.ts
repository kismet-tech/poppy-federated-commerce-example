import { generateKey } from "../../validate/jose.ts";
import { PersonalAgent } from "./agent.ts";
import { CommerceFixture, DIRECTORY } from "./fixture.ts";

const fixture = new CommerceFixture();
const key = await generateKey();
const clientId = "https://agent.example/client.json";
fixture.registerClient(clientId, key.publicJwk);
const agent = new PersonalAgent(fixture.fetch, clientId, key);
const { listings } = await agent.search(DIRECTORY);
console.log(`Discovered ${listings.length} public supplier listings.`);
const dates = { check_in: "2030-06-10", check_out: "2030-06-12", guests: 2 };
for (const [index, channel] of (["mcp", "conversation"] as const).entries()) {
    const { session, intent } = await agent.continueWith(
        listings[index],
        dates,
        async (company) => {
            console.log(`Demo user selects ${company.name} (${company.domain}).`);
            return true; // Simulated user input; real integrations use the Personal Agent's UI.
        },
    );
    const proposal = await agent.propose(session, intent, channel);
    fixture.dropNextConfirmation = true;
    const result = await agent.confirm(proposal, async (shown) => {
        console.log(`Demo user approves revision ${shown.revision}: ${shown.summary}`);
        return true;
    });
    console.log(`${channel}: recovered the lost confirmation response; state=${result.state}.`);
}
console.log(
    `Fulfillment records: ${fixture.ledger.size}. No real booking, payment, or external request.`,
);
