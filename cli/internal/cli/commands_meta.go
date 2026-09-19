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
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/ducconit/agent-pilot/cli/internal/bridge"
	"github.com/ducconit/agent-pilot/cli/internal/config"
	"github.com/ducconit/agent-pilot/cli/internal/feedback"
	"github.com/ducconit/agent-pilot/cli/internal/mcp"
	"github.com/ducconit/agent-pilot/cli/internal/service"
	"github.com/ducconit/agent-pilot/cli/internal/skill"
)

// newMCPCommand launches the stdio MCP server. The root command also defaults to
// this when the CLI is invoked with no subcommand over a pipe.
func newMCPCommand() *cobra.Command {
	return newLeafCommand("mcp", nil, func(args []string) error {
		mcp.RunMCPServer()
		return nil
	})
}

func newServerCommand() *cobra.Command {
	cmd := newLeafCommand("server", nil, func(args []string) error {
		serverFlags := flag.NewFlagSet("server", flag.ExitOnError)
		port := serverFlags.Int("port", config.DefaultBridgePort(), "Port to listen on")
		if err := serverFlags.Parse(args); err != nil {
			return errUsage
		}
		if err := bridge.StartBridgeServer(*port); err != nil {
			return fmt.Errorf("❌ Server error: %v", err)
		}
		return nil
	})
	cmd.Flags().Int("port", config.DefaultBridgePort(), "Port to listen on")
	return cmd
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
		if len(args) < 1 {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json>")
			return errUsage
		}
		if args[0] == "--help" || args[0] == "-h" || args[0] == "help" {
			fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json>")
			return nil
		}
		filePath := args[0]
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

		res, err := bridge.DispatchCommand("batch.run", payload, config.DefaultBridgePort())
		if err != nil {
			return fmt.Errorf("❌ Thực thi batch thất bại: %v", err)
		}
		resJSON, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			fmt.Printf("✅ Kết quả thực thi Batch: %v\n", res)
		} else {
			fmt.Printf("✅ Kết quả thực thi Batch:\n%s\n", string(resJSON))
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
			res := feedback.WaitForFeedback(timeout, nil)
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
