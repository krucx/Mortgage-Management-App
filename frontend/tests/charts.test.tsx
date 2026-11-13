// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { PaymentsByMonthChart } from '../src/components/PaymentsByMonthChart'
import { ProjectionChart } from '../src/components/ProjectionChart'

afterEach(cleanup)

const gridlineLabels = () =>
  [...screen.getByRole('img').querySelectorAll('line.grid + text')].map(
    (label) => label.textContent,
  )

test("the Projection chart's gridlines show whole rupees, never paise", () => {
  const point = (months: number, on: string, outstanding: number) => ({
    months,
    on,
    principal: outstanding,
    unpaid_interest: 0,
    outstanding,
    loan_to_value: null,
  })
  render(
    <ProjectionChart
      series={[
        {
          label: 'Outstanding',
          className: 'outstanding',
          // At most ₹1,60,949.01: half of it is ₹80,474.505
          points: [point(0, '2026-04-20', 10_000_000), point(12, '2027-04-20', 16_094_901)],
        },
      ]}
      termChanges={[]}
    />,
  )
  expect(gridlineLabels()).toEqual(['₹0', '₹80,475', '₹1,60,949'])
})

test("the Payments-by-month chart's gridlines show whole rupees, never paise", () => {
  // ₹5 at most: the scale tops out at ₹5, and half of it is ₹2.50
  render(<PaymentsByMonthChart months={[{ month: '2026-03', amount: 500 }]} />)
  expect(gridlineLabels()).toEqual(['₹0', '₹3', '₹5'])
})
