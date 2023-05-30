#!/usr/bin/env sh

bun --watch build --outdir=./build --target=browser --sourcemap=external src/index.ts
