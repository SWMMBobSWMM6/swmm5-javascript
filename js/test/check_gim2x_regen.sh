#!/bin/bash
# check_gim2x_regen.sh [GIMPLE_DIR TABLES_JSON] - the JavaScript back end was added to tools/libm/gim2x.py without
# changing the others: regenerate the TypeScript, Java, Go and Kotlin translations into a temporary folder with the
# current gim2x.py and compare them byte for byte with the shipped files; regenerate the JavaScript one and compare
# it with js/swmm5/glibm.js. The GIMPLE dumps and tables come from tools/libm/build_glibm.sh and extract_tables.py
# (here, the build kept at /home/claude/ext/glibm_build). Written by Claude (Anthropic) for Robert Dickinson.
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
G=${1:-/home/claude/ext/glibm_build/gimple}; T=${2:-/home/claude/ext/glibm_build/tables.json}
W=$(mktemp -d "${TMPDIR:-/tmp}/gimregen.XXXXXX"); trap 'rm -rf "$W"' EXIT
DUMPS="$G/e_exp.c.254t.optimized $G/e_log.c.254t.optimized $G/e_pow.c.254t.optimized $G/s_sin.c.254t.optimized
       $G/s_tan.c.254t.optimized $G/e_asin.c.254t.optimized $G/s_atan.c.254t.optimized $G/e_log10.c.254t.optimized"
NAMES="--name my_exp_fma=exp --name my_log=log --name my_sin=sin --name my_cos=cos --name my_tan=tan
       --name my_asin=ieee754_asin --name my_acos=ieee754_acos --name my_atan=atan --name my_log10=ieee754_log10"
g() { python3 "$ROOT/tools/libm/gim2x.py" "$@" > /dev/null; }
g ts "$W/glibm.ts" $DUMPS --tables "$T" $NAMES --name my_pow=pow_exact
g java "$W/Glibm.java" $DUMPS --tables "$T" $NAMES --name my_pow=pow
g go "$W/glibm.go" $DUMPS --tables "$T" --name my_exp_fma=Exp --name my_log=Log --name my_pow=Pow --name my_sin=Sin \
  --name my_cos=Cos --name my_tan=Tan --name my_asin=ieee754_asin --name my_acos=ieee754_acos --name my_atan=Atan \
  --name my_log10=ieee754_log10
gofmt "$W/glibm.go" > "$W/glibm_fmt.go"
g kt "$W/Glibm.kt" $DUMPS --tables "$T" $NAMES --name my_pow=pow
g js "$W/glibm.js" $DUMPS --tables "$T" $NAMES --name my_pow=pow_exact
for p in "glibm.ts ts/src/glibm.ts" "Glibm.java java/src/swmm5/Glibm.java" "glibm_fmt.go go/glibm/glibm.go" \
         "Glibm.kt kotlin/src/swmm5/Glibm.kt" "glibm.js js/swmm5/glibm.js"; do
  set -- $p
  if cmp -s "$W/$1" "$ROOT/$2"; then echo "identical: $2"; else echo "DIFFERS: $2"; fi
done
if cmp -s "$ROOT/tools/libm/glibm_rt.js" "$ROOT/js/swmm5/glibm_rt.js"; then echo "identical: js/swmm5/glibm_rt.js (copy of tools/libm/glibm_rt.js)"; else echo "DIFFERS: js/swmm5/glibm_rt.js"; fi
