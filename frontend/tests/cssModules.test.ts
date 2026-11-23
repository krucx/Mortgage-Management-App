// Every scoped stylesheet (src/**/*.module.css) has a declaration beside it naming its
// classes, so a misspelt class is a type error; and it styles with the global design
// tokens from index.css rather than its own colours.
import { readFileSync, readdirSync } from 'node:fs'
import { expect, test } from 'vitest'
import { classNames, declarationFor } from '../scripts/css-module-types.ts'

const src = new URL('../src/', import.meta.url)
const modules = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((path) => path.endsWith('.module.css'))
  .sort()
const read = (path: string) => readFileSync(new URL(path, src), 'utf8')

test('the app has CSS modules to check', () => {
  expect(modules).toContain('components/TopBar.module.css')
})

test.each(modules)('%s has an up-to-date declaration', (path) => {
  const beside = path.replace(/\.module\.css$/, '.module.d.css.ts')
  let written = ''
  try {
    written = read(beside)
  } catch {
    // Missing: the comparison below fails with the expected text.
  }
  expect(written, 'run `npm run gen:css-types` and commit the result').toBe(
    declarationFor(read(path)),
  )
})

test.each(modules)('%s uses only design tokens the global stylesheet defines', (path) => {
  const tokens = new Set(read('index.css').match(/--[\w-]+(?=\s*:)/g))
  const used = [...read(path).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1])
  expect(used.filter((token) => !tokens.has(token))).toEqual([])
})

test('class names are read from selectors, not from numbers, comments, strings or URLs', () => {
  const css = `
    /* .commented-out { } */
    .bar, .bar:hover > .title-link { margin: 0.5rem 1.25rem; }
    .dot::before { content: '.not-a-class'; background: url(icon.svg); }
    @media (max-width: 640px) { .bar .nav_link[aria-current='page'] { gap: .75rem; } }
  `
  expect(classNames(css)).toEqual(['bar', 'dot', 'nav_link', 'title-link'])
})

test('the declaration types each class as a string, and nothing else', () => {
  expect(declarationFor('.bar {} .title-link {}')).toBe(
    [
      '// Generated from the stylesheet beside it by `npm run gen:css-types`; do not edit.',
      'declare const styles: {',
      '  readonly bar: string',
      "  readonly 'title-link': string",
      '}',
      'export default styles',
      '',
    ].join('\n'),
  )
})
