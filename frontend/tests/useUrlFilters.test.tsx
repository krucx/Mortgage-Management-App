// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { useUrlFilters } from '../src/components/useUrlFilters'

afterEach(cleanup)

test('two changes made before a re-render both reach the URL', () => {
  const { result } = renderHook(() => useUrlFilters(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter initialEntries={['/list?q=ann']}>{children}</MemoryRouter>
    ),
  })

  act(() => {
    result.current[1]({ status: 'open' })
    result.current[1]({ page: '2' })
  })

  expect(Object.fromEntries(result.current[0])).toEqual({ q: 'ann', status: 'open', page: '2' })
})
