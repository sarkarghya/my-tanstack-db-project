import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { convertSetCookieToCookie } from "better-auth/test"
import { describe, expect, test } from "vitest"
import { db } from "../src/db/connection"
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
  const email = `rpc-regression-${Date.now()}@example.com`
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
  const [{ createORPCClient }, { RPCLink }] = await Promise.all([
    import(`@orpc/client`),
    import(`@orpc/client/fetch`),
  ])
  const client = createORPCClient(
    new RPCLink({
      url: `${baseUrl}/api/orpc`,
      headers: { cookie },
    })
  )

  return client.projects.create({
    name: `Regression ${Date.now()}`,
    description: `auth regression project`,
    owner_id: userId,
    shared_user_ids: [],
  })
}

describe(`RPC auth regression`, () => {
  test(`creates a project with a Better Auth test session`, async () => {
    const { cookie, session, user } = await getBetterAuthTestSession()
    const result = await createProjectWithORPC(cookie, user.id)

    expect(session.session.userId).toBe(user.id)
    expect(result.item.owner_id).toBe(user.id)
    expect(result.item.id).toEqual(expect.any(Number))
    expect(result.txid).toEqual(expect.any(Number))
  })
})
