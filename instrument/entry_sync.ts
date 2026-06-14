import { registerHooks } from "node:module"
import { instrument } from "./instrument.ts"
import "./trace.ts"
import { postprocess } from "../postprocess/postprocess.ts"
import { connect_inspector, disconnect_inspector } from "../utils/function_location.ts"
import { ClassTI, FunctionTI } from "../typeinfo/types.ts"

// https://nodejs.org/api/module.html#customization-hooks

// https://nodejs.org/api/module.html#loadurl-context-nextload
// https://nodejs.org/api/module.html#synchronous-hooks-accepted-by-moduleregisterhooks
const filenames: string[] = []
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)

    // only care about code
    // if (typeof loaded.format !== "string" || !(["commonjs", "commonjs-typescript", "module", "module-typescript"].includes(loaded.format)))
    if (!((["commonjs", "module", undefined] as (string|null|undefined)[]).includes(loaded.format))) {
      return loaded
    }

    // no node_modules
    if (url.includes("node_modules")) return loaded

    // no tests
    if (/\/(tests?|__tests__|spec)\//.test(url)) return loaded
    if (/\/(test|tests)\.(?:js|ts)$/.test(url)) return loaded
    if (/[-.](?:test|spec)\.[jt]s$/.test(url)) return loaded
    if (/test262/.test(url)) return loaded
    if (/\/test-[^/]+\.[jt]s$/.test(url)) return loaded
    if (/\.test-d\.ts$/.test(url)) return loaded

    
    let fname = url.substring(7)
    loaded.source = instrument(String(loaded.source), fname)
    filenames.push(fname)

    return loaded
  }
})

process.on("beforeExit", async () => {
  await connect_inspector()
  await ClassTI.get_locations()
  await FunctionTI.get_locations()
  disconnect_inspector()
  postprocess(filenames)
})



