export const DEFAULT_BUDGET = 32000;
export const DEFAULT_MAX_FILE_BYTES = 1000000;
export const BUDGETS = [8000, 16000, 32000, 64000, 128000, 256000, 500000, 1000000];

export const TARGET_PROFILES = Object.freeze({
  chatgpt: Object.freeze({
    id: "chatgpt",
    provider: "OpenAI",
    modelFamily: "GPT-5.6",
    contextWindow: 1050000,
    maxOutput: 128000,
    reservedHeadroom: 250000,
    safeBudget: 800000,
    aliases: ["openai", "gpt"]
  }),
  claude: Object.freeze({
    id: "claude",
    provider: "Anthropic",
    modelFamily: "Claude 5 / Claude 4.6+ long-context",
    contextWindow: 1000000,
    maxOutput: 128000,
    reservedHeadroom: 250000,
    safeBudget: 750000,
    aliases: ["anthropic"]
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    provider: "DeepSeek",
    modelFamily: "DeepSeek V4",
    contextWindow: 1000000,
    maxOutput: 384000,
    reservedHeadroom: 450000,
    safeBudget: 550000,
    aliases: ["deepseek-chat", "deepseek-reasoner"]
  }),
  chatbox: Object.freeze({
    id: "chatbox",
    provider: "Generic",
    modelFamily: "Unknown chat UI",
    contextWindow: null,
    maxOutput: null,
    reservedHeadroom: null,
    safeBudget: DEFAULT_BUDGET,
    aliases: ["generic"]
  })
});

export function resolveTargetProfile(value) {
  if (value === undefined || value === null || value === "") return null;
  const wanted = String(value).trim().toLowerCase();
  for (const profile of Object.values(TARGET_PROFILES)) {
    if (profile.id === wanted || profile.aliases.includes(wanted)) return profile;
  }
  throw new Error(
    "Unknown target: " + value + ". Supported targets: " +
    Object.keys(TARGET_PROFILES).join(", ")
  );
}

export function parseBudget(value, fallback = DEFAULT_BUDGET) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return Math.max(1, Math.floor(value));
  const match = String(value).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) throw new Error("Invalid token budget: " + value);
  const unit = match[2] === "m" ? 1000000 : match[2] === "k" ? 1000 : 1;
  return Math.max(1, Math.floor(Number(match[1]) * unit));
}

export function resolveContextBudget(target, explicitBudget) {
  const profile = resolveTargetProfile(target);
  if (explicitBudget !== undefined && explicitBudget !== null && explicitBudget !== "") {
    return { budget: parseBudget(explicitBudget), profile: profile, source: "explicit" };
  }
  if (profile) return { budget: profile.safeBudget, profile: profile, source: "target-preset" };
  return { budget: DEFAULT_BUDGET, profile: null, source: "default" };
}

export function formatTokens(tokens) {
  if (tokens < 1000) return String(tokens);
  if (tokens < 1000000) return (tokens / 1000).toFixed(tokens < 10000 ? 1 : 0) + "k";
  return (tokens / 1000000).toFixed(1) + "M";
}

export const DEFAULT_IGNORES = [
  "node_modules", ".git", ".contextpack", "dist", "build", "coverage", ".next", ".nuxt",
  ".turbo", ".cache", ".vercel", ".netlify", ".env", ".env.*", "*.lock",
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "*.map", "*.min.js",
  "*.min.css", "*.log", "*.tsbuildinfo", ".npmrc", ".pypirc", ".netrc",
  ".ssh", ".aws/credentials", "*.pem", "*.key", "*.p12", "*.pfx",
  "credentials.json", "service-account*.json"
];

export const CODE_EXTS = [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".json", ".vue", ".svelte", ".astro"];
export const TEXT_EXTS = new Set(CODE_EXTS.concat([
  ".md", ".mdx", ".txt", ".css", ".scss", ".less", ".html", ".py", ".rb",
  ".php", ".java", ".kt", ".go", ".rs", ".c", ".h", ".cpp", ".hpp", ".cs",
  ".swift", ".sh", ".sql", ".graphql", ".yaml", ".yml", ".toml", ".ini",
  ".conf", ".properties", ".xml", ".gradle"
]));
