package cli

import (
	"encoding/json"
	"fmt"
	"github.com/spf13/cobra"
)

// A JSON payload preserves the complete MCP surface without a second schema
// implementation in the CLI. Frequently used operations have readable aliases.
func newDevtoolsCommand() *cobra.Command {
	methods := map[string]string{
		"status": "devtools.runtime", "css": "css.getStyles", "audit": "lighthouse.audit", "audit-details": "lighthouse.analyze",
		"trace-insight": "performance.analyzeInsight", "video-start": "screencast.record", "video-stop": "screencast.record",
		"context-create": "contexts.create", "contexts": "contexts.list", "context-close": "contexts.close", "workers": "workers.debug",
		"ax": "accessibility.snapshot", "emulate": "emulation.set", "heap-capability": "memory.heapCapability",
		"heap-analyze": "memory.analyzeSnapshot", "3p-list": "developerTools.list", "3p-execute": "developerTools.execute",
		"webmcp-list": "webmcp.list", "webmcp-execute": "webmcp.execute", "pwa-probe": "pwa.probe",
		"pwa-state": "pwa.getOsAppState", "pwa-install": "pwa.install", "pwa-launch": "pwa.launch", "pwa-uninstall": "pwa.uninstall",
	}
	cmd := newLeafCommand("devtools", nil, func(args []string) error {
		parsed, err := parseCmdArgs(args, []FlagDef{{Name: "params"}, {Name: "tab", Aliases: []string{"t"}}})
		if err != nil {
			return err
		}
		if len(parsed.Positional) != 1 {
			return fmt.Errorf("usage: agent-pilot devtools <status|css|audit|audit-details|trace-insight|video-start|video-stop|context-create|contexts|context-close|workers|ax|emulate|heap-capability|heap-analyze|3p-list|3p-execute|webmcp-list|webmcp-execute|pwa-probe|pwa-state|pwa-install|pwa-launch|pwa-uninstall> [--params '{...}'] [--tab ID]")
		}
		operation := parsed.Positional[0]
		method, ok := methods[operation]
		if !ok {
			return fmt.Errorf("unknown DevTools operation: %s", operation)
		}
		params := map[string]interface{}{}
		if raw := parsed.String("params", ""); raw != "" {
			if err := json.Unmarshal([]byte(raw), &params); err != nil || params == nil {
				return fmt.Errorf("--params must be a JSON object")
			}
		}
		if operation == "video-start" {
			params["action"] = "start"
		}
		if operation == "video-stop" {
			params["action"] = "stop"
		}
		tabID, err := parsed.TabID()
		if err != nil {
			return err
		}
		return dispatchAndPrintJSON(method, params, tabID)
	})
	cmd.Short = "CSS, Lighthouse, video, isolated login sessions, workers and DevTools insights"
	cmd.Flags().String("params", "", "Operation parameters as a JSON object (same fields as MCP)")
	cmd.Flags().IntP("tab", "t", 0, "Target tab ID; negative IDs identify isolated tabs")
	return cmd
}
