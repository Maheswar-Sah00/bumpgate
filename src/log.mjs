// Terminal output. Colour only on a TTY; plain text in CI logs.
const tty = process.stderr.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));

export const color = {
  dim: c('2'), bold: c('1'), red: c('31'), green: c('32'), yellow: c('33'), gray: c('90'), amber: c('38;5;214'),
};

export function makeLogger({ quiet = false, json = false } = {}) {
  const t0 = Date.now();
  const stamp = () => color.gray(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s`);
  const out = (s) => { if (!quiet && !json) process.stderr.write(s + '\n'); };
  return {
    step: (s) => out(`${stamp()} ${color.bold('▸')} ${s}`),
    info: (s) => out(`${stamp()}   ${s}`),
    dim: (s) => out(`${stamp()}   ${color.dim(s)}`),
    ok: (s) => out(`${stamp()} ${color.green('✓')} ${s}`),
    warn: (s) => out(`${stamp()} ${color.amber('!')} ${s}`),
    fail: (s) => out(`${stamp()} ${color.red('✗')} ${s}`),
    raw: out,
  };
}

export function lightText(light) {
  return { green: color.green('● green'), amber: color.amber('● amber'), red: color.red('● red'), grey: color.gray('● grey') }[light] || light;
}
