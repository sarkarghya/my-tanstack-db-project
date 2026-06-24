import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"
import { caddyPlugin } from "./src/vite-plugin-caddy"

// Use aws-lambda preset for SST deployments (CI), otherwise use default for local dev
const nitroPreset = process.env.CI ? `aws-lambda` : undefined

const config = defineConfig({
  plugins: [
    devtools(),
    nitro({
      preset: nitroPreset,
      awsLambda: {
        streaming: true,
      },
    }),
    caddyPlugin(),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: [`@tanstack/start-server-core`],
  },
  ssr: {
    noExternal: [`zod`, `drizzle-orm`],
  },
})

export default config
