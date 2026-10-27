// cli_args.go contains the CLI argument parsing helpers: the portable flag
// parser (parseCmdArgs) and its FlexibleCmdArgs accessors, plus the bespoke
// parsers for the busy/session/eval/fill/wait subcommands.

package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"

	"github.com/ducconit/agent-pilot-extension/cli/config"
)

// busyValueFlags defines non-boolean flags that consume a following value argument.
// NOTE FOR MAINTAINERS: When registering a new non-boolean flag in busyFlags below,
// ensure it is added to this map so its argument is not misidentified as a positional on/off toggle.
var busyValueFlags = map[string]bool{
	"-action":  true,
	"--action": true,
	"-tab":     true,
	"--tab":    true,
}

func ParseBusyArgs(args []string) (bool, string, interface{}, error) {
	tabID := 0
	actionDesc := "AI Agent đang thao tác..."
	isBusy := true

	var flagArgs []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if i > 0 {
			prev := args[i-1]
			if busyValueFlags[prev] {
				flagArgs = append(flagArgs, arg)
				continue
			}
		}

		lower := strings.ToLower(arg)
		if lower == "on" || lower == "true" || lower == "1" {
			isBusy = true
		} else if lower == "off" || lower == "false" || lower == "0" {
			isBusy = false
		} else {
			flagArgs = append(flagArgs, arg)
		}
	}

	busyFlags := flag.NewFlagSet("busy", flag.ContinueOnError)
	busyFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
	busyFlags.StringVar(&actionDesc, "action", actionDesc, "Action description")
	if err := busyFlags.Parse(flagArgs); err != nil {
		return false, "", nil, err
	}

	var targetTab interface{}
	if tabID > 0 {
		targetTab = tabID
	}
	return isBusy, actionDesc, targetTab, nil
}

// sessionValueFlags defines non-boolean flags that consume a following value argument.
var sessionValueFlags = map[string]bool{
	"-name":    true,
	"--name":   true,
	"-action":  true,
	"--action": true,
	"-tab":     true,
	"--tab":    true,
}

func ParseSessionArgs(args []string) (string, string, interface{}, error) {
	subcmd := "start"
	name := "AI Agent Session"
	tabID := 0

	var flagArgs []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if i > 0 {
			prev := args[i-1]
			if sessionValueFlags[prev] {
				flagArgs = append(flagArgs, arg)
				continue
			}
		}

		lower := strings.ToLower(arg)
		if lower == "start" || lower == "end" || lower == "stop" || lower == "status" {
			subcmd = lower
		} else {
			flagArgs = append(flagArgs, arg)
		}
	}

	sessionFlags := flag.NewFlagSet("session", flag.ContinueOnError)
	sessionFlags.IntVar(&tabID, "tab", 0, "Target tab ID")
	sessionFlags.StringVar(&name, "name", name, "Session name or task description")
	sessionFlags.StringVar(&name, "action", name, "Alias for session name")
	if err := sessionFlags.Parse(flagArgs); err != nil {
		return "", "", nil, err
	}

	var targetTab interface{}
	if tabID > 0 {
		targetTab = tabID
	}
	return subcmd, name, targetTab, nil
}

func parseEvalArgs(args []string) (string, interface{}, error) {
	script, tabID, _, err := parseEvalArgsWithOptions(args)
	return script, tabID, err
}

func parseEvalArgsWithTimeout(args []string) (string, interface{}, int, error) {
	script, tabID, extra, err := parseEvalArgsWithOptions(args)
	if err != nil {
		return "", nil, 0, err
	}
	timeoutMs, _ := extra["timeoutMs"].(int)
	return script, tabID, timeoutMs, nil
}

