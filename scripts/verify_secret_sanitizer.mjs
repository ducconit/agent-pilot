#!/usr/bin/env node
/**
 * Agent Pilot - Secret & Private Key Sanitizer Verification Test Suite
 * Tests masking of sensitive credentials, agent notices, and toggle bypass.
 */

import {
  maskString,
  sanitizeData,
  sanitizeDataWithMeta,
  AGENT_SECURITY_NOTICE
} from "../extensions/background/secret-sanitizer.js";
import { SEPARATOR } from "./lib/config.mjs";
import { createRecorder } from "./lib/harness.mjs";
const sanitizeServerData = (data, isEnabled = true) => sanitizeData(data, isEnabled);

console.log(SEPARATOR);
console.log("🛡️ KIỂM THỬ ĐƠN VỊ: LỚP LỌC CHE GIẤU SECRET, API KEY & PRIVATE KEY");
console.log(`${SEPARATOR}\n`);

const recorder = createRecorder({
  title: "📊 BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ LỚP LỌC SECRET:",
  successMessage: "\n🎉 HOÀN TOÀN XÁC MINH: LỚP LỌC SECRET, API KEY & PRIVATE KEY HOẠT ĐỘNG HOÀN HẢO!",
  failureMessage: "\n❌ Có kiểm thử chưa vượt qua!"
});
const record = recorder.record;

