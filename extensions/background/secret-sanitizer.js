/**
 * Agent Pilot - Secret & Private Key Sanitizer / Masking Module
 * Redacts and masks API keys, tokens, and private keys with asterisks (*)
 * and appends an explicit security notice for AI Agents before responding.
 */

export const AGENT_SECURITY_NOTICE = "⚠️ [SECURITY NOTICE FOR AGENT] One or more sensitive credentials (API keys, private keys, or tokens) have been masked with asterisks (*) to protect secrets from leaking to LLM providers. Asterisks are redaction placeholders, NOT the literal key values. Do not attempt to use asterisks as credentials.";

export const SECRET_PATTERNS = [
  // 1. Private Keys (RSA, EC, OpenSSH, DSA, PGP)
  {
    name: "Private Key",
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]+?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    replacer: (match) => {
      const header = match.split("\n")[0] || "-----BEGIN PRIVATE KEY-----";
      const footer = match.trim().split("\n").pop() || "-----END PRIVATE KEY-----";
      return `${header}\n******************** [MASKED_SECRET: Private Key]\n${footer}`;
    }
  },
  // 2. OpenAI API Keys (Legacy sk- and newer sk-proj- / sk-admin-)
  {
    name: "OpenAI API Key",
    regex: /\b(?:sk-proj-[a-zA-Z0-9_-]{20,}|sk-admin-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{20,48})\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 7);
      return `${prefix}******************** [MASKED_SECRET: OpenAI API Key]`;
    }
  },
  // 3. Anthropic Claude API Keys
  {
    name: "Anthropic API Key",
    regex: /\bsk-ant-[a-zA-Z0-9_-]{20,}\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 7);
      return `${prefix}******************** [MASKED_SECRET: Anthropic API Key]`;
    }
  },
  // 4. Google Gemini / Cloud API Keys (AIzaSy...)
  {
    name: "Google API Key",
    regex: /\bAIzaSy[a-zA-Z0-9_-]{33}\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 6);
      return `${prefix}******************** [MASKED_SECRET: Google API Key]`;
    }
  },
  // 5. GitHub Personal Access Tokens
  {
    name: "GitHub Token",
    regex: /\b(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,82})\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 4);
      return `${prefix}******************** [MASKED_SECRET: GitHub Token]`;
    }
  },
  // 6. AWS Access Key IDs
  {
    name: "AWS Access Key",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 4);
      return `${prefix}******************** [MASKED_SECRET: AWS Access Key]`;
    }
  },
  // 7. Stripe API Keys
  {
    name: "Stripe Key",
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 8);
      return `${prefix}******************** [MASKED_SECRET: Stripe Key]`;
    }
  },
  // 8. Slack Tokens
  {
    name: "Slack Token",
    regex: /\bxox[baprs]-[0-9a-zA-Z-]{10,}\b/g,
    replacer: (match) => {
      const prefix = match.slice(0, 5);
      return `${prefix}******************** [MASKED_SECRET: Slack Token]`;
    }
  },
  // 9. JSON Web Tokens (JWT)
  {
    name: "JWT Token",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replacer: (match) => {
      return `eyJ******************** [MASKED_SECRET: JWT Token]`;
    }
  },
  // 10. HTTP Authorization Bearer Tokens
  {
    name: "Bearer Token",
    regex: /\bBearer\s+([A-Za-z0-9-_.+/=]{20,})\b/gi,
    replacer: (match, token) => {
      const prefix = (token || "").slice(0, 4);
      return `Bearer ${prefix}******************** [MASKED_SECRET: Bearer Token]`;
    }
  },
  // 11. URL Query Parameters (api_key=..., token=..., secret=..., password=...)
  {
    name: "URL Secret Parameter",
    regex: /([?&](?:api_key|apikey|access_token|auth_token|token|password|passwd|secret)=)([^&\s]{6,})/gi,
    replacer: (match, paramKey, secretVal) => {
      return `${paramKey}******************** [MASKED_SECRET: URL Parameter]`;
    }
  },
  // 12. JSON / Key-Value Sensitive Properties ("password": "...", "client_secret": "...")
  {
    name: "Sensitive Key-Value",
    regex: /(["']?(?:password|passwd|secret|client_?secret|access_?token|auth_?token|api_?key|authorization|proxy-authorization|cookie|set-cookie|x-api-key|credentials|token)["']?\s*[:=]\s*["'])([^"'\\,]{4,}?)(["'])/gi,
    replacer: (match, prefix, secretVal, suffix) => {
      // Never re-mask an already masked value, or the inner marker type is lost
      if (ALREADY_MASKED_REGEX.test(secretVal.trim())) return match;
      const p = secretVal.slice(0, 2);
      return `${prefix}${p}******************** [MASKED_SECRET: Sensitive Field]${suffix}`;
    }
  }
];

const ALREADY_MASKED_REGEX = /^[a-zA-Z0-9_-]{0,10}\*{20} \[MASKED_SECRET: [^\]]+\]$/;
const SENSITIVE_KEY_REGEX = /^(?:password|passwd|passcode|pin|otp|secret|api_?key|x-api-key|access_?token|auth_?token|private_?key|client_?secret|authorization|proxy-authorization|cookie|set-cookie|credentials|token)$/i;

