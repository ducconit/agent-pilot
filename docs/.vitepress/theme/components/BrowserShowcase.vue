<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const currentStep = ref(0)
const typedText = ref('')
const isClicked = ref(false)
const cursorX = ref(180)
const cursorY = ref(130)
const showRipple = ref(false)
const logEntries = ref<Array<{ time: string, prefix: string, msg: string }>>([
  { time: '00:01', prefix: 'MCP', msg: 'browser_open_tab({ url: "localhost:3000" })' },
  { time: '00:02', prefix: 'EXT', msg: 'Tab isolated in group [🤖 Agent Pilot]' }
])

let timer: any = null

function runSimulationStep() {
  currentStep.value = (currentStep.value + 1) % 5

  if (currentStep.value === 0) {
    typedText.value = ''
    isClicked.value = false
    showRipple.value = false
    cursorX.value = 180
    cursorY.value = 130
    logEntries.value = [
      { time: '00:01', prefix: 'MCP', msg: 'browser_open_tab({ url: "localhost:3000" })' },
      { time: '00:02', prefix: 'EXT', msg: 'Tab isolated in group [🤖 Agent Pilot]' }
    ]
  } else if (currentStep.value === 1) {
    // Move cursor to input
    cursorX.value = 80
    cursorY.value = 52
    logEntries.value.push({ time: '00:03', prefix: 'MCP', msg: 'page.type("#prompt-input", "Deploy AI Agent")' })
  } else if (currentStep.value === 2) {
    // Type text
    typedText.value = 'Deploy AI Agent'
    logEntries.value.push({ time: '00:04', prefix: 'DOM', msg: 'Synthesizing keyboard input cascade (120 wpm)' })
  } else if (currentStep.value === 3) {
    // Move cursor to button & click
    cursorX.value = 100
    cursorY.value = 98
    showRipple.value = true
    isClicked.value = true
    logEntries.value.push({ time: '00:05', prefix: 'MCP', msg: 'page.click("#run-btn", { via: "auto" })' })
    logEntries.value.push({ time: '00:06', prefix: 'CDP', msg: 'Dispatched trusted click -> HTTP 200 OK' })
  } else if (currentStep.value === 4) {
    showRipple.value = false
  }
}

onMounted(() => {
  timer = setInterval(runSimulationStep, 2400)
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="ap-showcase-container">
    <div class="ap-showcase-header">
      <div class="ap-window-dots">
        <span class="ap-dot red"></span>
        <span class="ap-dot yellow"></span>
        <span class="ap-dot green"></span>
      </div>
      <div class="ap-address-bar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <span>http://localhost:3000/dashboard</span>
      </div>
      <div class="ap-tag-indicator">
        🤖 Agent Pilot Tab
      </div>
    </div>

    <div class="ap-showcase-body">
      <!-- Webpage Mockup with Neon Cursor Inside Card Context -->
      <div class="ap-viewport-mock">
        <div class="ap-mock-card" style="position: relative;">
          <!-- Floating simulated neon cursor positioned relative to card -->
          <div
            class="ap-virtual-cursor"
            :style="{
              transform: `translate(${cursorX}px, ${cursorY}px)`,
              opacity: 1
            }"
          >
            <div class="ap-cursor-pointer"></div>
            <div v-if="showRipple" class="ap-ripple"></div>
          </div>

          <div style="font-size: 0.8rem; font-weight: 700; color: #38bdf8; margin-bottom: 0.75rem;">
            Agent Control Center
          </div>
          <div class="ap-mock-input">
            {{ typedText || 'Type a prompt or task...' }}
          </div>
          <button class="ap-mock-button" :style="{ filter: isClicked ? 'brightness(1.2)' : 'none' }">
            {{ isClicked ? '⚡ Processing Task...' : 'Run Automation' }}
          </button>
        </div>
      </div>

      <!-- Real-time MCP Stream Logs -->
      <div class="ap-stream-terminal">
        <div class="ap-stream-title">
          Live Bridge Telemetry (ws://127.0.0.1:58765)
        </div>
        <div v-for="(entry, index) in logEntries" :key="index" class="ap-log-entry">
          <span class="ap-time">{{ entry.time }}</span>
          <span class="ap-prefix">[{{ entry.prefix }}]</span>
          <span :class="entry.prefix === 'MCP' ? 'ap-cmd' : 'ap-res'">{{ entry.msg }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
