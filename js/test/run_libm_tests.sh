#!/bin/bash
# run_libm_tests.sh [N] - check the JavaScript port's math (swmm5/glibm.js, glibm_rt.js) bit for bit against
# the system libm, the library EPA's runswmm calls: N random arguments per function over the ranges SWMM uses
# (tools/libm/test/mkvectors.c, default 1,000,000), the edge cases of mkedge.c 100000 (3.3 million: huge
# trigonometric arguments, negative bases, overflow, underflow, subnormals, domain errors), and a differential
# test of pow's fast path against pow_exact on 20 million further arguments. The vectors go to a temporary
# folder (TMPDIR) and are deleted. Written by Claude (Anthropic) for Robert Dickinson; see js/README.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
N=${1:-1000000}
T=$(mktemp -d "${TMPDIR:-/tmp}/jslibm.XXXXXX"); trap 'rm -rf "$T"' EXIT
gcc -O2 -o "$T/mkvectors" "$ROOT/tools/libm/test/mkvectors.c" -lm
gcc -O2 -o "$T/mkedge" "$ROOT/tools/libm/test/mkedge.c" -lm
"$T/mkvectors" "$N" "$T/vectors.bin"
"$T/mkedge" 100000 "$T/edge.bin"
echo "== random arguments over SWMM's ranges ($N per function)"
node "$HERE/check_libm.js" "$T/vectors.bin"
echo "== edge cases"
node "$HERE/check_libm.js" "$T/edge.bin"
echo "== pow fast path against pow_exact"
node "$HERE/powdiff.js" 20
