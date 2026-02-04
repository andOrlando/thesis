import { instrument } from "./instrument.ts"
import type { Module } from "node:module"
import { postprocess } from "../postprocess/postprocess.ts"
import { connect_inspector, disconnect_inspector } from "../utils/function_location.ts"
import { ClassTI, FunctionTI } from "../typeinfo/types.ts"

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

process.on("beforeExit", async () => {
  connect_inspector()
  await ClassTI.get_locations()
  await FunctionTI.get_locations()
  disconnect_inspector()
  postprocess(filenames)
})




