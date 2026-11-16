#!/bin/sh
set -eu
cd "$(dirname "$0")/../core"
node ../scripts/check-feature-sources.mjs
export RAYON_NUM_THREADS=1 UV_THREADPOOL_SIZE=1 T3CODE_WEB_SOURCEMAP=0
pnpm --dir apps/web exec vp build --minify false
pnpm --dir apps/server exec node scripts/cli.ts build
