#!/bin/sh
# run_crtcheck.sh - check the JavaScript runtime's printf, strtod and sscanf against the system glibc:
# tools/crt/test/mkfmt.c writes about 1.4 million reference cases from glibc, test/crtcheck.js replays them
# through swmm5/crt.js and counts the differences. The vectors go to a temporary folder and are deleted.
# Written by Claude (Anthropic) for Robert Dickinson; see js/README.md.
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -d "${TMPDIR:-/tmp}/jscrt.XXXXXX")
gcc -O2 -o "$T/mkfmt" ../tools/crt/test/mkfmt.c -lm
"$T/mkfmt" > "$T/fmt.txt"
node test/crtcheck.js "$T/fmt.txt"
rm -rf "$T"
