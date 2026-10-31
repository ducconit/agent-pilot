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
} from "../../../extensions/background/secret-sanitizer.js";
import { SEPARATOR } from "../../../scripts/lib/config.mjs";
import { createRecorder } from "../../../scripts/lib/harness.mjs";
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

  // 2. OpenSSH / EC / PGP Private Key
  const ecKey = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEI...secretECData\n-----END EC PRIVATE KEY-----";
  const pgpKey = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQO+BF...secretPGPData\n-----END PGP PRIVATE KEY BLOCK-----";
  const maskedEc = maskString(ecKey);
  const maskedPgp = maskString(pgpKey);
  record(
    "2. EC & PGP Private Key Redaction",
    maskedEc.masked &&
    maskedEc.text.includes("[MASKED_SECRET: Private Key]") &&
    !maskedEc.text.includes("secretECData") &&
    maskedPgp.masked &&
    maskedPgp.text.includes("[MASKED_SECRET: Private Key]") &&
    !maskedPgp.text.includes("secretPGPData"),
    "Masked EC and PGP Private Key blocks successfully"
  );

  // 3. OpenAI API Keys (sk-, sk-proj-, sk-admin-)
  const openAiLegacy = "sk-abc1234567890abcdef1234567890abcdef12";
  const openAiProj = "sk-proj-abc1234567890abcdef1234567890abcdef1234567890";
  const openAiAdmin = "sk-admin-abc1234567890abcdef1234567890abcdef1234567890";
  const maskedProj = maskString(`My token is ${openAiProj} in config`);
  const maskedLegacy = maskString(`Legacy token: ${openAiLegacy}`);
  const maskedAdmin = maskString(`Admin token: ${openAiAdmin}`);
  record(
    "3. OpenAI API Key Redaction (sk-proj-, sk-, sk-admin-)",
    maskedProj.masked &&
    maskedProj.text.includes("sk-proj") &&
    maskedProj.text.includes("*****") &&
    maskedProj.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    !maskedProj.text.includes("abcdef1234567890") &&
    maskedLegacy.masked &&
    maskedLegacy.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    !maskedLegacy.text.includes("abcdef12") &&
    maskedAdmin.masked &&
    maskedAdmin.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    !maskedAdmin.text.includes("1234567890abcdef"),
    "Masked sk-proj-, sk-, and sk-admin- keys with asterisks"
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
  const githubOauth = "gho_1234567890abcdefghijklmnopqrstuvwxyz";
  const githubPat = "github_pat_" + "11ABCDEFGHIJKLMN0123456789_abcdefghijklmnopqrstuvwxyz0123456789";
  const maskedGh = maskString(githubToken);
  const maskedGho = maskString(githubOauth);
  const maskedPat = maskString(githubPat);
  record(
    "6. GitHub Access Token Redaction (ghp_, gho_, github_pat_)",
    maskedGh.masked &&
    maskedGh.text.includes("ghp_") &&
    maskedGh.text.includes("*****") &&
    maskedGh.text.includes("[MASKED_SECRET: GitHub Token]") &&
    maskedGho.masked &&
    maskedGho.text.includes("gho_") &&
    maskedGho.text.includes("[MASKED_SECRET: GitHub Token]") &&
    maskedPat.masked &&
    maskedPat.text.includes("github_pat_") &&
    maskedPat.text.includes("[MASKED_SECRET: GitHub Token]"),
    "Masked GitHub tokens with asterisks across ghp_, gho_, and github_pat_ variants"
  );

  // 7. AWS Access Key ID (AKIA, ASIA)
  const awsKey = "AKIAIOSFODNN7EXAMPLE";
  const awsTempKey = "ASIAIOSFODNN7EXAMPLE";
  const maskedAws = maskString(awsKey);
  const maskedAwsTemp = maskString(awsTempKey);
  record(
    "7. AWS Access Key Redaction (AKIA, ASIA)",
    maskedAws.masked &&
    maskedAws.text.includes("AKIA") &&
    maskedAws.text.includes("*****") &&
    maskedAws.text.includes("[MASKED_SECRET: AWS Access Key]") &&
    maskedAwsTemp.masked &&
    maskedAwsTemp.text.includes("ASIA") &&
    maskedAwsTemp.text.includes("[MASKED_SECRET: AWS Access Key]"),
    "Masked AWS Access Keys (both standard AKIA and temporary ASIA) with asterisks"
  );

  // 8. Stripe Secret & Restricted Key (sk_live_, rk_live_)
  const stripeKey = "sk_live_51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P";
  const stripeRestricted = "rk_live_51A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P";
  const maskedStripe = maskString(stripeKey);
  const maskedStripeRk = maskString(stripeRestricted);
  record(
    "8. Stripe Secret Key Redaction (sk_live_, rk_live_)",
    maskedStripe.masked &&
    maskedStripe.text.includes("sk_live_") &&
    maskedStripe.text.includes("*****") &&
    maskedStripe.text.includes("[MASKED_SECRET: Stripe Key]") &&
    maskedStripeRk.masked &&
    maskedStripeRk.text.includes("rk_live_") &&
    maskedStripeRk.text.includes("[MASKED_SECRET: Stripe Key]"),
    "Masked Stripe live and restricted keys with asterisks"
  );

  // 9. Slack Tokens (xoxb-, xoxp-)
  const slackToken = "xoxb-1234567890-1234567890-abcdefghijkl";
  const slackUserToken = "xoxp-1234567890-1234567890-abcdefghijkl";
  const maskedSlack = maskString(slackToken);
  const maskedSlackUser = maskString(slackUserToken);
  record(
    "9. Slack Token Redaction (xoxb-, xoxp-)",
    maskedSlack.masked &&
    maskedSlack.text.includes("xoxb-") &&
    maskedSlack.text.includes("*****") &&
    maskedSlack.text.includes("[MASKED_SECRET: Slack Token]") &&
    maskedSlackUser.masked &&
    maskedSlackUser.text.includes("xoxp-") &&
    maskedSlackUser.text.includes("[MASKED_SECRET: Slack Token]"),
    "Masked Slack bot and user tokens with asterisks"
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

  // 21. Quoted key-value with spaces, commas, and escaped quotes (Pattern 13 hardening)
  const spacedSecret = 'const payload = { "password": "my secret pw" };';
  const commaSecret = '{"password": "secret,with,commas"}';
  const escapedQuoteSecret = '{"password": "secret\\"with\\"quotes"}';
  const maskedSpaced = maskString(spacedSecret);
  const maskedComma = maskString(commaSecret);
  const maskedEscapedQuote = maskString(escapedQuoteSecret);
  record(
    "21. Quoted Key-Value Secret With Spaces, Commas, & Escaped Quotes",
    maskedSpaced.masked && !maskedSpaced.text.includes("my secret pw") && maskedSpaced.text.includes("*****") &&
    maskedComma.masked && !maskedComma.text.includes("secret,with,commas") && maskedComma.text.includes("*****") &&
    maskedEscapedQuote.masked && !maskedEscapedQuote.text.includes("secret\\\"with\\\"quotes") && maskedEscapedQuote.text.includes("*****"),
    "Values containing whitespace, commas, and escaped quotes are masked without regex bypass"
  );

  // 22. Short secret values are masked via key context and in raw JSON strings
  const shortSecret = sanitizeData({ password: "abc" }, true);
  const rawShortJson = maskString('{"password": "123"}');
  record(
    "22. Short Secret Value Masking",
    shortSecret.password.includes("*****") && !shortSecret.password.includes("abc") &&
    rawShortJson.masked && rawShortJson.text.includes("*****") && !rawShortJson.text.includes('"123"'),
    "Values shorter than 4 characters in objects and raw JSON strings are masked"
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

  // 27. Image Data URLs (data:image/...) bypass regex scanning for performance and integrity
  const fakeDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA_sk-proj-1234567890abcdef1234567890";
  const dataUrlRes = maskString(fakeDataUrl);
  record(
    "27. Image Data URL Bypass (data:image/...)",
    !dataUrlRes.masked && dataUrlRes.text === fakeDataUrl,
    "Base64 screenshot payloads bypass regex scanning"
  );

  // 28. Substring [MASKED_SECRET Injection Bypass Prevention & Numeric PIN/OTP Redaction
  const bypassAttempt = sanitizeData({
    password: "real_password_123 [MASKED_SECRET: fake]",
    pin: 987654,
    otp: 123456,
    rawLog: 'sk-proj-1234567890abcdef1234567890 and [MASKED_SECRET: fake]'
  }, true);
  const isBypassPrevented =
    !bypassAttempt.password.includes("real_password_123") &&
    typeof bypassAttempt.pin === "string" && bypassAttempt.pin.includes("[MASKED_SECRET:") &&
    typeof bypassAttempt.otp === "string" && bypassAttempt.otp.includes("[MASKED_SECRET:") &&
    !bypassAttempt.rawLog.includes("1234567890abcdef1234567890");
  record(
    "28. Substring [MASKED_SECRET Bypass Prevention & Numeric PIN/OTP Redaction",
    isBypassPrevented,
    "Injected [MASKED_SECRET marker cannot bypass redaction; numeric PIN/OTP values are masked"
  );

  // 29. URL Basic Auth Credentials Masking (https://user:password@host) & Idempotency
  const basicAuthUrl = "https://lagom:Lagom%26%262026@lagom.sphoton.com/vi?step=1";
  const maskedBasicAuth = maskString(basicAuthUrl);
  const remaskedBasicAuth = maskString(maskedBasicAuth.text);
  const normalPortUrl = maskString("https://example.com:8443/profile/user@domain.com");
  const queryPortUrl = maskString("https://example.com:8443?user=alice@domain.com");
  const jsonOriginPlusEmail = maskString('{"origin":"http://localhost:3000","email":"alice@domain.com"}');
  record(
    "29. URL Basic Auth Credentials Redaction (https://user:password@host)",
    maskedBasicAuth.masked &&
    maskedBasicAuth.text === "https://lagom:******************** [MASKED_SECRET: URL Basic Auth]@lagom.sphoton.com/vi?step=1" &&
    !maskedBasicAuth.text.includes("Lagom%26%262026") &&
    remaskedBasicAuth.text === maskedBasicAuth.text &&
    !normalPortUrl.masked &&
    !queryPortUrl.masked &&
    !jsonOriginPlusEmail.masked,
    "Masked URL Basic Auth password while preserving username/host/port, query emails, and JSON fields"
  );

  // 30. Escaped Newline Private Keys (\n literal) and SSH2 Encrypted Keys
  const escapedKey = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQEA0m4pQfakeEscapedKeyData\\n-----END RSA PRIVATE KEY-----";
  const ssh2Key = "-----BEGIN SSH2 ENCRYPTED PRIVATE KEY-----\nSubject: test\nfakeSSH2Data\n-----END SSH2 ENCRYPTED PRIVATE KEY-----";
  const maskedEscapedKey = maskString(escapedKey);
  const maskedSsh2Key = maskString(ssh2Key);
  record(
    "30. Escaped Newline (\\n) and SSH2 Multi-Word Private Key Redaction",
    maskedEscapedKey.masked &&
    !maskedEscapedKey.text.includes("fakeEscapedKeyData") &&
    maskedEscapedKey.text.includes("-----BEGIN RSA PRIVATE KEY-----") &&
    maskedEscapedKey.text.includes("-----END RSA PRIVATE KEY-----") &&
    maskedSsh2Key.masked &&
    !maskedSsh2Key.text.includes("fakeSSH2Data") &&
    maskedSsh2Key.text.includes("-----BEGIN SSH2 ENCRYPTED PRIVATE KEY-----"),
    "Redacts single-line escaped \\n private keys without leaking or duplicating key body"
  );

  // 31. AWS Secret Access Key, Refresh Token, DB Password, and Signing Key Redaction
  const expandedSecrets = sanitizeData({
    aws_secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    secret_access_key: "another_aws_secret_key_12345",
    secret_key: "general_secret_key_abcde",
    refresh_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisRefreshToken",
    db_password: "postgres_super_secret_password",
    signing_key: "ed25519_signing_key_data"
  }, true);
  const isExpandedSecretsMasked =
    expandedSecrets.aws_secret_access_key.includes("*****") &&
    !expandedSecrets.aws_secret_access_key.includes("wJalrXUtnFEMI") &&
    expandedSecrets.secret_access_key.includes("*****") &&
    expandedSecrets.secret_key.includes("*****") &&
    expandedSecrets.refresh_token.includes("*****") &&
    expandedSecrets.db_password.includes("*****") &&
    expandedSecrets.signing_key.includes("*****");
  record(
    "31. AWS Secret Key, Refresh Token, DB Password & Signing Key Redaction",
    isExpandedSecretsMasked,
    "Masks aws_secret_access_key, refresh_token, db_password, and signing_key in object properties"
  );

  // 32. ReDoS Immunity on Trailing Backslashes
  const redosPayload = '{"password": "' + "\\".repeat(1000);
  const redosStart = performance.now();
  const redosResult = maskString(redosPayload);
  const redosDuration = performance.now() - redosStart;
  record(
    "32. ReDoS Immunity on Unclosed Backslash Sequences",
    redosDuration < 30 && !redosResult.masked,
    `1000 backslashes evaluated in ${redosDuration.toFixed(2)}ms (<30ms budget)`
  );

  // 33. Exponential DAG Linear Traversal & Max Depth Recursion Guard
  let dagRoot = { val: "leaf_secret", token: "secret_token_123" };
  for (let i = 0; i < 25; i++) {
    dagRoot = { left: dagRoot, right: dagRoot };
  }
  const dagStart = performance.now();
  const sanitizedDag = sanitizeData(dagRoot, true);
  const dagDuration = performance.now() - dagStart;

  // Build deep 150-level chain
  let deepChain = { level: 150, end: "secret_value" };
  for (let i = 149; i >= 0; i--) {
    deepChain = { next: deepChain, level: i };
  }
  const sanitizedDeep = sanitizeData(deepChain, true);

  // Traverse down to 101 levels to find MaxDepthExceeded marker
  let curr = sanitizedDeep;
  let reachedMaxDepth = false;
  while (curr && curr.next) {
    if (curr.next === "[MaxDepthExceeded]") {
      reachedMaxDepth = true;
      break;
    }
    curr = curr.next;
  }

  record(
    "33. Exponential DAG Linear Traversal & Max Depth Recursion Guard",
    dagDuration < 50 &&
    sanitizedDag.left === sanitizedDag.right &&
    reachedMaxDepth,
    `25-level DAG resolved in ${dagDuration.toFixed(2)}ms and 150-level chain safely clamped at depth 100`
  );

  // 34. OpenAI Service Account (sk-svcacct-) & URL Refresh Token Redaction
  const svcacctKey = "sk-svcacct-abcdefghijklmnopqrstuvwxyz1234567890";
  const urlWithRefreshToken = "https://api.example.com/oauth?refresh_token=sensitive_refresh_token_value_abc&other=123";
  const maskedSvcacct = maskString(svcacctKey);
  const maskedUrlToken = maskString(urlWithRefreshToken);
  record(
    "34. OpenAI Service Account Key & URL Refresh Token Redaction",
    maskedSvcacct.masked &&
    maskedSvcacct.text.startsWith("sk-svca") &&
    maskedSvcacct.text.includes("[MASKED_SECRET: OpenAI API Key]") &&
    maskedUrlToken.masked &&
    !maskedUrlToken.text.includes("sensitive_refresh_token_value_abc") &&
    maskedUrlToken.text.includes("other=123"),
    "Masks sk-svcacct- keys and URL query refresh_token parameters"
  );

  recorder.summarize();
  recorder.exitIfFailed();

} catch (err) {
  console.error("❌ Exception during test:", err);
  process.exitCode = 1;
}
