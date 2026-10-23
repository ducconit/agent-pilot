/**
 * Browser-scoped adapter for Chromium's experimental PWA CDP domain.
 *
 * PWA.* is not a page command. It must be sent through a browser-level CDP
 * connection (for example Puppeteer's browser._connection). The extension
 * relay intentionally cannot provide this boundary because it only attaches
 * to an individual tab target.
 */

const PWA_METHODS = Object.freeze({
  getOsAppState: "PWA.getOsAppState",
  install: "PWA.install",
  launch: "PWA.launch",
  uninstall: "PWA.uninstall",
  changeAppUserSettings: "PWA.changeAppUserSettings"
});

const DISPLAY_MODES = new Set(["browser", "standalone"]);

export class PwaAdapterError extends Error {
  constructor(message, { code = "PWA_ADAPTER_ERROR", method, cause } = {}) {
    super(message, { cause });
    this.name = "PwaAdapterError";
    this.code = code;
    if (method) this.method = method;
  }
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PwaAdapterError(`${name} must be a non-empty string`, { code: "INVALID_ARGUMENT" });
  }
  return value;
}

function optionalString(value, name) {
  if (value === undefined) return undefined;
  return requiredString(value, name);
}

function protocolErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isUnsupportedPwaCommand(error) {
  const message = protocolErrorMessage(error).toLowerCase();
  return message.includes("wasn't found") ||
    message.includes("was not found") ||
    message.includes("method not found") ||
    message.includes("unknown command") ||
    message.includes("unknown method") ||
    message.includes("not supported");
}

function normalizeCallError(error, method) {
  if (error instanceof PwaAdapterError) return error;
  const message = protocolErrorMessage(error);
  return new PwaAdapterError(
    isUnsupportedPwaCommand(error)
      ? `Chrome does not expose ${method}; use a Chrome build with the experimental PWA CDP domain`
      : message,
    {
      code: isUnsupportedPwaCommand(error) ? "PWA_PROTOCOL_UNAVAILABLE" : "PWA_PROTOCOL_ERROR",
      method,
      cause: error
    }
  );
}

function assertBrowserScope(scope) {
  if (scope !== "browser") {
    throw new PwaAdapterError(
      "PWA CDP commands require a browser-scoped session; tab/extension relay sessions are not supported",
      { code: "BROWSER_SCOPE_REQUIRED" }
    );
  }
}

function createSender(browser) {
  const connection = browser?._connection;
  if (!connection || typeof connection.send !== "function") {
    throw new PwaAdapterError(
      "Puppeteer browser does not expose a browser-level CDP connection",
      { code: "BROWSER_CONNECTION_REQUIRED" }
    );
  }
  return (method, params) => connection.send(method, params);
}

/**
 * Build an adapter around a browser-level CDP sender.
 *
 * The sender shape matches Puppeteer Connection.send(method, params). Keeping
 * it injectable makes this module testable without launching Chrome and gives
 * the runner a single integration seam when PWA tools are wired later.
 */
export function createPwaAdapter({ send, scope = "browser" } = {}) {
  assertBrowserScope(scope);
  if (typeof send !== "function") {
    throw new PwaAdapterError("A browser-level CDP sender is required", { code: "CDP_SENDER_REQUIRED" });
  }

  const call = async (method, params = {}) => {
    try {
      return await send(method, params);
    } catch (error) {
      throw normalizeCallError(error, method);
    }
  };

  return Object.freeze({
    async getOsAppState({ manifestId } = {}) {
      return call(PWA_METHODS.getOsAppState, { manifestId: requiredString(manifestId, "manifestId") });
    },

    async install({ manifestId, installUrlOrBundleUrl, displayMode } = {}) {
      const normalizedManifestId = requiredString(manifestId, "manifestId");
      const normalizedUrl = optionalString(installUrlOrBundleUrl, "installUrlOrBundleUrl");
      if (displayMode !== undefined && !DISPLAY_MODES.has(displayMode)) {
        throw new PwaAdapterError("displayMode must be browser or standalone", { code: "INVALID_ARGUMENT" });
      }

      const installParams = { manifestId: normalizedManifestId };
      if (normalizedUrl !== undefined) installParams.installUrlOrBundleUrl = normalizedUrl;
      const result = await call(PWA_METHODS.install, installParams);

      // PWA.install defaults to browser display mode. The optional preference
      // change is deliberately a second command so callers can omit it on
      // Chromium versions that expose install but not user settings.
      if (displayMode !== undefined) {
        await call(PWA_METHODS.changeAppUserSettings, {
          manifestId: normalizedManifestId,
          displayMode
        });
      }
      return result;
    },

    async launch({ manifestId, url } = {}) {
      const params = { manifestId: requiredString(manifestId, "manifestId") };
      const normalizedUrl = optionalString(url, "url");
      if (normalizedUrl !== undefined) params.url = normalizedUrl;
      return call(PWA_METHODS.launch, params);
    },

    async uninstall({ manifestId } = {}) {
      return call(PWA_METHODS.uninstall, { manifestId: requiredString(manifestId, "manifestId") });
    },

    /**
     * Probe support without changing installed-app state.
     *
     * An unknown manifest id is a successful protocol reachability signal;
     * Chrome reports that as a normal PWA backend error. A missing command is
     * classified as unavailable so callers can surface a useful blocker.
     */
    async probe({ manifestId = "https://agent-pilot.invalid/pwa-probe" } = {}) {
      const version = await call("Browser.getVersion");
      try {
        const state = await call(PWA_METHODS.getOsAppState, {
          manifestId: requiredString(manifestId, "manifestId")
        });
        return { supported: true, browser: version, state };
      } catch (error) {
        if (error.code === "PWA_PROTOCOL_UNAVAILABLE") {
          return {
            supported: false,
            browser: version,
            reason: "PWA CDP domain is unavailable in this Chrome connection",
            error: error.message
          };
        }
        return {
          supported: true,
          browser: version,
          state: null,
          probeError: error.message
        };
      }
    }
  });
}

/**
 * Convenience constructor for the managed Puppeteer browser path.
 *
 * This intentionally does not accept an extension tab or BridgeTransport:
 * those transports do not represent the browser target required by PWA.*.
 */
export function createPwaAdapterFromBrowser(browser) {
  return createPwaAdapter({ send: createSender(browser), scope: "browser" });
}

export { DISPLAY_MODES, PWA_METHODS };
