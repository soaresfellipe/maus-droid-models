import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const directory = mkdtempSync(join(tmpdir(), "omb-droid-effort-test-"));
mkdirSync(join(directory, "native"));
process.env.OMB_DATA_DIR = directory;
process.env.VITEST = "true";
// The npm package bundles dependencies; its standalone modules cannot resolve zod.
const root = process.env.OPENMAUSBOT_ROOT || join(homedir(), ".local/lib/node_modules/openmausbot");
const bundle = readFileSync(join(root, "dist-server/index.js"), "utf8");
const marker = "var DroidAgentDriver = createAcpDriver(support5);";
const end = bundle.indexOf(marker);
assert(end > 0);
const driverModule = join(directory, "bundled-droid.mjs");
writeFileSync(driverModule, `${bundle.slice(0, end + marker.length)}\nexport { DroidAgentDriver };\n`);
const { DroidAgentDriver } = await import(pathToFileURL(driverModule));
after(() => rmSync(directory, { recursive: true, force: true }));

async function runTurn(instance, model, variant, threadId = "effort-test") {
    const events = [];
    let resolve, reject;
    const completed = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    const timer = setTimeout(() => reject(new Error("Turn timed out")), 90_000);
    const unsubscribe = instance.adapter.onEvent(event => {
        if (event.threadId !== threadId) return;
        events.push(event);
        if (event.type === "turn.completed") resolve(event);
    });
    try {
        await instance.adapter.sendTurn({
            threadId, model, ...(variant === undefined ? {} : { variant }),
            approvalMode: "ask", cwd: directory,
            text: "Responda exatamente DROID_EFFORT_OK. Não use ferramentas nem leia arquivos.",
            system: "Você é um teste de conectividade. Não execute ações nem contate outros serviços.",
        });
        const completion = await completed;
        return { completion, events };
    }
    finally {
        clearTimeout(timer);
        unsubscribe();
    }
}

test("actual ACP driver applies per-model variants, reuses sessions and refuses unsupported effort", async () => {
    const fixture = fileURLToPath(new URL("../fixtures/droid-acp.mjs", import.meta.url));
    const trace = join(directory, "fixture-trace.ndjson");
    const instance = await DroidAgentDriver.create({
        instanceId: "droid-effort-fixture", displayName: "Droid test", enabled: true,
        config: { cli: `${JSON.stringify(process.execPath)} ${JSON.stringify(fixture)}`, fullAuto: false },
        environment: { DROID_TEST_TRACE: trace, VITEST: "true" },
    });
    try {
        assert.equal(instance.adapter.capabilities.modelVariants, true);
        assert.equal(instance.models.options.find(row => row.id === "inkling").label, "Inkling · 0.4x");
        for (const variant of ["minimal", "off", "max"]) {
            const result = await runTurn(instance, "inkling", variant);
            assert.equal(result.completion.ok, true, JSON.stringify(result.events.filter(row => row.type === "runtime.error")));
            assert(result.events.some(row => row.type === "session.model-variants" && row.variants.currentValue === variant));
        }
        const invalid = await runTurn(instance, "minimax-m3", "off");
        assert.equal(invalid.completion.ok, false);
        assert(invalid.events.some(row => row.type === "runtime.error" && /does not advertise/.test(row.message)));
        const valid = await runTurn(instance, "minimax-m3", "high");
        assert.equal(valid.completion.ok, true);
        const calls = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
        assert.equal(calls.filter(row => row.method === "initialize").length, 1);
        assert.equal(calls.filter(row => row.method === "session/prompt").length, 4);
        assert.deepEqual(calls.filter(row => row.method === "session/set_config_option" && row.configId === "reasoning_effort").map(row => row.value), ["minimal", "off", "max", "high"]);
    }
    finally {
        await instance.dispose();
    }
});

test("live Droid accepts effort changes through the complete OpenMausBot driver", { skip: !process.env.DROID_METADATA_LIVE }, async () => {
    const instance = await DroidAgentDriver.create({
        instanceId: "droid-effort-live", displayName: "Droid live test", enabled: true,
        config: { cli: process.env.DROID_CLI || "droid", fullAuto: false },
        environment: { VITEST: "true" },
    });
    try {
        for (const variant of ["low", "high"]) {
            const result = await runTurn(instance, "inkling", variant, "live-effort-test");
            const native = readFileSync(join(directory, "native/live-effort-test.ndjson"), "utf8")
                .trim().split("\n").map(line => JSON.parse(line).msg);
            const request = native.filter(message => message.method === "session/set_config_option" && message.params.configId === "reasoning_effort").at(-1);
            assert.equal(request.params.value, variant);
            const acknowledgement = native.find(message => message.id === request.id && message.result);
            assert.equal(acknowledgement.result.configOptions.find(option => option.id === "model").currentValue, "inkling");
            assert.equal(acknowledgement.result.configOptions.find(option => option.id === "reasoning_effort").currentValue, variant);
            assert.equal(result.completion.ok, true, JSON.stringify(result.events.filter(row => row.type === "runtime.error")));
            assert(result.events.some(row => row.type === "session.model-variants" && row.variants.currentValue === variant));
            assert(result.events.some(row => row.type === "item.completed" && /DROID_EFFORT_OK/.test(row.text)));
            console.log(`Live Inkling: effort ${variant} confirmed; DROID_EFFORT_OK received`);
        }
    }
    finally {
        await instance.dispose();
    }
});
