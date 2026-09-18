package main

import (
	"fmt"
	"regexp"
	"strings"
)

// AgentSecurityNotice is appended when secrets are masked
const AgentSecurityNotice = "⚠️ [SECURITY NOTICE FOR AGENT] One or more sensitive credentials (API keys, private keys, or tokens) have been masked with asterisks (*) to protect secrets from leaking to LLM providers. Asterisks are redaction placeholders, NOT the literal key values. Do not attempt to use asterisks as credentials."

type secretPattern struct {
	name     string
	regex    *regexp.Regexp
	replacer func(string) string
}

var sensitivePropRegex = regexp.MustCompile(`(?i)^(?:password|passwd|secret|api_?key|x-api-key|access_?token|auth_?token|private_?key|client_?secret|authorization|proxy-authorization|cookie|set-cookie|credentials|token)$`)
var sensitiveKvRegex = regexp.MustCompile(`(?i)(["']?(?:password|passwd|secret|client_?secret|access_?token|auth_?token|api_?key|authorization|proxy-authorization|cookie|set-cookie|x-api-key|credentials|token)["']?\s*[:=]\s*["'])([^"'\\,]{4,}?)(["'])`)

var secretPatterns = []secretPattern{

	// 1. Private Keys (RSA, EC, OpenSSH, DSA, PGP)
	{
		name:  "Private Key",
		regex: regexp.MustCompile(`(?s)-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----`),
		replacer: func(match string) string {
			lines := strings.Split(match, "\n")
			header := "-----BEGIN PRIVATE KEY-----"
			if len(lines) > 0 && strings.TrimSpace(lines[0]) != "" {
				header = strings.TrimSpace(lines[0])
			}
			footer := "-----END PRIVATE KEY-----"
			if len(lines) > 1 && strings.TrimSpace(lines[len(lines)-1]) != "" {
				footer = strings.TrimSpace(lines[len(lines)-1])
			}
			return fmt.Sprintf("%s\n******************** [MASKED_SECRET: Private Key]\n%s", header, footer)
		},
	},
	// 2. OpenAI API Keys (sk-proj-, sk-admin-, sk-)
	{
		name:  "OpenAI API Key",
		regex: regexp.MustCompile(`\b(?:sk-proj-[a-zA-Z0-9_-]{20,}|sk-admin-[a-zA-Z0-9_-]{20,}|sk-[a-zA-Z0-9]{20,48})\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 7 {
				prefix = prefix[:7]
			}
			return prefix + "******************** [MASKED_SECRET: OpenAI API Key]"
		},
	},
	// 3. Anthropic Claude API Keys
	{
		name:  "Anthropic API Key",
		regex: regexp.MustCompile(`\bsk-ant-[a-zA-Z0-9_-]{20,}\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 7 {
				prefix = prefix[:7]
			}
			return prefix + "******************** [MASKED_SECRET: Anthropic API Key]"
		},
	},
	// 4. Google Gemini / Cloud API Keys (AIzaSy...)
	{
		name:  "Google API Key",
		regex: regexp.MustCompile(`\bAIzaSy[a-zA-Z0-9_-]{33}\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 6 {
				prefix = prefix[:6]
			}
			return prefix + "******************** [MASKED_SECRET: Google API Key]"
		},
	},
	// 5. GitHub Personal Access Tokens
	{
		name:  "GitHub Token",
		regex: regexp.MustCompile(`\b(?:ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{50,82})\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 4 {
				prefix = prefix[:4]
			}
			return prefix + "******************** [MASKED_SECRET: GitHub Token]"
		},
	},
	// 6. AWS Access Key IDs
	{
		name:  "AWS Access Key",
		regex: regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 4 {
				prefix = prefix[:4]
			}
			return prefix + "******************** [MASKED_SECRET: AWS Access Key]"
		},
	},
	// 7. Stripe API Keys
	{
		name:  "Stripe Key",
		regex: regexp.MustCompile(`\b(?:sk|pk|rk)_(?:live|test)_[0-9a-zA-Z]{24,}\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 8 {
				prefix = prefix[:8]
			}
			return prefix + "******************** [MASKED_SECRET: Stripe Key]"
		},
	},
	// 8. Slack Tokens
	{
		name:  "Slack Token",
		regex: regexp.MustCompile(`\bxox[baprs]-[0-9a-zA-Z-]{10,}\b`),
		replacer: func(match string) string {
			prefix := match
			if len(prefix) > 5 {
				prefix = prefix[:5]
			}
			return prefix + "******************** [MASKED_SECRET: Slack Token]"
		},
	},
	// 9. JSON Web Tokens (JWT)
	{
		name:  "JWT Token",
		regex: regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b`),
		replacer: func(match string) string {
			return "eyJ******************** [MASKED_SECRET: JWT Token]"
		},
	},
	// 10. HTTP Authorization Bearer Tokens
	{
		name:  "Bearer Token",
		regex: regexp.MustCompile(`(?i)\bBearer\s+([A-Za-z0-9-_.+/=]{20,})\b`),
		replacer: func(match string) string {
			parts := strings.Fields(match)
			token := ""
			if len(parts) > 1 {
				token = parts[1]
			}
			prefix := token
			if len(prefix) > 4 {
				prefix = prefix[:4]
			}
			return fmt.Sprintf("Bearer %s******************** [MASKED_SECRET: Bearer Token]", prefix)
		},
	},
	// 11. URL Query Parameters
	{
		name:  "URL Secret Parameter",
		regex: regexp.MustCompile(`(?i)([?&](?:api_key|apikey|access_token|auth_token|token|password|passwd|secret)=)([^&\s]{6,})`),
		replacer: func(match string) string {
			idx := strings.Index(match, "=")
			if idx != -1 {
				return match[:idx+1] + "******************** [MASKED_SECRET: URL Parameter]"
			}
			return match
		},
	},
	// 12. Sensitive Key-Value ("password": "...")
	{
		name:  "Sensitive Key-Value",
		regex: sensitiveKvRegex,
		replacer: func(match string) string {
			sub := sensitiveKvRegex.FindStringSubmatch(match)
			if len(sub) == 4 {
				prefix := sub[1]
				secretVal := sub[2]
				suffix := sub[3]
				p := ""
				if len(secretVal) >= 2 {
					p = secretVal[:2]
				}
				return prefix + p + "******************** [MASKED_SECRET: Sensitive Field]" + suffix
			}
			return "******************** [MASKED_SECRET: Sensitive Field]"
		},
	},
}

