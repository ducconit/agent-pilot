// commands_meta.go holds the Cobra constructors for the meta/infrastructure
// commands registered on the root (root.go): mcp, server, service, batch,
// feedback, skill and export-mcp.
//
// The parsing/handler bodies are the previous ones, so stdout/stderr text and
// exit codes stay byte-identical; pflag declarations only feed the generated
// per-command help.

package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ducconit/agent-pilot/cli/bridge"
	"github.com/ducconit/agent-pilot/cli/config"
	"github.com/ducconit/agent-pilot/cli/feedback"
	"github.com/ducconit/agent-pilot/cli/mcp"
	"github.com/ducconit/agent-pilot/cli/service"
	"github.com/ducconit/agent-pilot/cli/skill"
	"github.com/ducconit/agent-pilot/cli/version"
)

// newMCPCommand launches the stdio MCP server. The root command also defaults to
// this when the CLI is invoked with no subcommand over a pipe.
func newMCPCommand() *cobra.Command {
	return newLeafCommand("mcp", nil, func(args []string) error {
		mcp.RunMCPServer(config.DefaultBridgePort())
		return nil
	})
}

func newServerCommand() *cobra.Command {
	return newLeafCommand("server", nil, func(args []string) error {
		if err := bridge.StartBridgeServer(config.DefaultBridgePort()); err != nil {
			return fmt.Errorf("❌ Server error: %v", err)
		}
		return nil
	})
}

func newServiceCommand() *cobra.Command {
	return newLeafCommand("service", nil, func(args []string) error {
		if err := service.HandleServiceCommand(args); err != nil {
			return fmt.Errorf("❌ Service error: %v", err)
		}
		return nil
	})
}

func newBatchCommand() *cobra.Command {
	return newLeafCommand("batch", nil, func(args []string) error {
		cmdArgs, parseErr := parseCmdArgs(args, []FlagDef{{Name: "format"}, {Name: "help", Aliases: []string{"h"}, IsBool: true}})
		if parseErr != nil {
			return fmt.Errorf("❌ Tham số batch không hợp lệ: %v", parseErr)
		}
		if len(cmdArgs.Positional) < 1 {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json> [--format json]")
			return errUsage
		}
		if cmdArgs.Bool("help") || cmdArgs.Positional[0] == "help" {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json> [--format json]")
			return nil
		}
		filePath := cmdArgs.Positional[0]
		raw, err := os.ReadFile(filePath)
		if err != nil {
			return fmt.Errorf("❌ Không thể đọc file: %v", err)
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(raw, &payload); err != nil {
			// Try as array of actions
			var actList []interface{}
			if aErr := json.Unmarshal(raw, &actList); aErr == nil {
				payload = map[string]interface{}{"actions": actList}
			} else {
				return fmt.Errorf("❌ File JSON không hợp lệ: %v", err)
			}
		}

		if err := bridge.EnrichBatchUploadArgs(payload); err != nil {
			return fmt.Errorf("❌ Lỗi tham số upload trong batch: %v", err)
		}

		res, err := bridge.DispatchCommand("batch.run", payload, config.DefaultBridgePort())
		if err != nil {
			return fmt.Errorf("❌ Thực thi batch thất bại: %v", err)
		}
		if processed, pErr := bridge.ProcessBatchScreenshots(res); pErr == nil {
			res = processed
		} else {
			return fmt.Errorf("❌ Lỗi lưu ảnh screenshot trong batch: %v", pErr)
		}
		resJSON, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			fmt.Printf("✅ Kết quả thực thi Batch: %v\n", res)
		} else {
			if strings.EqualFold(cmdArgs.String("format", ""), "json") {
				fmt.Println(string(resJSON))
			} else {
				fmt.Printf("✅ Kết quả thực thi Batch:\n%s\n", string(resJSON))
			}
		}
		return nil
	})
}

