import { authedProcedure } from "@/lib/orpc"
import { z } from "zod"
import { ORPCError } from "@orpc/server"

export const usersRouter = {
  create: authedProcedure.input(z.any()).handler(async () => {
    throw new ORPCError(`FORBIDDEN`, {
      message: `Can't create new users through API`,
    })
  }),

  update: authedProcedure
    .input(z.object({ id: z.string(), data: z.any() }))
    .handler(async () => {
      throw new ORPCError(`FORBIDDEN`, {
        message: `Can't edit users through API`,
      })
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string() }))
    .handler(async () => {
      throw new ORPCError(`FORBIDDEN`, {
        message: `Can't delete users through API`,
      })
    }),
}
