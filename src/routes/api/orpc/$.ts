import { createFileRoute } from "@tanstack/react-router"
import { RPCHandler } from "@orpc/server/fetch"
import { projectsRouter } from "@/lib/orpc/projects"
import { todosRouter } from "@/lib/orpc/todos"
import { usersRouter } from "@/lib/orpc/users"
import { db } from "@/db/connection"
import { auth } from "@/lib/auth"

export const appRouter = {
  projects: projectsRouter,
  todos: todosRouter,
  users: usersRouter,
}

export type AppRouter = typeof appRouter

const handler = new RPCHandler(appRouter)

const serve = async ({ request }: { request: Request }) => {
  const { response } = await handler.handle(request, {
    prefix: `/api/orpc`,
    context: {
      db,
      session: await auth.api.getSession({ headers: request.headers }),
    },
  })

  return response ?? new Response(`Not found`, { status: 404 })
}

export const Route = createFileRoute(`/api/orpc/$`)({
  server: {
    handlers: {
      GET: serve,
      POST: serve,
    },
  },
})
