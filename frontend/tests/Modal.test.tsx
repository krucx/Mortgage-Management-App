// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { ConfirmDialog } from '../src/components/ConfirmDialog'
import styles from '../src/components/Modal.module.css'

afterEach(cleanup)

test('a confirmation is an in-app dialog, given more room when it asks for it', () => {
  const { rerender } = render(<ConfirmDialog title="Save it?" onClose={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Save it?' }).className).toBe(styles.dialog)

  rerender(<ConfirmDialog title="Save it?" wide onClose={() => {}} />)
  expect(screen.getByRole('dialog', { name: 'Save it?' }).className).toBe(
    `${styles.dialog} ${styles.wide}`,
  )
})
