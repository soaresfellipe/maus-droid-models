import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";

const models = [
    { id: "auto", displayName: "Auto", kind: "router", tokenMultiplier: 1, supportedReasoningEfforts: ["none"] },
    { id: "inkling", displayName: "Inkling", tokenMultiplier: 0.4, supportedReasoningEfforts: ["off", "minimal", "low", "high", "max"] },
    { id: "minimax-m3", displayName: "MiniMax M3", tokenMultiplier: 0.12, supportedReasoningEfforts: ["high"] },
];
let model = models[0];
let effort = "none";
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const state = () => ({
    models: { currentModelId: model.id, availableModels: models.map(row => ({ modelId: row.id, name: row.displayName })) },
    configOptions: [
        { id: "model", category: "model", type: "select", currentValue: model.id, options: models.map(row => ({ value: row.id, name: row.displayName })) },
        { id: "reasoning_effort", category: "thought_level", type: "select", currentValue: effort, options: model.supportedReasoningEfforts.map(id => ({ value: id, name: id })) },
    ],
});
createInterface({ input: process.stdin }).on("line", line => {
    const request = JSON.parse(line);
    if (process.env.DROID_TEST_TRACE)
        appendFileSync(process.env.DROID_TEST_TRACE, `${JSON.stringify({ method: request.method, configId: request.params?.configId, value: request.params?.value })}\n`);
    let result = {};
    if (request.method === "droid.list_models") result = { models };
    else if (request.method === "initialize") result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
    else if (request.method === "session/new") result = { sessionId: "fixture-session", ...state() };
    else if (request.method === "session/set_model" || (request.method === "session/set_config_option" && request.params.configId === "model")) {
        model = models.find(row => row.id === (request.params.modelId ?? request.params.value));
        if (!model) throw new Error("Unknown model");
        effort = model.supportedReasoningEfforts.at(-1);
        result = state();
    }
    else if (request.method === "session/set_config_option") {
        if (request.params.configId !== "reasoning_effort" || !model.supportedReasoningEfforts.includes(request.params.value))
            throw new Error("Unsupported effort");
        effort = request.params.value;
        result = state();
    }
    else if (request.method === "session/prompt") {
        send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "DROID_EFFORT_OK" } } } });
        result = { stopReason: "end_turn" };
    }
    if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result });
});
