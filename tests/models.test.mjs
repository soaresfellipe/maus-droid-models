import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { test } from "node:test";
const root = join(process.env.OPENMAUSBOT_ROOT || join(homedir(), ".local/lib/node_modules/openmausbot"), "dist-server");
const { spawnCli, killCliTree } = await import(pathToFileURL(join(root, "server/procs.js")));
const { mergeLocalInject } = await import(pathToFileURL(join(root, "server/drivers/local-inject.js")));
const moduleSource = readFileSync(`${root}/server/drivers/acp/droid.js`, "utf8");
const bundleSource = readFileSync(`${root}/index.js`, "utf8");
const code = moduleSource.slice(moduleSource.indexOf("const lastDroidModels"), moduleSource.indexOf("// droid rejects a setting")).trim();
const bundled = bundleSource.slice(bundleSource.indexOf("const lastDroidModels"), bundleSource.indexOf("async function applySetting(")).trim();
const catalog = [
    { id: "auto", displayName: "Auto" },
    { id: "inkling", displayName: "Inkling", disabled: false },
    { id: "blocked", displayName: "Blocked", disabled: true },
    { id: "custom:local", displayName: "API label", isCustom: true },
    { id: "inkling", displayName: "Duplicate" },
];

function load(overrides = {}) {
    const bindings = {
        spawnCli,
        killCliTree,
        createDroidModelLines: createInterface,
        setTimeout,
        clearTimeout,
        readSettings: () => ({}),
        mergeLocalInject: async (value) => value,
        INJECT_ID_PREFIX: "custom:openmausbot-",
        ...overrides,
    };
    return new Function(...Object.keys(bindings), `${code}\nreturn { droidModelOption, fetchDroidModels, resolveModels };`)(...Object.values(bindings));
}

function fixture() {
    const state = { reply: catalog, settings: {}, killed: 0, requests: [], fail: null, merges: 0 };
    const api = load({
        spawnCli: (cli, args, options) => {
            const child = new EventEmitter();
            child.stdin = new PassThrough();
            child.stdout = new PassThrough();
            child.stdin.once("data", (data) => {
                const request = JSON.parse(data);
                state.requests.push({ cli, args, env: options.env, request });
                queueMicrotask(() => {
                    if (state.fail === "spawn") return child.emit("error", new Error("spawn failed"));
                    if (state.fail === "exit") return child.emit("close", 1);
                    if (state.fail === "stdin") return child.stdin.emit("error", new Error("write failed"));
                    if (state.fail === "timeout") return;
                    child.stdout.write('not JSON\nnull\n{"id":"unrelated","result":{}}\n');
                    const response = JSON.stringify({
                        id: request.id,
                        ...(state.fail === "rpc" ? { error: { message: "Denied" } } : { result: { models: state.reply } }),
                    });
                    child.stdout.write(response.slice(0, 25));
                    child.stdout.write(`${response.slice(25)}\n`);
                });
            });
            return child;
        },
        killCliTree: async () => { state.killed++; },
        readSettings: () => {
            if (state.settings === null) throw new Error("missing settings");
            return state.settings;
        },
        mergeLocalInject: async (value, env) => {
            state.merges++;
            state.mergeEnv = env;
            return value;
        },
        setTimeout: (callback, ms) => {
            assert.equal(ms, 15_000);
            return setTimeout(callback, 25);
        },
    });
    return { ...api, state };
}