func parseEvalArgsWithOptions(args []string) (string, interface{}, map[string]interface{}, error) {
	var fileArg string
	var outFileArg string
	var evalArgs []interface{}
	var tabID int
	var timeoutMs int
	var positional []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-f" || arg == "--file" || arg == "--source-path" {
			if i+1 < len(args) {
				fileArg = args[i+1]
				i++
			}
		} else if strings.HasPrefix(arg, "-f=") || strings.HasPrefix(arg, "--file=") || strings.HasPrefix(arg, "--source-path=") {
			parts := strings.SplitN(arg, "=", 2)
			fileArg = parts[1]
		} else if arg == "-o" || arg == "--output" || arg == "--out" || arg == "--file-path" {
			if i+1 < len(args) {
				outFileArg = args[i+1]
				i++
			}
		} else if strings.HasPrefix(arg, "-o=") || strings.HasPrefix(arg, "--output=") || strings.HasPrefix(arg, "--out=") || strings.HasPrefix(arg, "--file-path=") {
			parts := strings.SplitN(arg, "=", 2)
			outFileArg = parts[1]
		} else if arg == "--arg" {
			if i+1 < len(args) {
				evalArgs = append(evalArgs, args[i+1])
				i++
			}
		} else if strings.HasPrefix(arg, "--arg=") {
			parts := strings.SplitN(arg, "=", 2)
			evalArgs = append(evalArgs, parts[1])
		} else if arg == "--args" {
			if i+1 < len(args) {
				var parsed []interface{}
				if err := json.Unmarshal([]byte(args[i+1]), &parsed); err != nil {
					return "", nil, nil, fmt.Errorf("--args phải là mảng JSON hợp lệ: %w", err)
				}
				evalArgs = append(evalArgs, parsed...)
				i++
			}
		} else if strings.HasPrefix(arg, "--args=") {
			parts := strings.SplitN(arg, "=", 2)
			var parsed []interface{}
			if err := json.Unmarshal([]byte(parts[1]), &parsed); err != nil {
				return "", nil, nil, fmt.Errorf("--args phải là mảng JSON hợp lệ: %w", err)
			}
			evalArgs = append(evalArgs, parsed...)
		} else if arg == "-tab" || arg == "--tab" || arg == "-t" {
			if i+1 < len(args) {
				id, err := strconv.Atoi(args[i+1])
				if err != nil || id == 0 {
					return "", nil, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", args[i+1])
				}
				tabID = id
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") || strings.HasPrefix(arg, "-t=") {
			parts := strings.SplitN(arg, "=", 2)
			id, err := strconv.Atoi(parts[1])
			if err != nil || id == 0 {
				return "", nil, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", parts[1])
			}
			tabID = id
		} else if arg == "-timeout" || arg == "--timeout" {
			if i+1 < len(args) {
				ms, err := strconv.Atoi(args[i+1])
				if err != nil || ms <= 0 {
					return "", nil, nil, fmt.Errorf("giá trị timeout không hợp lệ: %s", args[i+1])
				}
				timeoutMs = ms
				i++
			}
		} else if strings.HasPrefix(arg, "-timeout=") || strings.HasPrefix(arg, "--timeout=") {
			parts := strings.SplitN(arg, "=", 2)
			ms, err := strconv.Atoi(parts[1])
			if err != nil || ms <= 0 {
				return "", nil, nil, fmt.Errorf("giá trị timeout không hợp lệ: %s", parts[1])
			}
			timeoutMs = ms
		} else {
			positional = append(positional, arg)
		}
	}

	var script string
	if fileArg != "" {
		data, err := os.ReadFile(fileArg)
		if err != nil {
			return "", nil, nil, fmt.Errorf("không thể đọc file %s: %w", fileArg, err)
		}
		script = string(data)
	} else if len(positional) > 0 {
		script = positional[0]
	} else {
		// Check stdin
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			data, err := io.ReadAll(io.LimitReader(os.Stdin, config.MaxAPIBodyBytes))
			if err != nil {
				return "", nil, nil, fmt.Errorf("lỗi đọc stdin: %w", err)
			}
			script = string(data)
		}
	}

	if strings.TrimSpace(script) == "" {
		return "", nil, nil, fmt.Errorf("vui lòng cung cấp mã script, file (-f <path>) hoặc pipe qua stdin")
	}

	extra := map[string]interface{}{}
	if len(evalArgs) > 0 {
		extra["args"] = evalArgs
	}
	if strings.TrimSpace(outFileArg) != "" {
		extra["filePath"] = strings.TrimSpace(outFileArg)
	}
	if timeoutMs > 0 {
		extra["timeoutMs"] = timeoutMs
	}

	var t interface{}
	if tabID != 0 {
		t = tabID
	}
	return script, t, extra, nil
}