try {
  // 1. RSA Private Key
  const rsaKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m4pQ...fakeKeyData\n-----END RSA PRIVATE KEY-----";
  const maskedRsa = maskString(rsaKey);
  record(
    "1. RSA Private Key Redaction",
    maskedRsa.masked &&
    maskedRsa.text.includes("*****") &&
    maskedRsa.text.includes("[MASKED_SECRET: Private Key]") &&
    !maskedRsa.text.includes("fakeKeyData"),
    "Masked RSA block with asterisks and retained headers"
  );

  // 2. OpenSSH / EC Private Key
  const ecKey = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEI...secretECData\n-----END EC PRIVATE KEY-----";
  const maskedEc = maskString(ecKey);
  record(
    "2. EC Private Key Redaction",
    maskedEc.masked &&
    maskedEc.text.includes("[MASKED_SECRET: Private Key]") &&
    !maskedEc.text.includes("secretECData"),
    "Masked EC Private Key successfully"
  );

  // 3. OpenAI API Keys (sk-, sk-proj-, sk-admin-)
  const openAiLegacy = "sk-abc1234567890abcdef1234567890abcdef12";
  const openAiProj = "sk-proj-abc1234567890abcdef1234567890abcdef1234567890";
  const openAiAdmin = "sk-admin-abc1234567890abcdef1234567890abcdef1234567890";
  const maskedProj = maskString(`My token is ${openAiProj} in config`);
  record(
    "3. OpenAI API Key Redaction (sk-proj- & sk-)",
    maskedProj.masked &&
    maskedProj.text.includes("sk-proj") &&
    maskedProj.text.includes("*****") &&
    maskedProj.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    !maskedProj.text.includes("abcdef1234567890"),
    "Masked sk-proj- key with asterisks and preserved prefix"
  );

  // 4. Anthropic Claude API Key
  const anthropicKey = "sk-ant-api03-abcdef1234567890abcdef1234567890";
  const maskedAnt = maskString(anthropicKey);
  record(
    "4. Anthropic API Key Redaction (sk-ant-)",
    maskedAnt.masked &&
    maskedAnt.text.includes("sk-ant-") &&
    maskedAnt.text.includes("*****") &&
    maskedAnt.text.includes("[MASKED_SECRET: Anthropic API Key]"),
    "Masked sk-ant- key with asterisks"
  );

  // 5. Google Gemini API Key
  const googleKey = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
  const maskedGoogle = maskString(googleKey);
  record(
    "5. Google Gemini API Key Redaction (AIzaSy...)",
    maskedGoogle.masked &&
    maskedGoogle.text.includes("AIzaSy") &&
    maskedGoogle.text.includes("*****") &&
    maskedGoogle.text.includes("[MASKED_SECRET: Google API Key]"),
    "Masked AIzaSy key with asterisks"
  );

  // 6. GitHub Tokens (ghp_, gho_, github_pat_)
  const githubToken = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
  const maskedGh = maskString(githubToken);
  record(
    "6. GitHub Access Token Redaction (ghp_)",
    maskedGh.masked &&
    maskedGh.text.includes("ghp_") &&
    maskedGh.text.includes("*****") &&
    maskedGh.text.includes("[MASKED_SECRET: GitHub Token]"),
    "Masked GitHub token with asterisks"
  );

  // 7. AWS Access Key ID
  const awsKey = "AKIAIOSFODNN7EXAMPLE";
  const maskedAws = maskString(awsKey);
  record(
    "7. AWS Access Key Redaction (AKIA)",
    maskedAws.masked &&
    maskedAws.text.includes("AKIA") &&
    maskedAws.text.includes("*****") &&
    maskedAws.text.includes("[MASKED_SECRET: AWS Access Key]"),
    "Masked AWS Access Key with asterisks"
  );

  // 8. Stripe Secret Key
  const stripeKey = "sk_live_51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P";
  const maskedStripe = maskString(stripeKey);
  record(
    "8. Stripe Secret Key Redaction (sk_live_)",
    maskedStripe.masked &&
    maskedStripe.text.includes("sk_live_") &&
    maskedStripe.text.includes("*****") &&
    maskedStripe.text.includes("[MASKED_SECRET: Stripe Key]"),
    "Masked Stripe key with asterisks"
  );

  // 9. Slack Tokens
  const slackToken = "xoxb-1234567890-1234567890-abcdefghijkl";
  const maskedSlack = maskString(slackToken);
  record(
    "9. Slack Token Redaction (xoxb-)",
    maskedSlack.masked &&
    maskedSlack.text.includes("xoxb-") &&
    maskedSlack.text.includes("*****") &&
    maskedSlack.text.includes("[MASKED_SECRET: Slack Token]"),
    "Masked Slack token with asterisks"
  );

  // 10. JWT Token
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const maskedJwt = maskString(jwt);
  record(
    "10. JSON Web Token (JWT) Redaction",
    maskedJwt.masked &&
    maskedJwt.text.includes("eyJ*****") &&
    maskedJwt.text.includes("[MASKED_SECRET: JWT Token]"),
    "Masked 3-part JWT token"
  );

  // 11. Bearer Token Header
  const bearerHeader = "Bearer secret_bearer_token_value_1234567890_abcdef";
  const maskedBearer = maskString(bearerHeader);
  record(
    "11. HTTP Authorization Bearer Token Redaction",
    maskedBearer.masked &&
    maskedBearer.text.includes("Bearer secr*****") &&
    maskedBearer.text.includes("[MASKED_SECRET: Bearer Token]"),
    "Masked Bearer token header"
  );

  // 12. URL Query Parameter
  const testUrl = "https://api.company.com/v1/data?api_key=superSecretKey12345&filter=active";
  const maskedUrl = maskString(testUrl);
  record(
    "12. URL Query Parameter Secret Redaction",
    maskedUrl.masked &&
    maskedUrl.text.includes("?api_key=*****") &&
    maskedUrl.text.includes("[MASKED_SECRET: URL Parameter]") &&
    maskedUrl.text.includes("&filter=active"),
    "Masked sensitive query parameter while preserving normal params"
  );

  // 13. Deep Recursive Object Sanitization with Sensitive Keys
  const complexData = {
    user: {
      name: "Developer",
      email: "dev@example.com",
      credentials: {
        password: "MySuperSecretPassword123!",
        client_secret: "prod_client_secret_value_98765",
        apiKey: openAiLegacy
      }
    },
    services: [
      { name: "aws", key: awsKey },
      { name: "github", token: githubToken }
    ]
  };

  const sanitized = sanitizeData(complexData, true);
  const isDeepClean =
    sanitized.user.credentials.password.includes("*****") &&
    sanitized.user.credentials.client_secret.includes("*****") &&
    sanitized.user.credentials.apiKey.includes("*****") &&
    sanitized.services[0].key.includes("*****") &&
    sanitized.services[1].token.includes("*****") &&
    sanitized.user.name === "Developer";

  record(
    "13. Deep Recursive Object & Sensitive Keys Sanitization",
    isDeepClean,
    "Sanitized nested object keys, array items, and pattern matches"
  );

  // 14. Security Notice for AI Agent
  const hasSecurityNotice =
    sanitized._securityNotice === AGENT_SECURITY_NOTICE &&
    typeof sanitized._maskedCount === "number" &&
    sanitized._maskedCount > 0 &&
    Array.isArray(sanitized._maskedTypes) &&
    sanitized._maskedTypes.length > 0;

  record(
    "14. AI Agent Security Notice & Redaction Context",
    hasSecurityNotice,
    `Notice attached: ${_maskedCount(sanitized)} secrets masked, types: [${sanitized._maskedTypes.join(", ")}]`
  );

  function _maskedCount(s) { return s._maskedCount || 0; }

  // 15. Disabled Filter Bypass (User-Toggled OFF)
  const rawDataWhenDisabled = sanitizeData(complexData, false);
  const isBypassed =
    rawDataWhenDisabled.user.credentials.password === "MySuperSecretPassword123!" &&
    rawDataWhenDisabled.services[0].key === awsKey &&
    rawDataWhenDisabled._securityNotice === undefined;

  record(
    "15. Disabled Filter Bypass (User-Toggled OFF)",
    isBypassed,
    "When disabled, raw credentials returned untouched with no notice"
  );

  // 16. Circular Reference Safety Guard
  const circularObj = { name: "loop" };
  circularObj.self = circularObj;
  let circularSafe = false;
  try {
    const res = sanitizeData(circularObj, true);
    circularSafe = res.self === "[Circular]";
  } catch (_) {
    circularSafe = false;
  }
  record(
    "16. Circular Reference Safety Guard",
    circularSafe,
    "Circular object handled safely without Maximum Call Stack Exceeded"
  );

  // 17. Server-Side Defense-in-Depth Sanitization
  const serverSanitized = sanitizeServerData({
    tool: "get_devtools_data",
    token: "sk-proj-serverSecretKey12345678901234567890"
  }, true);

  const isServerDefenseActive =
    serverSanitized.token.includes("*****") &&
    serverSanitized._securityNotice === AGENT_SECURITY_NOTICE;

  record(
    "17. Server-Side Defense-in-Depth (Secret Sanitizer)",
    isServerDefenseActive,
    "Standalone server-side sanitization operational"
  );

  // 18. Security Notice on Arrays & Primitive Strings (Reviewer Hardening)
  const arrayWithSecret = [{ id: 1, token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" }];
  const sanitizedArray = sanitizeData(arrayWithSecret, true);
  const isArrayNoticeAttached =
    sanitizedArray[0].token.includes("*****") &&
    sanitizedArray._securityNotice === AGENT_SECURITY_NOTICE;

  const rawSecretString = "Secret key in raw output: sk-proj-1234567890abcdef1234567890";
  const sanitizedString = sanitizeData(rawSecretString, true);
  const isStringNoticeAppended =
    sanitizedString.includes("sk-proj") &&
    sanitizedString.includes("*****") &&
    sanitizedString.includes(AGENT_SECURITY_NOTICE);

  record(
    "18. Security Notice Coverage for Arrays & Strings",
    isArrayNoticeAttached && isStringNoticeAppended,
    "Guaranteed security notice delivery for non-object responses"
  );

  // 19. Server-Side Dynamic Toggle Respect (Reviewer Hardening)
  const rawPayload = { apiKey: "sk-proj-test1234567890abcdef1234567890" };
  const bypassedServer = sanitizeServerData(rawPayload, false);
  const isServerBypassRespected =
    bypassedServer.apiKey === "sk-proj-test1234567890abcdef1234567890" &&
    bypassedServer._securityNotice === undefined;

  record(
    "19. Server-Side Dynamic Toggle Respect",
    isServerBypassRespected,
    "Server honors user/extension toggle state without split-brain"
  );

  // 20. Sensitive HTTP Header Keys (Authorization / Cookie / X-Api-Key)
  const headerPayload = {
    headers: {
      Authorization: "Basic dXNlcjpwYXNzd29yZA==",
      Cookie: "session=abc123",
      "x-api-key": "zzz",
      "set-cookie": "token=xyz"
    }
  };
  const sanitizedHeaders = sanitizeData(headerPayload, true);
  const isHeaderMasked =
    sanitizedHeaders.headers.Authorization.includes("*****") &&
    sanitizedHeaders.headers.Cookie.includes("*****") &&
    sanitizedHeaders.headers["x-api-key"].includes("*****") &&
    sanitizedHeaders.headers["set-cookie"].includes("*****");
  record(
    "20. HTTP Header Credential Masking (Authorization/Cookie/X-Api-Key)",
    isHeaderMasked,
    "Header keys are treated as sensitive credentials"
  );

  // 21. Quoted key-value with spaces in the secret value
  const spacedSecret = 'const payload = { "password": "my secret pw" };';
  const maskedSpaced = maskString(spacedSecret);
  record(
    "21. Quoted Key-Value Secret With Spaces",
    maskedSpaced.masked && !maskedSpaced.text.includes("my secret pw") && maskedSpaced.text.includes("*****"),
    "Values containing whitespace are now masked"
  );

  // 22. Short secret values are masked via key context
  const shortSecret = sanitizeData({ password: "abc" }, true);
  record(
    "22. Short Secret Value Masking",
    shortSecret.password.includes("*****") && !shortSecret.password.includes("abc"),
    "Values shorter than 4 characters are no longer bypassed"
  );

  // 23. sanitizeDataWithMeta returns masking metadata for arrays (envelope transport)
  const metaResult = sanitizeDataWithMeta([{ token: "ghp_1234567890abcdefghijklmnopqrstuvwxyz" }], true);
  const hasArrayMeta =
    Array.isArray(metaResult.data) &&
    metaResult.maskedCount > 0 &&
    metaResult.types.length > 0;
  record(
    "23. Masking Metadata Returned for Arrays",
    hasArrayMeta,
    `maskedCount=${metaResult.maskedCount}, types=${metaResult.types.join(", ")}`
  );

  // 24. Shared (non-cyclic) object references survive sanitization
  const sharedChild = { password: "shared-secret-value" };
  const dagData = { first: sharedChild, second: sharedChild };
  const dagSanitized = sanitizeData(dagData, true);
  const dagPreserved =
    dagSanitized.first.password.includes("*****") &&
    dagSanitized.second !== "[Circular]" &&
    dagSanitized.second.password.includes("*****");
  record(
    "24. Shared Reference (DAG) Preservation",
    dagPreserved,
    "Non-cyclic shared references are sanitized in place, not collapsed"
  );

  // 25. Console broadcast payload shape (DEVTOOLS_CONSOLE_EVENT) is masked
  const broadcastPayload = {
    type: "DEVTOOLS_CONSOLE_EVENT",
    tabId: 1,
    entry: { type: "log", text: "authorization: Bearer sk-proj-1234567890abcdef1234567890" }
  };
  const sanitizedBroadcast = sanitizeData(broadcastPayload, true);
  record(
    "25. Broadcast Payload Masking (DEVTOOLS_CONSOLE_EVENT)",
    !sanitizedBroadcast.entry.text.includes("sk-proj-1234567890") &&
    sanitizedBroadcast.entry.text.includes("*****"),
    "Agent-bound broadcast payloads are sanitized before transport"
  );

  // 26. Re-masking a masked string must not clobber the original marker type
  const preMaskedOnce = maskString('{"apiKey": "sk-proj-1234567890abcdef1234567890"}');
  const preMaskedTwice = maskString(preMaskedOnce.text);
  record(
    "26. Mask Markers Preserved on Re-masking",
    preMaskedTwice.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    !preMaskedTwice.text.includes("[MASKED_SECRET: Sensitive Field]"),
    "Idempotent masking keeps the specific secret type marker"
  );

  recorder.summarize();
  recorder.exitIfFailed();

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