test("bundle and standalone use identical discovery code and auto defaults", () => {
    assert.equal(code, bundled);
    assert.match(moduleSource, /const MODELS = \{\s+default: "auto"/);
    assert.match(bundleSource, /var MODELS2 = \{\s+default: "auto"/);
});

test("request envelope, custom precedence, deduplication, policy and favorites", async () => {
    const { resolveModels, state } = fixture();
    const env = { HOME: "/fixture" };
    state.settings = {
        customModels: [
            { id: "custom:local", displayName: "Settings label" },
            { id: "custom:local", displayName: "Duplicate" },
            { id: "blocked", displayName: "Cannot bypass policy" },
            { id: "custom:openmausbot-test", model: "injected" },
            { model: "offline", displayName: "Offline" },
        ],
        modelFavorites: ["inkling", "custom:local"],
        sessionDefaultSettings: { model: "blocked" },
    };
    const result = await resolveModels(env, { cli: "/configured/droid" }, "one");
    assert.deepEqual(result.options.map((m) => m.id), ["inkling", "custom:local", "custom:offline", "auto"]);
    assert.deepEqual(result.options[1], { id: "custom:local", label: "Settings label", custom: true });
    assert.equal(result.default, "auto");
    assert.equal(state.killed, 1);
    assert.equal(state.merges, 1);
    assert.equal(state.mergeEnv, env);
    assert.equal(state.requests[0].env, env);
    assert.equal(state.requests[0].cli, "/configured/droid");
    assert.deepEqual(state.requests[0].args, ["exec", "--input-format", "stream-jsonrpc", "--output-format", "stream-jsonrpc"]);
    assert.deepEqual(state.requests[0].request, {
        factoryApiVersion: "1.0.0", factoryProtocolVersion: "1.201.1",
        type: "request", jsonrpc: "2.0", id: "openmausbot-list-models",
        method: "droid.list_models", params: { includeDisabled: true },
    });
    state.settings.sessionDefaultSettings.model = "inkling";
    assert.equal((await resolveModels(env, {}, "one")).default, "inkling");
    state.settings = null;
    assert.equal((await resolveModels(env, {}, "one")).options.length, 3);
    state.reply = [{ id: "inkling", displayName: "Inkling" }];
    assert.equal((await resolveModels(env, {}, "one")).default, "inkling");
});

test("failures clean up, retain the last valid list and do not cross instances", async () => {
    const { resolveModels, state } = fixture();
    const before = await resolveModels({}, {}, "one");
    for (const fail of ["spawn", "exit", "stdin", "timeout", "rpc"]) {
        state.fail = fail;
        assert.deepEqual(await resolveModels({}, { cli: "/invalid/droid" }, "one"), before);
        await assert.rejects(resolveModels({}, {}, `uncached-${fail}`));
    }
    state.fail = null;
    for (const reply of [null, [], [{ id: "bad" }], [{ id: "blocked", displayName: "Blocked", disabled: true }]]) {
        state.reply = reply;
        assert.deepEqual(await resolveModels({}, {}, "one"), before);
        await assert.rejects(resolveModels({}, {}, "uncached-invalid"));
    }
    assert.equal(state.killed, state.requests.length);
});

test("local model merging is unchanged", async () => {
    const { state } = fixture();
    assert.equal(state.merges, 0);
    const value = { default: "auto", options: [{ id: "auto", label: "Auto" }] };
    const merged = await mergeLocalInject(value, { VITEST: "true" });
    assert.deepEqual(merged, value);
});

test("multipliers and per-model effort variants preserve native IDs", () => {
    const { droidModelOption } = load();
    const option = droidModelOption({
        id: "inkling", displayName: "Inkling", tokenMultiplier: 0.4,
        supportedReasoningEfforts: ["off", "minimal", "high", "max", "high", null, ""],
    });
    assert.equal(option.id, "inkling");
    assert.equal(option.label, "Inkling · 0.4x");
    assert.deepEqual(option.variants.map(row => row.id), ["off", "minimal", "high", "max"]);
    assert.equal(droidModelOption({ id: "auto", displayName: "Auto", kind: "router", tokenMultiplier: 1 }).label, "Auto · Dynamic");
    assert.equal(droidModelOption({ id: "mistral", displayName: "Mistral", tokenMultiplier: 0.272 }).label, "Mistral · 0.272x");
    assert.equal(droidModelOption({ id: "free", displayName: "Free", tokenMultiplier: 0 }).label, "Free · 0x");
    for (const multiplier of [-1, Infinity, NaN, "0.4", undefined])
        assert.equal(droidModelOption({ id: "test", displayName: "Test", tokenMultiplier: multiplier }).label, "Test");
    assert.equal(droidModelOption({ id: "custom:x", displayName: "Local", tokenMultiplier: 1, isCustom: true }).label, "Local");
});

test("custom settings override labels without dropping native effort metadata", async () => {
    const { resolveModels, state } = fixture();
    state.reply = [{ id: "custom:local", displayName: "Native", isCustom: true, supportedReasoningEfforts: ["low", "high"] }];
    state.settings = { customModels: [{ id: "custom:local", displayName: "Settings label" }] };
    const { options } = await resolveModels({}, {}, "custom");
    assert.equal(options.length, 1);
    assert.equal(options[0].label, "Settings label");
    assert.deepEqual(options[0].variants.map(row => row.id), ["low", "high"]);
});

test("Droid uses native variants without changing background memory model selection", async () => {
    const source = moduleSource.replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
    const support = new Function("createAcpDriver", `${source}\nreturn DroidAgentDriver;`)(value => value);
    assert.equal(support.modelVariants, true);
    assert.equal(support.selectModel.configId, "model");
    const calls = [];
    const request = async (method, params) => { calls.push({ method, params }); return {}; };
    await support.configureSession({ request, sessionId: "session", config: {}, turn: { model: "inkling", variant: "minimal" } });
    assert.deepEqual(calls.map(row => row.method), ["session/set_mode"]);
    calls.length = 0;
    await support.configureSession({ request, sessionId: "memory", config: {}, turn: {} });
    assert.deepEqual(calls.map(row => row.method), ["session/set_mode", "session/set_model"]);
    assert.equal(calls[1].params.modelId, "auto");
});

test("live Droid catalog and invalid executable recovery", { skip: !process.env.DROID_MODELS_LIVE }, async () => {
    const children = [];
    const api = load({
        spawnCli: (...args) => {
            const child = spawnCli(...args);
            children.push(child);
            return child;
        },
    });
    const envText = process.env.DROID_MODELS_SERVER_PID
        ? readFileSync(`/proc/${process.env.DROID_MODELS_SERVER_PID}/environ`, "utf8")
        : Object.entries(process.env).map(([key, value]) => `${key}=${value}`).join("\0");
    const env = Object.fromEntries(envText.split("\0").filter(Boolean).map((entry) => {
        const at = entry.indexOf("=");
        return [entry.slice(0, at), entry.slice(at + 1)];
    }));
    const cli = process.env.DROID_CLI || "droid";
    const raw = await api.fetchDroidModels(env, cli);
    const enabled = new Set(raw.filter((m) => m.disabled !== true).map((m) => m.id));
    const blocked = new Set(raw.filter((m) => m.disabled === true).map((m) => m.id));
    const result = await api.resolveModels(env, { cli }, "live");
    assert.equal(result.options.length, enabled.size);
    assert.deepEqual(new Set(result.options.map((m) => m.id)), enabled);
    assert(result.options.every((m) => !blocked.has(m.id)));
    assert(enabled.has("inkling"));
    assert(enabled.has(result.default));
    for (const option of result.options) {
        const native = raw.find(model => model.id === option.id);
        assert.equal(option.label, api.droidModelOption(native).label);
        assert.deepEqual(option.variants?.map(row => row.id), native.supportedReasoningEfforts);
    }
    if (process.env.DROID_MODELS_SERVER_PID) {
        const cached = JSON.parse(readFileSync(join(process.env.OMB_DATA_DIR || join(homedir(), ".openmausbot"), "providers/engine-models/droid.json"), "utf8"));
        assert.deepEqual(new Set(cached.options.map((model) => model.id)), enabled);
        assert(cached.options.every((model) => !blocked.has(model.id)));
        assert(enabled.has(cached.default));
    }
    assert.deepEqual(await api.resolveModels(env, { cli: "/nonexistent/droid-model-test" }, "live"), result);
    await assert.rejects(api.resolveModels(env, { cli: "/nonexistent/droid-model-test" }, "uncached"));
    for (const child of children) {
        if (child.pid) assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
    }
    console.log(`Live catalog: ${raw.length} total, ${enabled.size} enabled, ${blocked.size} blocked; default ${result.default}`);
});
