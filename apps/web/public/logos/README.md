# Provider Logos

These SVGs are vendored from [LobeHub lobe-icons](https://github.com/lobehub/lobe-icons),
copyright (c) 2023 LobeHub, under the MIT license included in [LICENSE](./LICENSE).
The SVG artwork is unchanged; only a trailing newline may differ.
Provider names and logos remain trademarks of their respective owners; inclusion
does not imply endorsement or grant trademark rights.

## Sources

Fetched with webfetch on 2026-09-09 from the upstream `master` branch:

| Local asset | Upstream SVG |
| --- | --- |
| `claude-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claude-color.svg |
| `deepseek-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/deepseek-color.svg |
| `qwen-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/qwen-color.svg |
| `kimi-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/kimi-color.svg |
| `openai.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openai.svg |
| `zhipu-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/zhipu-color.svg |
| `yi.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/yi.svg |
| `cursor.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/cursor.svg |
| `cline.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/cline.svg |
| `windsurf.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/windsurf.svg |
| `minimax-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/minimax-color.svg (fetched 2026-10-07) |
| `gemini-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/gemini-color.svg (fetched 2026-10-07) |
| `meta-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/meta-color.svg (fetched 2026-10-07) |
| `mistral-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/mistral-color.svg (fetched 2026-10-07) |
| `anthropic.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/anthropic.svg (fetched 2026-10-20) |
| `groq.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/groq.svg (fetched 2026-10-20) |
| `openrouter.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openrouter.svg (fetched 2026-10-20) |
| `ollama.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/ollama.svg (fetched 2026-10-20) |
| `alibabacloud-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/alibabacloud-color.svg (fetched 2026-10-20) |
| `moonshot.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/moonshot.svg (fetched 2026-10-20) |
| `chutes.svg` | https://unpkg.com/@lobehub/icons-static-svg@1.101.0/icons/chutes.svg (fetched 2026-10-30) |
| `inceptron-color.svg` | https://unpkg.com/@lobehub/icons-static-svg@1.101.0/icons/inceptron-color.svg (fetched 2026-10-30) |

License source (also fetched with webfetch):
https://raw.githubusercontent.com/lobehub/lobe-icons/master/LICENSE

`ProviderLogos.tsx` serves these local assets with `next/image` (unoptimized).
OpenAI and Yi use the upstream monochrome variants with CSS inversion to render
white on the existing dark logo tiles. Kimi's color variant already has a white
mark and blue accent. No remote URLs are requested at runtime.

### App marks (`apps/`)

Fetched on 2026-10-22 from the same upstream `master` branch, for the public Apps analytics:

| Local asset | Upstream SVG |
| --- | --- |
| `apps/claudecode-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claudecode-color.svg |
| `apps/codex-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/codex-color.svg |
| `apps/opencode.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/opencode.svg |
| `apps/kilocode.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/kilocode.svg |
| `apps/roocode.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/roocode.svg |
| `apps/openclaw-color.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openclaw-color.svg |
| `apps/hermesagent.svg` | https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/hermesagent.svg |

### Mono marks (`mono/`)

Single-color (`currentColor`) marks for the white-on-gradient model announcement banners. Fetched on 2026-10-22 from
`https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/<name>.svg`, one file per name:

- `mono/alibaba.svg`
- `mono/anthropic.svg`
- `mono/baidu.svg`
- `mono/bfl.svg`
- `mono/bytedance.svg`
- `mono/claude.svg`
- `mono/deepseek.svg`
- `mono/doubao.svg`
- `mono/flux.svg`
- `mono/gemini.svg`
- `mono/google.svg`
- `mono/grok.svg`
- `mono/hunyuan.svg`
- `mono/kimi.svg`
- `mono/kling.svg`
- `mono/ling.svg`
- `mono/longcat.svg`
- `mono/meta.svg`
- `mono/minimax.svg`
- `mono/mistral.svg`
- `mono/moonshot.svg`
- `mono/openai.svg`
- `mono/pixverse.svg`
- `mono/qwen.svg`
- `mono/sakana.svg`
- `mono/stepfun.svg`
- `mono/tencent.svg`
- `mono/wenxin.svg`
- `mono/xai.svg`
- `mono/xiaomimimo.svg`
- `mono/zai.svg`
