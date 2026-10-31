import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import GitHubStars from './components/GitHubStars.vue'
import BrowserShowcase from './components/BrowserShowcase.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(GitHubStars)
    })
  },
  enhanceApp({ app }: { app: any }) {
    app.component('BrowserShowcase', BrowserShowcase)
  }
}