/**
 * Mask a single string by checking all secret patterns.
 * Returns { text: string, masked: boolean, types: string[] }
 */
export function maskString(text) {
  if (typeof text !== "string" || text.length === 0 || text.startsWith("data:image/")) {
    return { text, masked: false, types: [] };
  }

  let result = text;
  let masked = false;
  const types = new Set();

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    result = result.replace(pattern.regex, (...args) => {
      const match = args[0];
      if (ALREADY_MASKED_REGEX.test(match.trim())) return match;
      const replaced = pattern.replacer(...args);
      if (replaced !== match) {
        masked = true;
        types.add(pattern.name);
      }
      return replaced;
    });
  }

  return { text: result, masked, types: Array.from(types) };
}

/**
 * Recursively sanitize deep objects, arrays, and primitive data.
 * Returns { data, maskedCount, types } so callers can surface masking metadata
 * in transport envelopes (arrays lose attached properties during JSON.stringify).
 */
export function sanitizeDataWithMeta(data, isEnabled = true) {
  if (!isEnabled || data === null || data === undefined) {
    return { data, maskedCount: 0, types: [] };
  }

  let totalMaskedCount = 0;
  const allMaskedTypes = new Set();

  function walk(val, keyContext = "", ancestors = new WeakSet()) {
    if (val === null || val === undefined) return val;

    if (typeof val === "string") {
      // First check if property key context is sensitive
      if (keyContext && SENSITIVE_KEY_REGEX.test(keyContext) && val.length >= 1 && !ALREADY_MASKED_REGEX.test(val.trim())) {
        totalMaskedCount++;
        allMaskedTypes.add(`Field:${keyContext}`);
        const prefix = val.slice(0, 2);
        return `${prefix}******************** [MASKED_SECRET: ${keyContext}]`;
      }

      // Check regex patterns
      const maskedRes = maskString(val);
      if (maskedRes.masked) {
        totalMaskedCount += maskedRes.types.length;
        maskedRes.types.forEach((t) => allMaskedTypes.add(t));
        return maskedRes.text;
      }
      return val;
    }

    if (typeof val === "number" || typeof val === "bigint") {
      if (keyContext && SENSITIVE_KEY_REGEX.test(keyContext)) {
        totalMaskedCount++;
        allMaskedTypes.add(`Field:${keyContext}`);
        return `******************** [MASKED_SECRET: ${keyContext}]`;
      }
      return val;
    }

    if (typeof val === "boolean" || typeof val === "symbol") {
      return val;
    }

    if (Array.isArray(val)) {
      if (ancestors.has(val)) return "[Circular]";
      ancestors.add(val);
      const copy = val.map((item) => walk(item, keyContext, ancestors));
      ancestors.delete(val);
      return copy;
    }

    if (typeof val === "object") {
      if (ancestors.has(val)) return "[Circular]";
      ancestors.add(val);

      let entries;
      try {
        entries = Object.entries(val);
      } catch (_) {
        ancestors.delete(val);
        return "[Unreadable]";
      }

      const copy = {};
      for (const [k, v] of entries) {
        copy[k] = walk(v, k, ancestors);
      }
      ancestors.delete(val);
      return copy;
    }

    return val;
  }

  const sanitized = walk(data);
  const meta = { maskedCount: totalMaskedCount, types: Array.from(allMaskedTypes) };

  // If secrets were masked, attach notice for objects and strings
  if (totalMaskedCount > 0) {
    if (typeof sanitized === "string") {
      return { data: `${sanitized}\n\n${AGENT_SECURITY_NOTICE}`, ...meta };
    }
    if (sanitized && typeof sanitized === "object") {
      sanitized._securityNotice = AGENT_SECURITY_NOTICE;
      sanitized._maskedCount = totalMaskedCount;
      sanitized._maskedTypes = meta.types;
    }
  }

  return { data: sanitized, ...meta };
}

/**
 * Backward-compatible wrapper returning only the sanitized data.
 */
export function sanitizeData(data, isEnabled = true) {
  return sanitizeDataWithMeta(data, isEnabled).data;
}
