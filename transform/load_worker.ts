import { transform } from "./transform_acorn.ts"
import type { Module } from "node:module"

export async function load(
  url: string,
  context: Module.LoadHookContext,
  nextLoad: (url: string, context?: Partial<Module.LoadHookContext>) => Promise<Module.LoadFnOutput>): Promise<Module.LoadFnOutput>
{
  const loaded = await nextLoad(url, context)
  let { format, source } = loaded

  // only care about code
  if (typeof format !== "string" || !(["commonjs", "commonjs-typescript", "module", "module-typescript"].includes(format)))
    return loaded

  // no node_modules
  if (url.includes("node_modules")) return loaded

  source = transform(String(source))

  return loaded
}