func parseFillArgs(args []string) ([]map[string]interface{}, string, bool, interface{}, error) {
	var submitSelector string
	var pressEnter bool
	var tabID int
	var positional []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-submit" || arg == "--submit" {
			if i+1 < len(args) {
				submitSelector = args[i+1]
				i++
			}
		} else if strings.HasPrefix(arg, "-submit=") || strings.HasPrefix(arg, "--submit=") {
			parts := strings.SplitN(arg, "=", 2)
			submitSelector = parts[1]
		} else if arg == "-enter" || arg == "--enter" {
			pressEnter = true
		} else if arg == "-tab" || arg == "--tab" {
			if i+1 < len(args) {
				id, err := strconv.Atoi(args[i+1])
				if err != nil || id <= 0 {
					return nil, "", false, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", args[i+1])
				}
				tabID = id
				i++
			}
		} else if strings.HasPrefix(arg, "-tab=") || strings.HasPrefix(arg, "--tab=") {
			parts := strings.SplitN(arg, "=", 2)
			id, err := strconv.Atoi(parts[1])
			if err != nil || id <= 0 {
				return nil, "", false, nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", parts[1])
			}
			tabID = id
		} else {
			positional = append(positional, arg)
		}
	}

	var raw []byte
	if len(positional) > 0 {
		fileOrJSON := positional[0]
		data, err := os.ReadFile(fileOrJSON)
		if err == nil {
			raw = data
		} else {
			raw = []byte(fileOrJSON)
		}
	} else {
		// Check stdin
		stat, err := os.Stdin.Stat()
		if err == nil && (stat.Mode()&os.ModeCharDevice) == 0 {
			data, err := io.ReadAll(io.LimitReader(os.Stdin, config.MaxAPIBodyBytes))
			if err != nil {
				return nil, "", false, nil, fmt.Errorf("lỗi đọc stdin: %w", err)
			}
			raw = data
		}
	}

	if len(raw) == 0 {
		return nil, "", false, nil, fmt.Errorf("vui lòng cung cấp file JSON hoặc chuỗi JSON danh sách fields")
	}

	var fields []map[string]interface{}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, "", false, nil, fmt.Errorf("không thể phân tích cú pháp fields JSON: %w", err)
	}

	var t interface{}
	if tabID > 0 {
		t = tabID
	}
	return fields, submitSelector, pressEnter, t, nil
}

type FlagDef struct {
	Name    string
	Aliases []string
	IsBool  bool
}

type FlexibleCmdArgs struct {
	Flags      map[string]string
	MultiFlags map[string][]string
	Positional []string
}

