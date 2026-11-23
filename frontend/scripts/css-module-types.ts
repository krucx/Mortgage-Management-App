// Writes a declaration beside each CSS module (src/**/X.module.css → X.module.d.css.ts)
// naming its classes, so TypeScript rejects a class the stylesheet doesn't have.
// Run `npm run gen:css-types` after changing a CSS module; tests/cssModules.test.ts fails
// while any declaration is out of date.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The classes a stylesheet's selectors name, sorted. */
export function classNames(css: string): string[] {
  const selectors = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'[^']*'|"[^"]*"/g, '')
    .replace(/url\([^)]*\)/g, '')
    // Declaration blocks (the innermost braces): their values are not selectors.
    .replace(/\{[^{}]*\}/g, '{}')
  const names = new Set([...selectors.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]))
  return [...names].sort()
}

/** The declaration for a stylesheet: each of its classes, as the string Vite scopes it to. */
export function declarationFor(css: string): string {
  const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`)
  return [
    '// Generated from the stylesheet beside it by `npm run gen:css-types`; do not edit.',
    'declare const styles: {',
    ...classNames(css).map((name) => `  readonly ${key(name)}: string`),
    '}',
    'export default styles',
    '',
  ].join('\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = new URL('../src/', import.meta.url)
  for (const path of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
    if (!path.endsWith('.module.css')) continue
    const css = readFileSync(new URL(path, src), 'utf8')
    writeFileSync(
      new URL(path.replace(/\.module\.css$/, '.module.d.css.ts'), src),
      declarationFor(css),
    )
  }
}
