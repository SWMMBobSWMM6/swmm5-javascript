#!/bin/bash
# make_glibm.sh [GIMPLE_DIR TABLES_JSON]
# Regenerate swmm5/glibm.js, the JavaScript translation of glibc 2.39's exp, log, log10, pow, sin, cos, tan, asin,
# acos and atan (the FMA variants EPA's runswmm runs on x86-64), with tools/libm/gim2x.py's JavaScript back end,
# and copy its hand-written runtime tools/libm/glibm_rt.js beside it. The GIMPLE dumps and the constant tables come
# from tools/libm/build_glibm.sh and extract_tables.py (tools/libm/make_libm.sh runs both; they compile glibc's
# sources, they never run them). Written by Claude (Anthropic) for Robert Dickinson; see README.md.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/.." && pwd)
G=${1:-$ROOT/build/glibm/gimple}; T=${2:-$ROOT/build/glibm/tables.json}
python3 "$ROOT/tools/libm/gim2x.py" js "$HERE/swmm5/glibm.js" \
    $G/e_exp.c.254t.optimized $G/e_log.c.254t.optimized $G/e_pow.c.254t.optimized $G/s_sin.c.254t.optimized \
    $G/s_tan.c.254t.optimized $G/e_asin.c.254t.optimized $G/s_atan.c.254t.optimized $G/e_log10.c.254t.optimized \
    --tables "$T" --name my_exp_fma=exp --name my_log=log --name my_sin=sin --name my_cos=cos --name my_tan=tan \
    --name my_asin=ieee754_asin --name my_acos=ieee754_acos --name my_atan=atan --name my_log10=ieee754_log10 \
    --name my_pow=pow_exact
cp "$ROOT/tools/libm/glibm_rt.js" "$HERE/swmm5/glibm_rt.js"
