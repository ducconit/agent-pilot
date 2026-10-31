import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const base = process.env.VITEPRESS_BASE || '/agent-pilot/'

export default withMermaid(
  defineConfig({
    title: 'Agent Pilot',
    base,

    locales: {
      root: {
        label: 'English',
        lang: 'en-US',
        description: 'Universal AI Agent Browser Controller (Skills + CLI & MCP)',
        themeConfig: {
          nav: [
            { text: 'Guide', link: '/USAGE_GUIDE' },
            { text: '💡 Prompt Recipes', link: '/PROMPT_RECIPES' },
            { text: '❓ Q&A', link: '/QA' },
            { text: '🔍 Troubleshooting', link: '/TROUBLESHOOTING' },
            {
              text: 'Developer 🛠️',
              items: [
                { text: 'Operational Flow & Contributing', link: '/DEVELOPER_GUIDE' },
                { text: 'System Architecture', link: '/ARCHITECTURE' },
                { text: 'CDP Engine & Trusted Input', link: '/CDP_GUIDE' },
                { text: 'DevTools & Diagnostics', link: '/DEVTOOLS' },
                { text: 'API & Message Reference', link: '/API_REFERENCE' },
                { text: 'Performance Benchmarks', link: '/BENCHMARKS' }
              ]
            },
            {
              text: '🐞 Report Bugs',
              link: '/COMMUNITY_SUPPORT'
            }
          ],

          sidebar: [
            {
              text: '📘 General Documentation',
              items: [
                { text: '📖 Installation & Features', link: '/USAGE_GUIDE' },
                { text: '💡 Sample Prompts & Recipes', link: '/PROMPT_RECIPES' },
                { text: '🤖 AI Agent Setup (Skills, CLI & MCP)', link: '/ANTIGRAVITY_INTEGRATION' },
                { text: '❓ Questions & Answers (Q&A)', link: '/QA' },
                { text: '🔍 Troubleshooting & Issues', link: '/TROUBLESHOOTING' },
                { text: '📦 OS Release Bundles', link: '/BUNDLE_README' },
                { text: '🐧 Ubuntu / Linux Setup', link: '/bundles/README.ubuntu' },
                { text: '🍎 macOS Setup', link: '/bundles/README.macos' },
                { text: '🪟 Windows Setup', link: '/bundles/README.windows' },
              ]
            },
            {
              text: '🛠️ Developer',
              items: [
                { text: '🌿 Operational Flow & Contributing', link: '/DEVELOPER_GUIDE' },
                { text: '🏛️ System Architecture', link: '/ARCHITECTURE' },
                { text: '⚡ CDP Protocol & Trusted Input', link: '/CDP_GUIDE' },
                { text: '🔬 DevTools & Heap Diagnostics', link: '/DEVTOOLS' },
                { text: '📊 Benchmarks & Latency', link: '/BENCHMARKS' },
                { text: '📋 API & Message Reference', link: '/API_REFERENCE' },
              ]
            },
            {
              text: '🐞 Support & Feedback',
              items: [
                { text: '🐞 Report Bugs & Feature Requests', link: '/COMMUNITY_SUPPORT' },
                { text: '🚀 GitHub Releases (v1.3.0)', link: 'https://github.com/ducconit/agent-pilot/releases' },
              ]
            }
          ],

          footer: {
            message: 'Released under the MIT License • 100% Vibe-coded with Google Antigravity • Use with caution.',
            copyright: 'Copyright © 2024-present DNT (ducconit).'
          },

          docFooter: {
            prev: 'Previous page',
            next: 'Next page'
          },

          outline: {
            level: [2, 3],
            label: 'On this page'
          }
        }
      },

      vi: {
        label: 'Tiếng Việt',
        lang: 'vi-VN',
        link: '/vi/',
        description: 'Bộ điều khiển trình duyệt đa năng cho AI Agent (Skills + CLI & MCP)',
        themeConfig: {
          nav: [
            { text: 'Hướng Dẫn', link: '/vi/USAGE_GUIDE' },
            { text: '💡 Prompt Mẫu', link: '/vi/PROMPT_RECIPES' },
            { text: '❓ Hỏi Đáp (Q&A)', link: '/vi/QA' },
            { text: '🔍 Lỗi Thường Gặp', link: '/vi/TROUBLESHOOTING' },
            {
              text: 'Lập Trình Viên 🛠️',
              items: [
                { text: 'Luồng Hoạt Động & Đóng Góp', link: '/vi/DEVELOPER_GUIDE' },
                { text: 'Kiến Trúc Hệ Thống', link: '/vi/ARCHITECTURE' },
                { text: 'Giao Thức CDP & Trusted Input', link: '/vi/CDP_GUIDE' },
                { text: 'Bộ DevTools & Diagnostics', link: '/vi/DEVTOOLS' },
                { text: 'API & Message Reference', link: '/vi/API_REFERENCE' },
                { text: 'Đo Lường Hiệu Năng & Benchmarks', link: '/vi/BENCHMARKS' }
              ]
            },
            {
              text: '🐞 Báo Lỗi',
              link: '/vi/COMMUNITY_SUPPORT'
            }
          ],

          sidebar: [
            {
              text: '📘 Tài Liệu Chung',
              items: [
                { text: '📖 Hướng Dẫn & Cài Đặt', link: '/vi/USAGE_GUIDE' },
                { text: '💡 Prompt Mẫu & Kịch Bản AI', link: '/vi/PROMPT_RECIPES' },
                { text: '🤖 Tích Hợp AI Agent (Skills, CLI & MCP)', link: '/vi/ANTIGRAVITY_INTEGRATION' },
                { text: '❓ Hỏi & Đáp Thường Gặp (Q&A)', link: '/vi/QA' },
                { text: '🔍 Lỗi Thường Gặp & Khắc Phục', link: '/vi/TROUBLESHOOTING' },
                { text: '📦 Gói Cài Đặt Theo Hệ Điều Hành', link: '/vi/BUNDLE_README' },
                { text: '🐧 Cài Đặt Trên Ubuntu / Linux', link: '/vi/bundles/README.ubuntu' },
                { text: '🍎 Cài Đặt Trên macOS', link: '/vi/bundles/README.macos' },
                { text: '🪟 Cài Đặt Trên Windows', link: '/vi/bundles/README.windows' },
              ]
            },
            {
              text: '🛠️ Lập Trình Viên',
              items: [
                { text: '🌿 Luồng Hoạt Động & Đóng Góp', link: '/vi/DEVELOPER_GUIDE' },
                { text: '🏛️ Kiến Trúc Hệ Thống', link: '/vi/ARCHITECTURE' },
                { text: '⚡ Giao Thức CDP & Trusted Input', link: '/vi/CDP_GUIDE' },
                { text: '🔬 Bộ Công Cụ DevTools Nâng Cao', link: '/vi/DEVTOOLS' },
                { text: '📊 Đo Lường Hiệu Năng & Benchmarks', link: '/vi/BENCHMARKS' },
                { text: '📋 API & Message Reference', link: '/vi/API_REFERENCE' },
              ]
            },
            {
              text: '🐞 Hỗ Trợ & Báo Lỗi',
              items: [
                { text: '🐞 Báo Lỗi & Đề Xuất', link: '/vi/COMMUNITY_SUPPORT' },
                { text: '🚀 GitHub Releases (v1.3.0)', link: 'https://github.com/ducconit/agent-pilot/releases' },
              ]
            }
          ],

          footer: {
            message: 'Phát hành theo giấy phép MIT License • 100% Vibe Coding cùng Google Antigravity • Cẩn trọng khi sử dụng.',
            copyright: 'Bản quyền © 2024-hiện tại DNT (ducconit).'
          },

          docFooter: {
            prev: 'Trang trước',
            next: 'Trang sau'
          },

          outline: {
            level: [2, 3],
            label: 'Mục lục trang'
          }
        }
      }
    },

    head: [
      ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}logo.svg` }],
      ['meta', { name: 'theme-color', content: '#06b6d4' }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:title', content: 'Agent Pilot - Universal AI Agent Browser Controller' }],
      ['meta', { property: 'og:description', content: 'Lightweight, zero-dependency browser controller built for AI Coding Agents (Google Antigravity, Claude Code, Cursor).' }],
      ['meta', { property: 'og:image', content: `${base}banner.svg` }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ],

    themeConfig: {
      logo: '/logo.svg',
      siteTitle: 'Agent Pilot',

      search: {
        provider: 'local',
        options: {
          locales: {
            root: {
              translations: {
                button: {
                  buttonText: 'Search documentation...',
                  buttonAriaLabel: 'Search documentation'
                }
              }
            },
            vi: {
              translations: {
                button: {
                  buttonText: 'Tìm kiếm tài liệu...',
                  buttonAriaLabel: 'Tìm kiếm tài liệu'
                },
                modal: {
                  noResultsText: 'Không tìm thấy kết quả cho',
                  resetButtonTitle: 'Xóa tìm kiếm',
                  footer: {
                    selectText: 'để chọn',
                    navigateText: 'để chuyển',
                    closeText: 'để đóng'
                  }
                }
              }
            }
          }
        }
      },

      socialLinks: [
        { icon: 'github', link: 'https://github.com/ducconit/agent-pilot' }
      ]
    },

    mermaid: {
      // Mermaid configuration
    },

    vite: {
      optimizeDeps: {
        include: [
          'mermaid',
          'fastdom',
          'fastdom/extensions/fastdom-promised.js'
        ]
      }
    }
  })
)
