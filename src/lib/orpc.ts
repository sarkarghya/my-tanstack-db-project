import { ORPCError, os } from "@orpc/server"
import { auth } from "@/lib/auth"
import { db } from "@/db/connection"
import { sql } from "drizzle-orm"

export type Context = {
  session: Awaited<ReturnType<typeof auth.api.getSession>>
  db: typeof db
}

const o = os.$context<Context>()

export const procedure = o

export const isAuthed = o.middleware(async ({ context, next }) => {
  if (!context.session?.user) {
    throw new ORPCError(`UNAUTHORIZED`)
  }

  return next({
    context: {
      ...context,
      session: { ...context.session, user: context.session.user },
    },
  })
})

export const authedProcedure = procedure.use(isAuthed)

// Helper function to generate transaction ID for Electric sync
export async function generateTxId(
  tx: Parameters<
    // eslint-disable-next-line quotes
    Parameters<typeof import("@/db/connection").db.transaction>[0]
  >[0]
): Promise<number> {
  // The ::xid cast strips off the epoch, giving you the raw 32-bit value
  // that matches what PostgreSQL sends in logical replication streams
  // (and then exposed through Electric which we'll match against
  // in the client).
  const result = await tx.execute(
    sql`SELECT pg_current_xact_id()::xid::text as txid`
  )
  const txid = result.rows[0]?.txid

  if (txid === undefined) {
    throw new Error(`Failed to get transaction ID`)
  }

  return parseInt(txid as string, 10)
}
