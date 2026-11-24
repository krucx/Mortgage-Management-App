import { useParams } from 'react-router'

/** The route has no such record: its address parameter isn't a whole number above zero. */
export class InvalidRouteIdError extends Error {
  constructor(paramName: string, value: string | undefined) {
    super(`Route parameter "${paramName}" is not a positive whole number: ${value ?? '(missing)'}`)
  }
}

/** The whole number in the route's `paramName` parameter. A missing, non-numeric, fractional
 *  or non-positive one throws `InvalidRouteIdError`, which the routes show as Page not
 *  found, so no request with a bad id is ever made. */
export function useNumericId(paramName = 'id'): number {
  const value = useParams()[paramName]
  const id = Number(value)
  if (!/^[1-9]\d*$/.test(value ?? '') || !Number.isSafeInteger(id)) {
    throw new InvalidRouteIdError(paramName, value)
  }
  return id
}
