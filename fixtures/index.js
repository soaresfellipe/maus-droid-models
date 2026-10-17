var KimiAgentDriver = createAcpDriver(support4);

// server/drivers/acp/droid.ts
import { existsSync as existsSync24, mkdirSync as mkdirSync33, readFileSync as readFileSync44, writeFileSync as writeFileSync16 } from "node:fs";
import { join as join65 } from "node:path";
var AUTH_FILES = ["auth.v2.file", "auth.v2.loginkeychain", "auth.v2.keyring"];
function authFilePaths(env) {
  const home = env.FACTORY_HOME_OVERRIDE || userHome(env);
  return AUTH_FILES.map((name2) => join65(home, ".factory", name2));
}
var INJECT_ID_PREFIX = "custom:openmausbot-";
function droidInjectId(host, model2) {
  const safe = `${host}-${model2}`.replace(/[^a-zA-Z0-9._+-]+/g, "-").replace(/-+/g, "-");
  return `${INJECT_ID_PREFIX}${safe}`;
}
function ensureDroidInjectModel(modelId, env = process.env) {
  const inject = decodeInjectId(modelId);
  if (!inject) return modelId;
  const host = localHost(inject.host);
  if (!host) return modelId;
  const id3 = droidInjectId(inject.host, inject.model);
  const dir = join65(env.FACTORY_HOME_OVERRIDE || userHome(env), ".factory");
  mkdirSync33(dir, { recursive: true });
  const path4 = join65(dir, "settings.json");
  let settings = {};
  try {
    settings = JSON.parse(readFileSync44(path4, "utf8"));
  } catch (error53) {
    if (existsSync24(path4)) throw error53;
  }
  const custom21 = Array.isArray(settings.customModels) ? [...settings.customModels] : [];
  const match3 = custom21.find(
    (row) => row.id === id3 || row.model === inject.model && row.baseUrl === host.baseUrl
  );
  if (match3) {
    if (!match3.id) {
      match3.id = id3;
      settings.customModels = custom21;
      writeFileSync16(path4, `${JSON.stringify(settings, null, 2)}
`);
    }
    return match3.id;
  }
  custom21.push({
    id: id3,
    model: inject.model,
    displayName: `${inject.model} (${host.label})`,
    baseUrl: host.baseUrl,
    apiKey: hostApiKey(host, env),
    provider: "generic-chat-completion-api"
  });
  settings.customModels = custom21;
  writeFileSync16(path4, `${JSON.stringify(settings, null, 2)}
`);
  return id3;
}
function applyDroidLocalAuthEnv(env, modelId) {
  if (!decodeInjectId(modelId)) return;
  if (env.FACTORY_API_KEY?.trim()) return;
  if (authFilePaths(env).some(existsSync24)) return;
  env.FACTORY_API_KEY = "openmausbot-local";
}
function readSettings(env) {
  return JSON.parse(readFileSync44(join65(env.FACTORY_HOME_OVERRIDE || userHome(env), ".factory", "settings.json"), "utf8"));
}
async function resolveModels(env) {
  let catalog = MODELS2;
  try {
    const settings = readSettings(env);
    const custom21 = (settings.customModels ?? []).flatMap((m5) => {
      if (m5.id?.startsWith(INJECT_ID_PREFIX)) return [];
      const id3 = m5.id || (m5.model ? `custom:${m5.model}` : "");
      if (!id3) return [];
      return [{ id: id3, label: m5.displayName || m5.model || id3, custom: true }];
    });
    const merged = [...custom21, ...MODELS2.options.filter((o) => !custom21.some((c3) => c3.id === o.id))];
    const rank3 = new Map((settings.modelFavorites ?? []).map((id3, i) => [id3, i]));
    const options2 = merged.sort((a3, b11) => (rank3.get(a3.id) ?? Infinity) - (rank3.get(b11.id) ?? Infinity));
    const configured2 = settings.sessionDefaultSettings?.model;
    const fallback2 = options2[0]?.id ?? MODELS2.default;
    catalog = {
      default: configured2 && options2.some((o) => o.id === configured2) ? configured2 : fallback2,
      options: options2
    };
  } catch {
  }
  return mergeLocalInject(catalog, env);
}
async function applySetting(request6, method2, params2, what) {
  try {
    await request6(method2, params2);
  } catch (e) {
    throw new Error(
      `Droid rejected ${what} via ${method2}: ${e.message}. Check that \`droid\` is current (0.196.0+ supports it) and that this account can use that value.`
    );
  }
}
var MODE_DEFAULT = "normal";
var MODE_FULL_AUTO = "auto-high";
var MODELS2 = {
  default: "claude-opus-5",
  options: [
    { id: "auto", label: "Auto (Factory picks)" },
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
    { id: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
    { id: "glm-5.2", label: "GLM 5.2" },
    { id: "kimi-k3", label: "Kimi K3" },
    { id: "grok-4.6", label: "Grok 4.6" }
  ]
};
var support5 = {
  driverKind: "droidAgent",
  displayName: "Droid",
  models: MODELS2,
  defaultCli: "droid",
  nativeSource: "droid.acp",
  loginNote: "Droid CLI is not signed in \u2014 run `droid` once and log in, or set FACTORY_API_KEY",
  install: {
    command: {
      darwin: "curl -fsSL https://app.factory.ai/cli | sh",
      linux: "curl -fsSL https://app.factory.ai/cli | sh",
      win32: "irm https://app.factory.ai/cli/windows | iex"
    },
    docsUrl: "https://docs.factory.ai/droid-cli/quickstart",
    signInCommand: "droid"
  },
  spawnArgs: () => ["exec", "-o", "acp"],
  credentialEnv: ["FACTORY_API_KEY"],
  // device-pairing is a browser flow ACP cannot drive; factory-api-key is read from the env.
  pickAuthMethod: () => null,
  authFailure: "continue",
  isAuthenticated: (env) => authFilePaths(env).some(existsSync24) || Boolean(env.FACTORY_API_KEY),
  resolveModels,
  resolveTurnModel: (model2, env) => model2 ? ensureDroidInjectModel(model2, env) : model2,
  applyTurnEnv: (env, { requestedModel }) => {
    applyDroidLocalAuthEnv(env, requestedModel);
  },
  async configureSession({ request: request6, sessionId, config: config2, turn }) {
    const modeId = config2.fullAuto ? MODE_FULL_AUTO : MODE_DEFAULT;
    await applySetting(request6, "session/set_mode", { sessionId, modeId }, `autonomy mode "${modeId}"`);
    const modelId = turn.model ?? MODELS2.default;
    await applySetting(request6, "session/set_model", { sessionId, modelId }, `model "${modelId}"`);
  },
  buildPromptText: (turn) => turn.system ? `${turn.system}

${turn.text}` : turn.text
};
var DroidAgentDriver = createAcpDriver(support5);
