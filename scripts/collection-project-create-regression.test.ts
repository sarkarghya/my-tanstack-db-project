import { Shape, ShapeStream, type Row } from "@electric-sql/client"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { convertSetCookieToCookie } from "better-auth/test"
import { eq } from "drizzle-orm"
import { afterEach, describe, expect, test, vi } from "vitest"
import { db } from "../src/db/connection"
import { projectsTable } from "../src/db/schema"
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
  const email = `collection-regression-${Date.now()}-${crypto.randomUUID()}@example.com`
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

function createClientId() {
  return Math.floor(1_000_000_000 + Math.random() * 1_000_000_000)
}

function installBrowserFetchShim(cookie: string) {
  vi.stubGlobal(`window`, { location: { origin: baseUrl } })

  const realFetch = globalThis.fetch.bind(globalThis)

  vi.stubGlobal(`fetch`, (input: RequestInfo | URL, init?: RequestInit) => {
    let requestInput = input
    let requestInit = init

    if (typeof input === `string` && input.startsWith(`/`)) {
      requestInput = `${baseUrl}${input}`
    } else if (input instanceof Request && input.url.startsWith(`/`)) {
      requestInput = new Request(`${baseUrl}${input.url}`, input)
    }

    const url =
      typeof requestInput === `string`
        ? requestInput
        : requestInput instanceof URL
          ? requestInput.toString()
          : requestInput.url

    if (url.startsWith(baseUrl)) {
      const headers = new Headers(
        requestInput instanceof Request ? requestInput.headers : requestInit?.headers
      )
      headers.set(`cookie`, cookie)
      requestInit = { ...requestInit, headers }
    }

    return realFetch(requestInput, requestInit)
  })
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

afterEach(() => {
  vi.unstubAllGlobals()

  for (const abortController of abortControllers.splice(0)) {
    abortController.abort()
  }
})

describe(`collection project create regression`, () => {
  test(`persists a project through projectCollection.insert`, async () => {
    const { cookie, user } = await getBetterAuthTestSession()
    installBrowserFetchShim(cookie)

    const { projectCollection } = await import(`../src/lib/collections`)
    const projectsShape = await createShape<Row>(`/api/projects`, cookie)
    const projectId = createClientId()
    const tx = projectCollection.insert({
      id: projectId,
      name: `Collection project`,
      description: `created through collection`,
      owner_id: user.id,
      shared_user_ids: [],
      created_at: new Date(),
    })

    await tx.isPersisted.promise

    const [created] = await db
      .select()
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
    expect(created?.owner_id).toBe(user.id)

    const syncedProject = await waitFor(
      () => projectsShape.currentRows.find((row) => Number(row.id) === projectId),
      `collection project create sync`
    )
    expect(syncedProject.name).toBe(`Collection project`)
  }, 20_000)
})
