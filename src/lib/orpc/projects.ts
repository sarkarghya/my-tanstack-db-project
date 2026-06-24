import { authedProcedure, generateTxId } from "@/lib/orpc"
import { z } from "zod"
import { ORPCError } from "@orpc/server"
import { eq, and } from "drizzle-orm"
import {
  projectsTable,
  createProjectSchema,
  updateProjectSchema,
} from "@/db/schema"

export const projectsRouter = {
  create: authedProcedure
    .input(createProjectSchema)
    .handler(async ({ context, input }) => {
      if (input.owner_id !== context.session.user.id) {
        throw new ORPCError(`FORBIDDEN`, {
          message: `You can only create projects you own`,
        })
      }

      const result = await context.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [newItem] = await tx
          .insert(projectsTable)
          .overridingSystemValue()
          .values(input)
          .returning()
        return { item: newItem, txid }
      })

      return result
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.number(),
        data: updateProjectSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [updatedItem] = await tx
          .update(projectsTable)
          .set(input.data)
          .where(
            and(
              eq(projectsTable.id, input.id),
              eq(projectsTable.owner_id, context.session.user.id)
            )
          )
          .returning()

        if (!updatedItem) {
          throw new ORPCError(`NOT_FOUND`, {
            message: `Project not found or you do not have permission to update it`,
          })
        }

        return { item: updatedItem, txid }
      })

      return result
    }),

  delete: authedProcedure
    .input(z.object({ id: z.number() }))
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [deletedItem] = await tx
          .delete(projectsTable)
          .where(
            and(
              eq(projectsTable.id, input.id),
              eq(projectsTable.owner_id, context.session.user.id)
            )
          )
          .returning()

        if (!deletedItem) {
          throw new ORPCError(`NOT_FOUND`, {
            message: `Project not found or you do not have permission to delete it`,
          })
        }

        return { item: deletedItem, txid }
      })

      return result
    }),
}
