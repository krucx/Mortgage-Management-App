// Drawing helpers shared by the charts.

/** A date's place on a time axis. */
export const time = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`).getTime()

/** A smooth path through the points that never overshoots them (monotone cubic). */
export function smoothPath(xy: [number, number][]): string {
  if (xy.length < 2) return ''
  const slopes = xy.slice(1).map(([x, y], i) => (y - xy[i][1]) / (x - xy[i][0]))
  const tangents = xy.map((_, i) => {
    if (i === 0) return slopes[0]
    if (i === xy.length - 1) return slopes[i - 1]
    const [before, after] = [slopes[i - 1], slopes[i]]
    return before * after <= 0 ? 0 : (2 * before * after) / (before + after)
  })
  let path = `M${xy[0][0]},${xy[0][1]}`
  for (let i = 0; i < xy.length - 1; i++) {
    const [x0, y0] = xy[i]
    const [x1, y1] = xy[i + 1]
    const third = (x1 - x0) / 3
    path += ` C${x0 + third},${y0 + tangents[i] * third} ${x1 - third},${y1 - tangents[i + 1] * third} ${x1},${y1}`
  }
  return path
}
