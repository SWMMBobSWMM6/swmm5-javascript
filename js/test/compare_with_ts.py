#!/usr/bin/env python3
"""compare_with_ts.py - how close the JavaScript port is to the TypeScript port, measured.

Regenerates the TypeScript engine (tools/c2x/emit_ts.py) into a temporary folder and compares it with
js/swmm5/engine.js line by line after replacing each function's signature line and each hoisted `let` line
by a marker (the only lines where emit_js.py writes something different: TypeScript's types), and does the
same for the math library (ts/src/glibm.ts against js/swmm5/glibm.js, from tools/libm/gim2x.py's two back
ends). Written by Claude (Anthropic) for Robert Dickinson; see js/README.md."""
import os, re, subprocess, sys, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def norm(lines):
    """function signatures and the hoisted declarations (a function's first `let` line, two spaces in) are the
    lines where TypeScript has types; they become markers"""
    out = []
    for l in lines:
        m = re.match(r'^(?:export )?function (\w+)', l)
        if m:
            out.append('FUNCTION ' + m.group(1)); continue
        if l.startswith('  let ') and not l.startswith('  let bb'):
            out.append('LETS'); continue
        out.append(l)
    return out


def body_from(lines, first):
    i = [k for k, l in enumerate(lines) if l.startswith(first)][0]
    return lines[i:]


with tempfile.TemporaryDirectory() as td:
    subprocess.run([sys.executable, os.path.join(ROOT, 'tools/c2x/emit_ts.py'), td], check=True, capture_output=True)
    ts = norm(open(os.path.join(td, 'engine.ts')).read().split('\n'))
js = norm(open(os.path.join(ROOT, 'js/swmm5/engine.js')).read().split('\n'))
a = body_from(ts, '// climate.c:')
b = body_from(js, '// climate.c:')
end = b.index('module.exports = {')
b = b[:end]
a = a[:len(b)] if len(a) > len(b) else a
diff = sum(1 for x, y in zip(a, b) if x != y) + abs(len(a) - len(b))
print('engine: %d lines of function bodies from the first function on; %d differ between engine.ts (regenerated) and engine.js'
      % (len(b), diff))
ts = norm(open(os.path.join(ROOT, 'ts/src/glibm.ts')).read().split('\n'))
js = norm(open(os.path.join(ROOT, 'js/swmm5/glibm.js')).read().split('\n'))
a = body_from(ts, 'FUNCTION exp'); b = body_from(js, 'FUNCTION exp')
ea = [k for k, l in enumerate(a) if l.startswith('// Fast path of pow')][0]
eb = [k for k, l in enumerate(b) if l.startswith('// Fast path of pow')][0]
diff = sum(1 for x, y in zip(a[:ea], b[:eb]) if x != y) + abs(ea - eb)
print('math: %d lines of translated glibc routines; %d differ between ts/src/glibm.ts and js/swmm5/glibm.js' % (eb, diff))
ta = [l for l in open(os.path.join(ROOT, 'ts/src/glibm.ts')).read().split('\n') if l.startswith('const T_')]
tb = [l for l in open(os.path.join(ROOT, 'js/swmm5/glibm.js')).read().split('\n') if l.startswith('const T_')]
print('math tables: %d in each, identical: %s' % (len(tb), ta == tb))
