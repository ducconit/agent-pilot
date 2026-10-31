/**
 * verify_agent_connection - Feature section: secret/API-key redaction over the
 * bridge plus the live secret-filter toggle (records 25-26).
 *
 * The toggle test mutates the LIVE bridge's filter state, so the restore is
 * guarded by try/finally: if an assertion throws mid-way we still flip the filter
 * back to enabled, so a crash can never leave the user's running session with the
 * secret filter switched OFF.
 */
export async function run({ sendAgentCommand, tabId, getSelectedInstanceId, record }) {
  // 25. Secret & API Key Sanitizer over WebSocket Bridge
  const secretEvalBatch = {
    tabId,
    actions: [
      {
        type: "evaluate",
        expression: "JSON.stringify({ apiKey: 'sk-proj-test1234567890abcdef1234567890', awsKey: 'AKIAIOSFODNN7EXAMPLE', password: 'SecretPassword123!' })"
      }
    ]
  };
  const selectedInstanceId = getSelectedInstanceId();
  if (selectedInstanceId) secretEvalBatch.instanceId = selectedInstanceId;

  const secretRes = await sendAgentCommand("batch.run", secretEvalBatch);
  const evalResultStr = secretRes?.results?.[0]?.value || "";
  const isMaskedProperly =
    evalResultStr.includes("sk-proj") &&
    evalResultStr.includes("*****") &&
    evalResultStr.includes("[MASKED_SECRET: OpenAI API Key]") &&
    evalResultStr.includes("AKIA") &&
    evalResultStr.includes("[MASKED_SECRET: AWS Access Key]") &&
    secretRes?._securityNotice?.includes("⚠️ [SECURITY NOTICE FOR AGENT]");

  record("25. Secret & API Key Redaction over WebSocket", isMaskedProperly, "Verified API keys & credentials masked with asterisks and agent security notice attached");

  // 26. Secret Filter Config Dynamic Toggle & Bypass
  const filterConfigInitial = await sendAgentCommand("config.getSecretFilter");
  const isDefaultEnabled = filterConfigInitial?.enabled === true;

  let filterDisabled = false;
  let isBypassed = false;
  let isRestored = false;
  try {
    await sendAgentCommand("config.setSecretFilter", { enabled: false });
    filterDisabled = true;
    const disabledRes = await sendAgentCommand("batch.run", secretEvalBatch);
    const disabledResultStr = disabledRes?.results?.[0]?.value || "";
    isBypassed =
      disabledResultStr.includes("sk-proj-test1234567890abcdef1234567890") &&
      disabledRes?._securityNotice === undefined;
  } finally {
    // Always restore the live session's filter to enabled, even if an assertion throws,
    // so a crash mid-test can never leave the user's running bridge with the filter OFF.
    // Only restore when this script actually disabled it.
    if (filterDisabled) {
      try {
        await sendAgentCommand("config.setSecretFilter", { enabled: true });
        const restoredConfig = await sendAgentCommand("config.getSecretFilter");
        isRestored = restoredConfig?.enabled === true;
      } catch (_) {
        // Tolerate restore failures; the filter defaults to enabled on reconnect.
      }
    }
  }

  const isToggleWorking = isDefaultEnabled && isBypassed && isRestored;
  record("26. Secret Filter Config Dynamic Toggle", isToggleWorking, "Verified default enabled: true, bypass when toggled false, and clean restoration");
}
