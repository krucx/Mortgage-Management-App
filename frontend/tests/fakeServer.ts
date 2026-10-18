// A stand-in for the backend in page tests: answers requests by method and path, and
// records what was asked. Anything it has no answer for is a 404, as the backend would say.

// A route's answer: a JSON body, a Response, or a function of the request giving either.
type Answer = unknown

export interface FakeServer {
  /** For the typed client. */
  fetch: (request: Request) => Promise<Response>
  /** "METHOD /api/path" of every request, in order. */
  requests: string[]
}

export function fakeServer(routes: Record<string, Answer>): FakeServer {
  const requests: string[] = []
  return {
    requests,
    fetch: async (request) => {
      const route = `${request.method} ${new URL(request.url).pathname}`
      requests.push(route)
      if (!(route in routes)) {
        return Response.json({ detail: 'Not Found' }, { status: 404 })
      }
      const answer = routes[route]
      const body = typeof answer === 'function' ? await answer(request) : answer
      return body instanceof Response ? body : Response.json(body)
    },
  }
}
