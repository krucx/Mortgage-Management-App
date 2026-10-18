// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { applyTheme, chosenTheme, nextChoice } from '../src/theme'

afterEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

test('switching away from the browser theme chooses the other one', () => {
  expect(nextChoice('light', 'light')).toBe('dark')
  expect(nextChoice('dark', 'dark')).toBe('light')
})

test('switching back to what the browser would show follows the browser again', () => {
  expect(nextChoice('dark', 'light')).toBeNull()
  expect(nextChoice('light', 'dark')).toBeNull()
})

test('a choice is shown and remembered; following the browser forgets it', () => {
  applyTheme('dark')
  expect(document.documentElement.dataset.theme).toBe('dark')
  expect(chosenTheme()).toBe('dark')

  applyTheme(null)
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  expect(chosenTheme()).toBeNull()
})