// parseCmdArgs is a portable flag parser that accepts flags (long or short),
// `--flag=value`, `--` to end flag parsing, and positional arguments in any
// order. It is used where the stdlib flag package's ordering rules are too strict.
func parseCmdArgs(args []string, allowedFlags []FlagDef) (FlexibleCmdArgs, error) {
	res := FlexibleCmdArgs{
		Flags:      make(map[string]string),
		MultiFlags: make(map[string][]string),
		Positional: make([]string, 0),
	}

	lookup := make(map[string]FlagDef)
	for _, f := range allowedFlags {
		lookup[f.Name] = f
		for _, a := range f.Aliases {
			lookup[a] = f
		}
	}

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			res.Positional = append(res.Positional, args[i+1:]...)
			break
		}
		isNegativeNumber := len(arg) > 1 && arg[0] == '-' && arg[1] >= '0' && arg[1] <= '9'
		if strings.HasPrefix(arg, "-") && !isNegativeNumber {
			if strings.Contains(arg, "=") {
				parts := strings.SplitN(arg, "=", 2)
				flagName := strings.TrimLeft(parts[0], "-")
				def, ok := lookup[flagName]
				if !ok {
					return res, fmt.Errorf("cờ không hợp lệ: %s", parts[0])
				}
				res.Flags[def.Name] = parts[1]
				res.MultiFlags[def.Name] = append(res.MultiFlags[def.Name], parts[1])
			} else {
				flagName := strings.TrimLeft(arg, "-")
				def, ok := lookup[flagName]
				if !ok {
					return res, fmt.Errorf("cờ không hợp lệ: %s", arg)
				}
				if def.IsBool {
					res.Flags[def.Name] = "true"
					res.MultiFlags[def.Name] = append(res.MultiFlags[def.Name], "true")
				} else {
					if i+1 >= len(args) {
						return res, fmt.Errorf("cờ %s yêu cầu một giá trị", arg)
					}
					res.Flags[def.Name] = args[i+1]
					res.MultiFlags[def.Name] = append(res.MultiFlags[def.Name], args[i+1])
					i++
				}
			}
		} else {
			res.Positional = append(res.Positional, arg)
		}
	}
	return res, nil
}

// InlineWaitFlagDefs returns the shared flag definitions for inline wait options
// (--wait/--sleep/--wait-ms/--sleep-ms, --wait-for/--wait-selector, --wait-text, --include-snapshot).
func InlineWaitFlagDefs() []FlagDef {
	return []FlagDef{
		{Name: "wait", Aliases: []string{"sleep", "wait-ms", "sleep-ms"}},
		{Name: "wait-for", Aliases: []string{"wait-selector"}},
		{Name: "wait-text"},
		{Name: "include-snapshot", Aliases: []string{"snapshot"}, IsBool: true},
	}
}

// withInlineWaitFlags appends InlineWaitFlagDefs() to a slice of FlagDef.
func withInlineWaitFlags(defs ...FlagDef) []FlagDef {
	return append(defs, InlineWaitFlagDefs()...)
}

// ApplyInlineWait populates waitMs, waitForSelector, waitForText, and includeSnapshot on params
// when any of the inline wait/snapshot flags are present.
func (a FlexibleCmdArgs) ApplyInlineWait(params map[string]interface{}) error {
	if rawWait, ok := a.Flags["wait"]; ok && strings.TrimSpace(rawWait) != "" {
		trimmed := strings.TrimSpace(rawWait)
		if strings.HasSuffix(strings.ToLower(trimmed), "ms") {
			trimmed = strings.TrimSpace(trimmed[:len(trimmed)-2])
		}
		ms, err := strconv.Atoi(trimmed)
		if err != nil || ms < 0 {
			return fmt.Errorf("giá trị wait/sleep không hợp lệ: %s", rawWait)
		}
		if ms > 0 {
			params["waitMs"] = ms
		}
	}
	if sel := strings.TrimSpace(a.String("wait-for", "")); sel != "" {
		params["waitForSelector"] = sel
	}
	if txt := strings.TrimSpace(a.String("wait-text", "")); txt != "" {
		params["waitForText"] = txt
	}
	if a.Bool("include-snapshot") {
		params["includeSnapshot"] = true
	}
	return nil
}

func (a FlexibleCmdArgs) TabID() (interface{}, error) {
	val, ok := a.Flags["tab"]
	if !ok {
		return nil, nil
	}
	id, err := strconv.Atoi(val)
	if err != nil || id == 0 {
		return nil, fmt.Errorf("giá trị tab ID không hợp lệ: %s", val)
	}
	return id, nil
}

func (a FlexibleCmdArgs) Int(flagName string, defaultVal int) (int, error) {
	val, ok := a.Flags[flagName]
	if !ok {
		return defaultVal, nil
	}
	v, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal, fmt.Errorf("giá trị %s không hợp lệ: %s", flagName, val)
	}
	return v, nil
}

