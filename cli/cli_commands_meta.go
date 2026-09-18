// cli_commands_meta.go holds the meta/infrastructure command handlers invoked
// by dispatchCommand (cli_dispatch.go): mcp, server, service, batch, feedback,
// skill and export-mcp. Each handler owns the parsing for exactly one
// subcommand and calls the matching Exec*/handler function. Bodies were moved
// verbatim from main.go's dispatch switch (os.Args[2]→args[0], etc.).

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// cmdMCP launches the stdio MCP server. main() also defaults to this when the
// CLI is invoked with no subcommand over a pipe.
func cmdMCP(args []string) {
	RunMCPServer()
}

func cmdServer(args []string) {
	serverFlags := flag.NewFlagSet("server", flag.ExitOnError)
	port := serverFlags.Int("port", DefaultBridgePort(), "Port to listen on")
	if err := serverFlags.Parse(args); err != nil {
		os.Exit(1)
	}
	if err := StartBridgeServer(*port); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Server error: %v\n", err)
		os.Exit(1)
	}
}

func cmdService(args []string) {
	if err := HandleServiceCommand(args); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Service error: %v\n", err)
		os.Exit(1)
	}
}

func cmdBatch(args []string) {
	if len(args) < 1 || args[0] == "--help" || args[0] == "-h" || args[0] == "help" {
		fmt.Println("Sử dụng: agent-pilot batch <path-to-script.json>")
		if len(args) >= 1 && (args[0] == "--help" || args[0] == "-h" || args[0] == "help") {
			os.Exit(0)
		}
		os.Exit(1)
	}
	filePath := args[0]
	raw, err := os.ReadFile(filePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Không thể đọc file: %v\n", err)
		os.Exit(1)
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		// Try as array of actions
		var actList []interface{}
		if aErr := json.Unmarshal(raw, &actList); aErr == nil {
			payload = map[string]interface{}{"actions": actList}
		} else {
			fmt.Fprintf(os.Stderr, "❌ File JSON không hợp lệ: %v\n", err)
			os.Exit(1)
		}
	}

	res, err := DispatchCommand("batch.run", payload, DefaultBridgePort())
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Thực thi batch thất bại: %v\n", err)
		os.Exit(1)
	}
	resJSON, mErr := json.MarshalIndent(res, "", "  ")
	if mErr != nil {
		fmt.Printf("✅ Kết quả thực thi Batch: %v\n", res)
	} else {
		fmt.Printf("✅ Kết quả thực thi Batch:\n%s\n", string(resJSON))
	}
}

func cmdFeedback(args []string) {
	sub := "list"
	if len(args) > 0 {
		sub = args[0]
	}
	if sub == "list" {
		res, err := GetPendingFeedback(defaultFeedbackListLimit, "", false)
		if err != nil {
			fmt.Fprintf(os.Stderr, "❌ Lỗi: %v\n", err)
			os.Exit(1)
		}
		jsonB, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			fmt.Printf("%v\n", res)
		} else {
			fmt.Println(string(jsonB))
		}
	} else if sub == "wait" {
		timeout := defaultFeedbackTimeoutSec
		if len(args) > 1 {
			if t, parseErr := strconv.Atoi(args[1]); parseErr == nil && t > 0 {
				timeout = t
			}
		}
		fmt.Printf("⏳ Đang chờ người dùng gửi feedback từ trình duyệt (Timeout: %ds)...\n", timeout)
		res := WaitForFeedback(timeout, nil)
		jsonB, mErr := json.MarshalIndent(res, "", "  ")
		if mErr != nil {
			fmt.Printf("%v\n", res)
		} else {
			fmt.Println(string(jsonB))
		}
	}
}

func cmdSkill(args []string) {
	cmdArgs, err := parseCmdArgs(args, []FlagDef{
		{Name: "path", Aliases: []string{"p"}},
		{Name: "force", Aliases: []string{"f"}, IsBool: true},
		{Name: "agy", IsBool: true},
		{Name: "antigravity", IsBool: true},
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
	sub := "install"
	if len(cmdArgs.Positional) > 0 {
		sub = strings.ToLower(cmdArgs.Positional[0])
	}
	if sub != "install" && sub != "add" {
		fmt.Println("Sử dụng: agent-pilot skill install [--path <dir>] [--agy|--antigravity] [--force]")
		os.Exit(1)
	}
	antigravity := cmdArgs.Bool("agy") || cmdArgs.Bool("antigravity")
	if err := ExecSkillInstall(cmdArgs.String("path", ""), antigravity, cmdArgs.Bool("force")); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Error: %v\n", err)
		os.Exit(1)
	}
}

func cmdExportMCP(args []string) {
	outDir := "mcp/agent-pilot"
	if len(args) > 0 {
		outDir = args[0]
	}
	if err := ExportMCPSchemas(outDir); err != nil {
		fmt.Fprintf(os.Stderr, "❌ Lỗi xuất MCP schemas: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("✅ Đã xuất %d tool schemas MCP thành công vào: %s\n", len(mcpTools), outDir)
}
