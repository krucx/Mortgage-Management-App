// Every scoped stylesheet (src/**/*.module.css) has a declaration beside it naming its
// classes, so a misspelt class is a type error; and it styles with the global design
// tokens from index.css rather than its own colours.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  classNames,
  cssModules,
  declarationFor,
  declarationPath,
  src,
} from '../scripts/css-module-types.ts'

const modules = cssModules()
const read = (path: string) => readFileSync(new URL(path, src), 'utf8')

test('the app has CSS modules to check', () => {
  expect(modules).toContain('components/TopBar.module.css')
})

test.each(modules)('%s has an up-to-date declaration', (path) => {
  let written = ''
  try {
    written = read(declarationPath(path))
  } catch {
    // Missing: the comparison below fails with the expected text.
  }
  expect(written, 'run `npm run gen:css-types` and commit the result').toBe(
    declarationFor(read(path)),
  )
})

test.each(modules)('%s uses only design tokens the global stylesheet defines', (path) => {
  const defined = (css: string) => css.match(/--[\w-]+(?=\s*:)/g) ?? []
  // Or one of its own, such as the Dashboard's --tone, set per group from the tokens.
  const tokens = new Set([...defined(read('index.css')), ...defined(read(path))])
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

test("a class named inside :global(…) is the global one, not the module's own", () => {
  const css = `
    .calculator :global(details.tucked) { margin: 0; }
    :global(.layout:has(.card.wide)) .banner { max-width: 1100px; }
  `
  expect(classNames(css)).toEqual(['banner', 'calculator'])
})

// The global stylesheet styles plain elements and the classes many screens share; a class
// that only one component uses belongs in that component's CSS module.
const SHARED_CLASSES = [
  'align-end',
  'badge',
  'baseline',
  'button',
  'card',
  'chart',
  'close-panel',
  'count',
  'danger',
  'danger-solid',
  'end',
  'error',
  'field',
  'gallery',
  'gallery-item',
  'grace',
  'grid',
  'grid-2',
  'grid-3',
  'hint',
  'inline',
  'key',
  'link',
  'marker',
  'no-print',
  'nowrap',
  'num',
  'ok',
  'photo',
  'placeholder',
  'plain',
  'receipt-panel',
  'refreshing',
  'row',
  'saved',
  'secondary',
  'series',
  'small',
  'small-input',
  'spread',
  'stack',
  'status',
  'status-active',
  'status-forfeited',
  'status-redeemed',
  'status-waived',
  'summary',
  'summary-row',
  'table-scroll',
  'thumb',
  'tile',
  'tiles',
  'tucked',
  'voided',
  'warning',
  'what-if',
  'wide',
  'with-photo',
]

test('the global stylesheet styles only classes many screens share', () => {
  const own = classNames(read('index.css')).filter((name) => !SHARED_CLASSES.includes(name))
  expect(own, 'move these to the CSS module of the component using them').toEqual([])
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
