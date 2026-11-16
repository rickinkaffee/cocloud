# Third-party notices

T3 Code v0.1.8 is Copyright (c) 2026 T3 Tools Inc., licensed under MIT. The complete notice is in `LICENSE` and `licenses/LICENSE.t3-code`. Local extension source is distributed under the same MIT terms. This distribution is an independent fork and does not claim ownership of upstream projects or trademarks.

Hindsight is MIT licensed (`licenses/LICENSE.hindsight`). FloeBrowser is MIT licensed (`licenses/LICENSE.floebrowser`) and is installed as `@floegence/floebrowser` from its public npm release. Ionic Framework is MIT licensed (`core/third-party-licenses/LICENSE.ionic-core`). Browser engine third-party notices are supplied by its npm package. Original licenses accompanying upstream source and vendored theme assets are retained in place.

`DEPENDENCIES.json` records exact installed dependency versions, declared licenses and hashes of locally available license evidence. Node lockfiles and the memory Python lock identify the install inputs. License evidence is collected from the installed packages, not inferred from the top-level application's license. The web build generates `third-party-licenses.json` and refuses missing declarations/notices. Missing npm notices for Rollup's platform package, @nodable/entities and Ionic's components subpath are supplied from their upstream license texts or parent package, with exact overrides in `core/third-party-licenses.config.json`.

Dependencies use MIT, Apache-2.0, BSD, ISC and other open-source licenses; some have additional obligations. In particular:

- `heic-to` is LGPL-3.0. Its license remains in the generated web manifest; if redistributing a compiled derivative, satisfy LGPL source, relinking/replacement and notice requirements for that component. The component source and license are linked in the generated manifest. This repository distributes framework source, not a prebuilt application archive.
- `certifi`, `orjson` and `tqdm` include MPL-2.0 terms. Modifications to covered files require the applicable source and notices. No dependency source modifications are made in these packages.
- Inter and JetBrains Mono fonts retain OFL-1.1 notices. Upstream-generated font assets and their notices stay together. Other bundled sounds, icons and office-viewer code retain notices in `core/third-party-licenses.config.json` and alongside their source.
- `psycopg2-binary` declares LGPL with exceptions. `pypdfium2`, cryptographic/native libraries, embedded PostgreSQL, browser downloads and model weights can carry additional licenses. They are installed separately and are not redistributed as binaries or weights here. Preserve their distribution notices if packaging them later.
- `jszip` offers MIT OR GPL-3.0-or-later; this distribution selects MIT.

The proprietary TypeScript Claude Agent SDK and Cursor SDK packages are not dependencies of this build. The separately published Python `claude-agent-sdk` package in Hindsight's environment declares MIT; that does not license any proprietary agent executable it may operate. No provider executable or account is redistributed. Hosted AI APIs and third-party subscriptions remain subject to their respective service terms.

Full license texts and source links for the exact server/web dependency graph are generated as part of the formal build. An MIT license on this repository never overrides third-party terms.