// MaskString inspects a single string and masks any secret patterns found.
func MaskString(text string) (string, bool, []string) {
	if len(text) == 0 || strings.Contains(text, "[MASKED_SECRET") {
		return text, false, nil
	}

	result := text
	masked := false
	var types []string

	for _, p := range secretPatterns {
		if p.regex.MatchString(result) {
			result = p.regex.ReplaceAllStringFunc(result, func(m string) string {
				masked = true
				types = append(types, p.name)
				return p.replacer(m)
			})
		}
	}

	return result, masked, types
}

// SanitizeData recursively inspects and masks sensitive keys in map or slice payloads.
func SanitizeData(data interface{}, isEnabled bool) interface{} {
	if !isEnabled || data == nil {
		return data
	}

	totalMasked := 0
	allTypes := make(map[string]bool)

	var walk func(val interface{}, keyContext string) interface{}
	walk = func(val interface{}, keyContext string) interface{} {
		if val == nil {
			return nil
		}

		switch v := val.(type) {
		case string:
			if strings.Contains(v, "[MASKED_SECRET") {
				return v
			}
			if keyContext != "" && sensitivePropRegex.MatchString(keyContext) && len(v) >= 1 {
				totalMasked++
				allTypes["Field:"+keyContext] = true
				prefix := v
				if len(prefix) > 2 {
					prefix = prefix[:2]
				}
				return fmt.Sprintf("%s******************** [MASKED_SECRET: %s]", prefix, keyContext)
			}
			maskedText, didMask, tList := MaskString(v)
			if didMask {
				totalMasked += len(tList)
				for _, t := range tList {
					allTypes[t] = true
				}
				return maskedText
			}
			return v

		case map[string]interface{}:
			copyMap := make(map[string]interface{}, len(v))
			for k, item := range v {
				copyMap[k] = walk(item, k)
			}
			return copyMap

		case []interface{}:
			copySlice := make([]interface{}, len(v))
			for i, item := range v {
				copySlice[i] = walk(item, keyContext)
			}
			return copySlice

		default:
			return val
		}
	}

	sanitized := walk(data, "")

	if totalMasked > 0 {
		switch m := sanitized.(type) {
		case string:
			return fmt.Sprintf("%s\n\n%s", m, AgentSecurityNotice)
		case map[string]interface{}:
			var typeList []string
			for t := range allTypes {
				typeList = append(typeList, t)
			}
			m["_securityNotice"] = AgentSecurityNotice
			m["_maskedCount"] = totalMasked
			m["_maskedTypes"] = typeList
			return m
		}
	}

	return sanitized
}
