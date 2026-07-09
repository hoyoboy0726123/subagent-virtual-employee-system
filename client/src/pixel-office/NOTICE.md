# Pixel Office — third-party vendored code

The pixel-art office animation engine in this directory (the `engine/`,
`sprites/`, `layout/`, `bugs/` subfolders and the top-level `*.ts` files) plus
the character/wall sprites under `client/public/assets/pixel-office/` are
vendored from:

**OpenClaw-bot-review** by xmanrui — https://github.com/xmanrui/OpenClaw-bot-review

Licensed under the **MIT License** (see `LICENSE.upstream` in this directory).
We use the framework-agnostic Canvas 2D engine and drive it from our meeting
state via `../components/PixelOffice.jsx`. The Next.js dashboard shell, editor,
stats, i18n, and audio from the original project are **not** included.

`char_6.png` and `char_7.png` were downscaled 10× (nearest-neighbour, 1120×960 →
112×96) to match the other character sheets and keep the bundle small; no other
asset was modified.

This vendored code is excluded from our ESLint config (it is third-party TS).
