import { authedProcedure, generateTxId } from "@/lib/orpc"
import { z } from "zod"
import { ORPCError } from "@orpc/server"
import { eq, and, arrayContains } from "drizzle-orm"
import { todosTable, createTodoSchema, updateTodoSchema } from "@/db/schema"

export const todosRouter = {
  create: authedProcedure
    .input(createTodoSchema)
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [newItem] = await tx
          .insert(todosTable)
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
        data: updateTodoSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const result = await context.db.transaction(async (tx) => {
        const txid = await generateTxId(tx)
        const [updatedItem] = await tx
          .update(todosTable)
          .set(input.data)
          .where(
            and(
              eq(todosTable.id, input.id),
              arrayContains(todosTable.user_ids, [context.session.user.id])
            )
          )
          .returning()

        if (!updatedItem) {
          throw new ORPCError(`NOT_FOUND`, {
            message: `Todo not found or you do not have permission to update it`,
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
          .delete(todosTable)
          .where(
            and(
              eq(todosTable.id, input.id),
              arrayContains(todosTable.user_ids, [context.session.user.id])
            )
          )
          .returning()

        if (!deletedItem) {
          throw new ORPCError(`NOT_FOUND`, {
            message: `Todo not found or you do not have permission to delete it`,
          })
        }

        return { item: deletedItem, txid }
      })

      return result
    }),
}
