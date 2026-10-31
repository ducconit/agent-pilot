<script setup lang="ts">
import { ref, onMounted } from 'vue'

const repoUrl = 'https://github.com/ducconit/agent-pilot'
const apiUrl = 'https://api.github.com/repos/ducconit/agent-pilot'
const CACHE_KEY = 'ap_gh_stars'
const CACHE_TIME_KEY = 'ap_gh_stars_time'
const CACHE_TTL = 1000 * 60 * 15 // 15 minutes

const starCount = ref<string | null>(null)
const isLoading = ref(true)

function formatNumber(num: number): string {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

onMounted(async () => {
  // Check local cache first
  try {
    const cachedCount = localStorage.getItem(CACHE_KEY)
    const cachedTime = localStorage.getItem(CACHE_TIME_KEY)
    if (cachedCount && cachedTime && Date.now() - Number(cachedTime) < CACHE_TTL) {
      starCount.value = cachedCount
      isLoading.value = false
      return
    }
  } catch {
    // Ignore localStorage errors (e.g. Incognito)
  }

  // Fetch from GitHub API
  try {
    const res = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json'
      }
    })
    if (res.ok) {
      const data = await res.json()
      if (typeof data.stargazers_count === 'number') {
        const formatted = formatNumber(data.stargazers_count)
        starCount.value = formatted
        try {
          localStorage.setItem(CACHE_KEY, formatted)
          localStorage.setItem(CACHE_TIME_KEY, Date.now().toString())
        } catch {
          // Ignore storage errors
        }
      }
    }
  } catch {
    // Fallback gracefully on network error or offline
  } finally {
    isLoading.value = false
  }
})
</script>

<template>
  <a
    :href="repoUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="github-star-badge"
    title="Star ducconit/agent-pilot on GitHub"
  >
    <svg class="star-icon" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
      <path
        d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z"
      />
    </svg>
    <span class="star-label">Star</span>
    <span v-if="starCount !== null" class="star-count">{{ starCount }}</span>
  </a>
</template>

<style scoped>
.github-star-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  margin-left: 10px;
  font-size: 12px;
  font-weight: 600;
  line-height: 26px;
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-gutter);
  border-radius: 9999px;
  text-decoration: none;
  transition: color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              border-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.2s cubic-bezier(0.4, 0, 0.2, 1),
              box-shadow 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
  flex-shrink: 0;
}

.github-star-badge:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background-color: var(--vp-c-default-soft);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(6, 182, 212, 0.15);
}

.star-icon {
  color: #eab308;
  transition: transform 0.2s ease;
}

.github-star-badge:hover .star-icon {
  transform: scale(1.15) rotate(15deg);
}

.star-label {
  font-size: 12px;
  font-weight: 600;
}

.star-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 2px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 9999px;
  background-color: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-divider);
}

@media (max-width: 768px) {
  .github-star-badge {
    margin-left: 4px;
    padding: 0 6px;
  }
  .star-label {
    display: none;
  }
}

@media (max-width: 360px) {
  .github-star-badge {
    display: none;
  }
}
</style>
