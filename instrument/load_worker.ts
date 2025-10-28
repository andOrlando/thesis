import { instrument } from "./instrument.ts"
import type { Module } from "node:module"
import { postprocess } from "../postprocess/postprocess.ts"

const filenames: string[] = []
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

  let fname = url.substring(7)
  loaded.source = instrument(String(loaded.source), fname)
  filenames.push(fname)

  return loaded
}

process.on("beforeExit", () => {
  postprocess(filenames)
})




