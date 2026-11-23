import type { ReactNode } from 'react'

/** Why a field is refused, shown beside it; nothing if it isn't. */
export function FieldProblem({ problem }: { problem: ReactNode }) {
  return problem ? <span className="status error">{problem}</span> : null
}
