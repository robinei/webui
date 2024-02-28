#!/usr/bin/env sh

bun --watch build --outdir=./build --target=browser --sourcemap=inline src/index.ts
