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

License source (also fetched with webfetch):
https://raw.githubusercontent.com/lobehub/lobe-icons/master/LICENSE

`ProviderLogos.tsx` serves these local assets with `next/image` (unoptimized).
OpenAI and Yi use the upstream monochrome variants with CSS inversion to render
white on the existing dark logo tiles. Kimi's color variant already has a white
mark and blue accent. No remote URLs are requested at runtime.
