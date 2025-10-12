import { instrument } from "./instrument.ts"
import type { Module } from "node:module"

export async function load(
  url: string,
  context: Module.LoadHookContext,
  nextLoad: (url: string, context?: Partial<Module.LoadHookContext>) => Promise<Module.LoadFnOutput>): Promise<Module.LoadFnOutput>
{
  const loaded = await nextLoad(url, context)

  // only care about code
  if (typeof loaded.format !== "string" || !(["commonjs", "commonjs-typescript", "module", "module-typescript"].includes(loaded.format)))
    return loaded

  // no node_modules
  if (url.includes("node_modules")) return loaded

  loaded.source = instrument(String(loaded.source), url.substring(7))

  return loaded
}






