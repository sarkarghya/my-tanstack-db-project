import { createORPCClient } from "@orpc/client"
import { RPCLink } from "@orpc/client/fetch"
import type { RouterClient } from "@orpc/server"
import type { AppRouter } from "@/routes/api/orpc/$"

const link = new RPCLink({
  url: `/api/orpc`,
  fetch(request, init) {
    return globalThis.fetch(request, { ...init, credentials: `include` })
  },
})

export const orpc: RouterClient<AppRouter> = createORPCClient(link)
