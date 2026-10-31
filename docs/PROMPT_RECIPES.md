# 💡 AI Agent Prompt Recipes & Sample Prompts

Learn how to effectively instruct any AI coding assistant or automation tool (**Claude Code**, **Cursor**, **Windsurf**, **Google Antigravity**, **Cline / Roo Code**, **OpenCode**, **Codex**, **Aider**, etc.) to automate browser workflows with **Agent Pilot**.

::: tip Universal Compatibility (Skills + CLI & MCP)
Whether your agent uses **Agent Skills + Command Line (`agent-pilot` CLI)** or the **Model Context Protocol (`agent-pilot mcp`)**, the exact same natural language prompts work identically across all tools.
:::

---

## 🎯 How Prompting Works with Agent Pilot

When Agent Pilot is connected via **Skills + Command Line (`npx skills add`)** or **MCP (`mcp.json`)**, your AI assistant automatically knows how to invoke CLI commands (`agent-pilot open`, `agent-pilot click`, `agent-pilot screenshot`) or MCP tools (`browser_open_tab`, `page_click`, `page_screenshot`, `devtools_audit_lighthouse`).

You simply tell your AI assistant what to achieve in natural language—the agent inspects the DOM, synthesizes actions, and verifies the result.

---

## 📋 Ready-to-Use Prompt Templates

### 1. 🧪 Automated End-to-End Web Testing

Copy and paste this into your AI assistant chat:

```markdown
Please use Agent Pilot to test the authentication flow of my application running on http://localhost:3000:
1. Open the URL in an isolated background tab.
2. Inspect the login form and enter username "demo@example.com" and password "Password123!".
3. Click the "Sign In" button using trusted human simulation.
4. Verify that the user dashboard renders successfully.
5. Capture an annotated screenshot of the dashboard and save it to ./assets/login_verified.png.
6. Check for any console errors or failed HTTP requests during the flow.
```

---

### 2. 📸 Visual QA & Responsive Design Audit

```markdown
Audit the landing page http://localhost:3000/ for responsiveness across mobile, tablet, and desktop:
1. Resize the viewport to 375x812 (iPhone X/13), take a full-page screenshot, and check for any horizontal overflow (scrollWidth > innerWidth).
2. Resize to 768x1024 (iPad portrait), verify that the navigation bar properly switches to the hamburger menu.
3. Resize to 1440x900 (Desktop), verify grid alignment and image aspect ratios.
4. If you discover any misaligned elements or layout breaks, highlight them using page_screenshot --highlight and describe the CSS fix needed.
```

---

### 3. 🔍 Form Automation & Data Extraction

```markdown
Automate data entry and extraction on http://localhost:3000/admin/products:
1. Open the products admin page and take a DOM snapshot (@1, @2, ...).
2. Click the "Add Product" button.
3. Fill out the form fields:
   - Title: "Autonomous AI Agent Router"
   - Price: "49.99"
   - Category: Select "Developer Tools"
4. Submit the form and wait for the success toast notification.
5. Extract the newly generated product ID and table rows into a structured JSON file at ./tmp/products.json.
```

---

### 4. ⚡ Performance & Lighthouse Audit

```markdown
Run a comprehensive performance audit on http://localhost:3000:
1. Execute a native Lighthouse audit covering Performance, Accessibility, Best Practices, and SEO.
2. Summarize Core Web Vitals (LCP, FID/INP, CLS).
3. If performance score is below 90, inspect the network waterfall to identify render-blocking CSS/JS assets or uncompressed images.
4. Propose immediate optimization steps in our Vite/Next.js config.
```

---

### 5. 🔬 Memory Leak & V8 Heap Diagnostics

```markdown
Check our Single Page Application for memory leaks during page transitions:
1. Open http://localhost:3000/dashboard and capture a baseline V8 heap snapshot.
2. Simulate navigating between "Dashboard" and "Analytics" 5 consecutive times.
3. Capture a second heap snapshot and compute the object allocation delta.
4. Report any detached DOM nodes, uncleared setInterval timers, or growing event listener closures.
```

---

### 6. 🛡️ Network & Security Inspection

```markdown
Inspect the API communication on http://localhost:3000/checkout:
1. Start recording network events and console errors.
2. Click the "Place Order" button.
3. Inspect the outgoing POST /api/checkout request:
   - Ensure sensitive credentials (credit card, auth tokens) are masked or securely transmitted.
   - Verify HTTP status code 200 OK.
4. Check if any 4xx or 5xx responses or CORS policy warnings were triggered.
```

---

### 7. 🎨 In-Page Interactive Feedback & Bug Tagging

```markdown
Open the side panel Feedback Studio on http://localhost:3000:
1. Enable the Element Inspector on the hero call-to-action button.
2. Extract its computed CSS styles (font-size, line-height, background-color, border-radius).
3. Check color contrast against WCAG 2.2 AA standards.
4. If contrast is insufficient, suggest the hex color replacement and pin a feedback note directly on the page.
```

---

### 8. 🎭 Record Actions, Replay Flows & Export Playwright Code

```markdown
Use Agent Pilot's Recorder on http://localhost:3000:
1. Start recording an interaction flow (recorder start) titled "Checkout Flow".
2. Execute the journey: Search for a product -> Click "Add to Cart" -> Proceed to Checkout.
3. Stop recording (recorder stop) and replay the flow (recorder replay) to verify determinism.
4. Export the recorded flow directly into a Playwright test specification at ./tests/checkout.spec.ts.
```

---

### 9. 🎥 Record Workflow Video & Annotated QA Screenshots

```markdown
Perform visual QA verification on http://localhost:3000/pricing:
1. Start screen video recording on the target tab.
2. Scroll through the pricing tiers, toggle "Monthly / Annual" billing, and click the "Subscribe" CTA.
3. Capture an annotated screenshot highlighting the pricing card with the banner title "QA Verified - Pricing Table".
4. Save both the .mp4 video recording and annotated PNG screenshot into ./artifacts/qa-report/.
```

---

## 💡 Best Practices for Prompting AI Agents

| Tip | Do | Don't |
| :--- | :--- | :--- |
| **Specify Port & Tab** | "Run on `http://localhost:5173/` with dedicated tab" | "Check my website" without URL |
| **Request Visual Proof** | "Take screenshot after action to confirm" | Assume action passed blindly |
| **Preserve Focus** | "Open tab in background isolation" | Manually click around while agent works |
| **Step-by-Step Flow** | Provide ordered numbered steps (1, 2, 3) | Give vague multi-part paragraphs |
| **Handle Errors** | "If sign in fails, read console error" | Let agent crash without error capture |
