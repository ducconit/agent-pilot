package bridge

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"github.com/ducconit/agent-pilot-extension/cli/devtools"
)

var devtoolsHost = devtools.NewHost(func(method string, params map[string]interface{}) (interface{}, error) {
	// Protocol traffic must remain on the instance selected when the operation
	// started, even if the user focuses another browser window in the meantime.
	if instance, _ := params["instanceId"].(string); instance != "" {
		clientsLock.RLock()
		client := clients[instance]
		clientsLock.RUnlock()
		if client == nil {
			return nil, fmt.Errorf("browser instance disconnected: %s", instance)
		}
	}
	return SendCommandToExtension(method, params, 120000)
})

func useDevtoolsHost(method string, params map[string]interface{}) bool {
	if method == "extensions.manage" {
		return false
	}
	if method == "memory.analyzeSnapshot" {
		return true
	}
	if method == "memory.heapSnapshot" {
		if filePath, _ := params["filePath"].(string); filePath != "" {
			return true
		}
	}
	if method == "network.getResponseBody" {
		_, requestFile := params["requestFilePath"].(string)
		_, responseFile := params["responseFilePath"].(string)
		if requestFile || responseFile {
			return true
		}
	}
	if strings.HasPrefix(method, "lighthouse.") || strings.HasPrefix(method, "contexts.") || strings.HasPrefix(method, "screencast.") || strings.HasPrefix(method, "developerTools.") || strings.HasPrefix(method, "webmcp.") || strings.HasPrefix(method, "pwa.") || method == "performance.trace" || method == "performance.analyzeInsight" || method == "accessibility.snapshot" || method == "devtools.runtime" {
		return true
	}
	if context, _ := params["isolatedContext"].(string); context != "" {
		return true
	}
	if context, _ := params["contextId"].(string); context != "" {
		return true
	}
	if id, ok := getIntOrFloat(params, "tabId"); ok {
		return id < 0
	}
	if id, ok := getIntOrFloat(params, "agentLastTabId"); ok {
		return id < 0 && method != "tabs.create"
	}
	return false
}

func dispatchLocalCommand(method string, params map[string]interface{}) (interface{}, error) {
	return dispatchLocalCommandWithContext(context.Background(), method, params)
}

func dispatchLocalCommandWithContext(ctx context.Context, method string, params map[string]interface{}) (interface{}, error) {
	if !useDevtoolsHost(method, params) {
		return SendCommandToExtensionWithContext(ctx, method, params, 0)
	}
	cloned := make(map[string]interface{}, len(params)+1)
	for key, value := range params {
		cloned[key] = value
	}
	if _, specified := cloned["instanceId"]; !specified {
		if client := getClientByID(""); client != nil {
			cloned["instanceId"] = client.ID
		}
	}
	result, err := devtoolsHost.Call(method, cloned, time.Duration(DeriveCommandTimeout(method, cloned, 0))*time.Millisecond)
	// File artifacts contain their original bytes; redact only the inline result.
	return SanitizeData(result, atomic.LoadInt32(&secretFilterOn) == 1), err
}

func CloseDevtoolsHost() { devtoolsHost.Close() }
