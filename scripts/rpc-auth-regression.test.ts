import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { convertSetCookieToCookie } from "better-auth/test"
import { eq } from "drizzle-orm"
import { describe, expect, test } from "vitest"
import { db } from "../src/db/connection"
import { projectsTable, todosTable } from "../src/db/schema"
import * as schema from "../src/db/auth-schema"

const baseUrl = process.env.APP_BASE_URL ?? `http://localhost:42071`

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
  const email = `rpc-regression-${Date.now()}-${crypto.randomUUID()}@example.com`
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

  return { cookie, session, user: session.user }
}

async function createProjectWithORPC(cookie: string, userId: string) {
  const client = await createRPCClient(cookie)
  const id = createClientId()

  return client.projects.create({
    id,
    name: `Regression ${Date.now()}`,
    description: `auth regression project`,
    owner_id: userId,
    shared_user_ids: [],
  })
}

async function createRPCClient(cookie?: string) {
  const [{ createORPCClient }, { RPCLink }] = await Promise.all([
    import(`@orpc/client`),
    import(`@orpc/client/fetch`),
  ])

  return createORPCClient(
    new RPCLink({
      url: `${baseUrl}/api/orpc`,
      headers: cookie ? { cookie } : undefined,
    })
  )
}

async function expectORPCError(promise: Promise<unknown>, code: string) {
  try {
    await promise
  } catch (error) {
    expect(error).toMatchObject({ code })
    return
  }

  throw new Error(`Expected oRPC error ${code}`)
}

function createClientId() {
  return Math.floor(1_000_000_000 + Math.random() * 1_000_000_000)
}

describe(`RPC auth regression`, () => {
  test(`rejects unauthenticated mutations`, async () => {
    const client = await createRPCClient()

    await expectORPCError(
      client.projects.create({
        name: `Unauthorized`,
        description: `no session`,
        owner_id: `not-a-user`,
        shared_user_ids: [],
      }),
      `UNAUTHORIZED`
    )
  })

  test(`rejects mismatched project ownership`, async () => {
    const { cookie } = await getBetterAuthTestSession()
    const client = await createRPCClient(cookie)

    await expectORPCError(
      client.projects.create({
        name: `Forbidden`,
        description: `wrong owner`,
        owner_id: `not-the-session-user`,
        shared_user_ids: [],
      }),
      `FORBIDDEN`
    )
  })

  test(`creates, updates, and deletes a project with a Better Auth test session`, async () => {
    const { cookie, session, user } = await getBetterAuthTestSession()
    const client = await createRPCClient(cookie)
    const result = await createProjectWithORPC(cookie, user.id)

    expect(session.session.userId).toBe(user.id)
    expect(result.item.owner_id).toBe(user.id)
    expect(result.item.id).toEqual(expect.any(Number))
    expect(result.txid).toEqual(expect.any(Number))

    const [created] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, result.item.id))
    expect(created?.name).toBe(result.item.name)

    const updated = await client.projects.update({
      id: result.item.id,
      data: {
        name: `Updated project`,
        description: `updated description`,
        shared_user_ids: [user.id],
      },
    })

    expect(updated.item.name).toBe(`Updated project`)
    expect(updated.item.description).toBe(`updated description`)
    expect(updated.item.shared_user_ids).toEqual([user.id])

    const deleted = await client.projects.delete({ id: result.item.id })
    expect(deleted.item.id).toBe(result.item.id)

    const rowsAfterDelete = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, result.item.id))
    expect(rowsAfterDelete).toHaveLength(0)
  })

  test(`creates, updates, and deletes todos with a Better Auth test session`, async () => {
    const { cookie, user } = await getBetterAuthTestSession()
    const client = await createRPCClient(cookie)
    const project = await createProjectWithORPC(cookie, user.id)

    const createdTodo = await client.todos.create({
      id: createClientId(),
      text: `Regression todo`,
      completed: false,
      user_id: user.id,
      project_id: project.item.id,
      user_ids: [user.id],
    })

    expect(createdTodo.item.user_id).toBe(user.id)
    expect(createdTodo.item.project_id).toBe(project.item.id)

    const [todoRow] = await db
      .select()
      .from(todosTable)
      .where(eq(todosTable.id, createdTodo.item.id))
    expect(todoRow?.text).toBe(`Regression todo`)

    const updatedTodo = await client.todos.update({
      id: createdTodo.item.id,
      data: {
        text: `Updated todo`,
        completed: true,
      },
    })

    expect(updatedTodo.item.text).toBe(`Updated todo`)
    expect(updatedTodo.item.completed).toBe(true)

    const deletedTodo = await client.todos.delete({ id: createdTodo.item.id })
    expect(deletedTodo.item.id).toBe(createdTodo.item.id)

    const todosAfterDelete = await db
      .select()
      .from(todosTable)
      .where(eq(todosTable.id, createdTodo.item.id))
    expect(todosAfterDelete).toHaveLength(0)
  })
})