func (a FlexibleCmdArgs) Float(flagName string, defaultVal float64) (float64, error) {
	val, ok := a.Flags[flagName]
	if !ok {
		return defaultVal, nil
	}
	v, err := strconv.ParseFloat(val, 64)
	if err != nil {
		return defaultVal, fmt.Errorf("giá trị %s không hợp lệ: %s", flagName, val)
	}
	return v, nil
}

func (a FlexibleCmdArgs) String(flagName string, defaultVal string) string {
	if val, ok := a.Flags[flagName]; ok {
		return val
	}
	return defaultVal
}

func (a FlexibleCmdArgs) Strings(flagName string) []string {
	rawVals := a.MultiFlags[flagName]
	if len(rawVals) == 0 {
		if single, ok := a.Flags[flagName]; ok && strings.TrimSpace(single) != "" {
			rawVals = []string{single}
		}
	}
	var out []string
	for _, v := range rawVals {
		for _, part := range strings.Split(v, ";") {
			trimmed := strings.TrimSpace(part)
			if trimmed != "" {
				out = append(out, trimmed)
			}
		}
	}
	return out
}

func (a FlexibleCmdArgs) Bool(flagName string) bool {
	if val, ok := a.Flags[flagName]; ok {
		lower := strings.ToLower(val)
		return lower == "true" || lower == "1" || lower == ""
	}
	return false
}

func parseWaitArgs(args []string) (string, string, string, int, interface{}, error) {
	allowedFlags := []FlagDef{
		{Name: "tab", Aliases: []string{"t"}},
		{Name: "timeout"},
		{Name: "sleep", Aliases: []string{"ms", "wait"}},
		{Name: "state"},
		{Name: "text"},
		{Name: "selector", Aliases: []string{"sel", "s"}},
	}
	cmdArgs, err := parseCmdArgs(args, allowedFlags)
	if err != nil {
		return "", "", "", 0, nil, err
	}
	tab, err := cmdArgs.TabID()
	if err != nil {
		return "", "", "", 0, nil, err
	}
	timeout, err := cmdArgs.Int("timeout", config.DefaultWaitTimeoutMs)
	if err != nil || timeout <= 0 {
		val := cmdArgs.Flags["timeout"]
		return "", "", "", 0, nil, fmt.Errorf("giá trị timeout không hợp lệ: %s", val)
	}
	sleepMs, err := cmdArgs.Int("sleep", 0)
	if err != nil || sleepMs < 0 {
		val := cmdArgs.Flags["sleep"]
		return "", "", "", 0, nil, fmt.Errorf("giá trị sleep/ms không hợp lệ: %s", val)
	}
	state := cmdArgs.String("state", "visible")
	text := cmdArgs.String("text", "")
	selector := cmdArgs.String("selector", "")

	if len(cmdArgs.Positional) > 0 {
		pos := cmdArgs.Positional[0]
		if selector == "" && text == "" {
			trimmed := strings.TrimSpace(pos)
			lowerPos := strings.ToLower(trimmed)
			if strings.HasSuffix(lowerPos, "ms") {
				trimmed = strings.TrimSpace(trimmed[:len(trimmed)-2])
			}
			if ms, convErr := strconv.Atoi(trimmed); convErr == nil && ms > 0 {
				sleepMs = ms
			} else if strings.HasPrefix(pos, "@") || strings.HasPrefix(pos, "#") || strings.HasPrefix(pos, ".") || strings.HasPrefix(pos, "[") {
				selector = pos
			} else if strings.ContainsAny(pos, " \t\n\r") && !strings.ContainsAny(pos, ">+~:[") {
				text = pos
			} else {
				selector = pos
			}
		} else if selector == "" && text != "" {
			selector = pos
		} else if selector != "" && text == "" {
			text = pos
		}
	}

	if selector == "" && text == "" && sleepMs > 0 {
		state = "sleep"
		timeout = sleepMs
	}

	return selector, text, state, timeout, tab, nil
}
