import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import { Shape, ShapeStream, type Row } from "@electric-sql/client"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { convertSetCookieToCookie } from "better-auth/test"
import { afterEach, describe, expect, test } from "vitest"
import { db } from "../src/db/connection"
import * as schema from "../src/db/auth-schema"

const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:42071`
const abortControllers: AbortController[] = []

async function getBetterAuthTestSession() {
  const auth = betterAuth({
    database: drizzleAdapter(db, {
      provider: `pg`,
      usePlural: true,
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 1,
    },
  })
  const email = `electric-regression-${Date.now()}-${crypto.randomUUID()}@example.com`
  const signUpResponse = await auth.handler(
    new Request(`${baseUrl}/api/auth/sign-up/email`, {
      method: `POST`,
      headers: {
        "content-type": `application/json`,
        origin: baseUrl,
      },
      body: JSON.stringify({ email, password: `password`, name: email }),
    })
  )

  expect(signUpResponse.ok).toBe(true)

  const cookieHeaders = convertSetCookieToCookie(signUpResponse.headers)
  const cookie = cookieHeaders.get(`cookie`)

  if (!cookie) {
    throw new Error(`Better Auth test cookie utility did not return a session cookie`)
  }

  const sessionResponse = await auth.handler(
    new Request(`${baseUrl}/api/auth/get-session`, {
      headers: cookieHeaders,
    })
  )
  const session = await sessionResponse.json()

  if (!session?.user?.id) {
    throw new Error(`Better Auth test session did not include a user`)
  }

  return { cookie, user: session.user }
}

async function createRPCClient(cookie: string) {
  return createORPCClient(
    new RPCLink({
      url: `${baseUrl}/api/orpc`,
      headers: { cookie },
    })
  )
}

async function createShape<T extends Row>(path: string, cookie: string) {
  const abortController = new AbortController()
  abortControllers.push(abortController)
  const stream = new ShapeStream<T>({
    url: `${baseUrl}${path}`,
    headers: { cookie },
    signal: abortController.signal,
    warnOnHttp: false,
  })
  const shape = new Shape(stream)
  await shape.rows

  return shape
}

async function waitFor<T>(callback: () => T | undefined, label: string) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < 10_000) {
    const result = callback()

    if (result !== undefined) {
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Timed out waiting for ${label}`)
}

function rowId(row: Row) {
  return Number(row.id)
}

function createClientId() {
  return Math.floor(1_000_000_000 + Math.random() * 1_000_000_000)
}

afterEach(() => {
  for (const abortController of abortControllers.splice(0)) {
    abortController.abort()
  }
})

describe(`Electric sync regression`, () => {
  test(`projects shape reflects oRPC create, update, and delete`, async () => {
    const { cookie, user } = await getBetterAuthTestSession()
    const client = await createRPCClient(cookie)
    const projectsShape = await createShape<Row>(`/api/projects`, cookie)

    expect(projectsShape.currentRows).toEqual([])

    const projectId = createClientId()
    const created = await client.projects.create({
      id: projectId,
      name: `Electric project`,
      description: `created through oRPC`,
      owner_id: user.id,
      shared_user_ids: [],
    })

    expect(created.item.id).toBe(projectId)

    const syncedCreate = await waitFor(
      () => projectsShape.currentRows.find((row) => rowId(row) === created.item.id),
      `Electric project create`
    )
    expect(syncedCreate.name).toBe(`Electric project`)
    expect(syncedCreate.owner_id).toBe(user.id)

    await client.projects.update({
      id: created.item.id,
      data: {
        name: `Electric project updated`,
        description: `updated through oRPC`,
        shared_user_ids: [user.id],
      },
    })

    const syncedUpdate = await waitFor(() => {
      const row = projectsShape.currentRows.find(
        (project) => rowId(project) === created.item.id
      )
      return row?.name === `Electric project updated` ? row : undefined
    }, `Electric project update`)
    expect(syncedUpdate.description).toBe(`updated through oRPC`)
    expect(syncedUpdate.shared_user_ids).toEqual([user.id])

    await client.projects.delete({ id: created.item.id })

    await waitFor(() => {
      const row = projectsShape.currentRows.find(
        (project) => rowId(project) === created.item.id
      )
      return row === undefined ? true : undefined
    }, `Electric project delete`)
  })

  test(`todos shape reflects oRPC create, update, and delete`, async () => {
    const { cookie, user } = await getBetterAuthTestSession()
    const client = await createRPCClient(cookie)
    const todosShape = await createShape<Row>(`/api/todos`, cookie)

    expect(todosShape.currentRows).toEqual([])

    const projectId = createClientId()
    const project = await client.projects.create({
      id: projectId,
      name: `Electric todo project`,
      description: `project for todo sync`,
      owner_id: user.id,
      shared_user_ids: [],
    })

    expect(project.item.id).toBe(projectId)

    const todoId = createClientId()
    const createdTodo = await client.todos.create({
      id: todoId,
      text: `Electric todo`,
      completed: false,
      user_id: user.id,
      project_id: project.item.id,
      user_ids: [user.id],
    })

    expect(createdTodo.item.id).toBe(todoId)

    const syncedCreate = await waitFor(
      () => todosShape.currentRows.find((row) => rowId(row) === createdTodo.item.id),
      `Electric todo create`
    )
    expect(syncedCreate.text).toBe(`Electric todo`)
    expect(syncedCreate.user_id).toBe(user.id)

    await client.todos.update({
      id: createdTodo.item.id,
      data: {
        text: `Electric todo updated`,
        completed: true,
      },
    })

    const syncedUpdate = await waitFor(() => {
      const row = todosShape.currentRows.find(
        (todo) => rowId(todo) === createdTodo.item.id
      )
      return row?.text === `Electric todo updated` ? row : undefined
    }, `Electric todo update`)
    expect(syncedUpdate.completed).toBe(true)

    await client.todos.delete({ id: createdTodo.item.id })

    await waitFor(() => {
      const row = todosShape.currentRows.find(
        (todo) => rowId(todo) === createdTodo.item.id
      )
      return row === undefined ? true : undefined
    }, `Electric todo delete`)
  })
})
