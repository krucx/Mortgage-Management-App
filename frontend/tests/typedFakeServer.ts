// The typed form of fakeServer: a route is a method plus a path template that exists in
// the generated API `paths`, and its answer is that operation's success body, so a renamed
// route or a dropped response field fails `tsc`. Error answers are a Response.
import type { paths } from '../src/api.gen'
import type { FakeServer } from './fakeServer'

type Method = 'get' | 'put' | 'post' | 'delete' | 'patch'

/** Every "METHOD /api/path/{template}" the API has, with the operation behind it. */
type Operations = {
  [
    R in {
      [P in keyof paths & string]: {
        [M in Method]: paths[P][M & keyof paths[P]] extends object ? `${Uppercase<M>} ${P}` : never
      }[Method]
    }[keyof paths & string]
  ]: R extends `${infer M} ${infer P}`
    ? paths[P & keyof paths][Lowercase<M> & keyof paths[P & keyof paths]]
    : never
}

export type Route = keyof Operations

/** The JSON body an operation answers with on success. */
type SuccessBody<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses & (200 | 201 | 202)]: Responses[Status] extends {
        content: { 'application/json': infer Body }
      }
        ? Body
        : null
    }[keyof Responses & (200 | 201 | 202)]
  : never

type Reply<R extends Route> = SuccessBody<Operations[R]> | Response

/** A route's answer: its success body, a Response, or a function of the request giving either. */
export type Answer<R extends Route> =
  Reply<R> | ((request: Request) => Reply<R> | Promise<Reply<R>>)

export type Routes = { [R in Route]?: Answer<R> }

const templateMatcher = (template: string) =>
  new RegExp(`^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+')}$`)

export function typedFakeServer(routes: Routes): FakeServer {
  const requests: string[] = []
  const entries = Object.entries(routes).map(([key, answer]) => {
    const [method, template] = key.split(' ')
    return { method, path: templateMatcher(template), answer }
  })
  return {
    requests,
    fetch: async (request) => {
      const path = new URL(request.url).pathname
      requests.push(`${request.method} ${path}`)
      const match = entries.find((e) => e.method === request.method && e.path.test(path))
      if (!match) return Response.json({ detail: 'Not Found' }, { status: 404 })
      const body = typeof match.answer === 'function' ? await match.answer(request) : match.answer
      return body instanceof Response ? body : Response.json(body)
    },
  }
}