func newFeedbackCommand() *cobra.Command {
	return newLeafCommand("feedback", nil, func(args []string) error {
		sub := "list"
		if len(args) > 0 {
			sub = args[0]
		}
		if sub == "list" {
			res, err := feedback.GetPendingFeedback(config.DefaultFeedbackListLimit, "", false)
			if err != nil {
				return fmt.Errorf("❌ Lỗi: %v", err)
			}
			jsonB, mErr := json.MarshalIndent(res, "", "  ")
			if mErr != nil {
				fmt.Printf("%v\n", res)
			} else {
				fmt.Println(string(jsonB))
			}
		} else if sub == "wait" {
			timeout := config.DefaultFeedbackTimeoutSec
			if len(args) > 1 {
				if t, parseErr := strconv.Atoi(args[1]); parseErr == nil && t > 0 {
					timeout = t
				}
			}
			fmt.Printf("⏳ Đang chờ người dùng gửi feedback từ trình duyệt (Timeout: %ds)...\n", timeout)
			res, err := bridge.DispatchFeedbackWait(timeout, nil, config.DefaultBridgePort())
			if err != nil {
				return fmt.Errorf("❌ Lỗi: %v", err)
			}
			jsonB, mErr := json.MarshalIndent(res, "", "  ")
			if mErr != nil {
				fmt.Printf("%v\n", res)
			} else {
				fmt.Println(string(jsonB))
			}
		}
		return nil
	})
}

func newSkillCommand() *cobra.Command {
	cmd := newLeafCommand("skill", []string{"skills"}, func(args []string) error {
		cmdArgs, err := parseCmdArgs(args, []FlagDef{
			{Name: "path", Aliases: []string{"p"}},
			{Name: "force", Aliases: []string{"f"}, IsBool: true},
			{Name: "agy", IsBool: true},
			{Name: "antigravity", IsBool: true},
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		sub := "install"
		if len(cmdArgs.Positional) > 0 {
			sub = strings.ToLower(cmdArgs.Positional[0])
		}
		if sub != "install" && sub != "add" {
			fmt.Println("Sử dụng: agent-pilot skill install [--path <dir>] [--agy|--antigravity] [--force]")
			return errUsage
		}
		antigravity := cmdArgs.Bool("agy") || cmdArgs.Bool("antigravity")
		if err := skill.ExecSkillInstall(cmdArgs.String("path", ""), antigravity, cmdArgs.Bool("force")); err != nil {
			fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
			return errUsage
		}
		return nil
	})
	f := cmd.Flags()
	f.StringP("path", "p", "", "Skill install root directory")
	f.BoolP("force", "f", false, "Overwrite existing skill files")
	f.Bool("agy", false, "Install into ~/.gemini/config/skills (Antigravity)")
	f.Bool("antigravity", false, "Install into ~/.gemini/config/skills (Antigravity)")
	return cmd
}

func newExportMCPCommand() *cobra.Command {
	return newLeafCommand("export-mcp", nil, func(args []string) error {
		outDir := "mcp/agent-pilot"
		if len(args) > 0 {
			outDir = args[0]
		}
		if err := mcp.ExportMCPSchemas(outDir); err != nil {
			return fmt.Errorf("❌ Lỗi xuất MCP schemas: %v", err)
		}
		fmt.Printf("✅ Đã xuất %d tool schemas MCP thành công vào: %s\n", len(mcp.Tools()), outDir)
		return nil
	})
}

func newVersionCommand() *cobra.Command {
	cmd := newLeafCommand("version", nil, execVersionCommand)
	f := cmd.Flags()
	f.Bool("json", false, "Output version metadata as JSON")
	f.BoolP("short", "s", false, "Output only the version string (e.g. v1.0.14-beta)")
	f.String("format", "", "Output format (text|json)")
	return cmd
}

func execVersionCommand(args []string) error {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
		{Name: "json", IsBool: true},
		{Name: "short", Aliases: []string{"s"}, IsBool: true},
		{Name: "format"},
		{Name: "help", Aliases: []string{"h"}, IsBool: true},
	})
	if err != nil {
		return fmt.Errorf("❌ Tham số version không hợp lệ: %v", err)
	}
	if cmdArgs.Bool("help") || (len(cmdArgs.Positional) > 0 && cmdArgs.Positional[0] == "help") {
		fmt.Println("Sử dụng: agent-pilot version [--json|--short|--format json]")
		return nil
	}
	if cmdArgs.Bool("json") || strings.EqualFold(cmdArgs.String("format", ""), "json") {
		payload := map[string]string{
			"version": version.Raw(),
			"display": version.String(),
			"full":    version.Full(),
			"commit":  version.Commit,
			"date":    version.Date,
		}
		jsonB, mErr := json.MarshalIndent(payload, "", "  ")
		if mErr != nil {
			return fmt.Errorf("❌ Lỗi xuất JSON version: %v", mErr)
		}
		fmt.Println(string(jsonB))
		return nil
	}
	if cmdArgs.Bool("short") {
		fmt.Println(version.String())
		return nil
	}
	fmt.Printf("Agent Pilot CLI %s\n", version.Full())
	return nil
}
