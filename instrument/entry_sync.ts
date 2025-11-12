import { registerHooks } from "node:module"
import { instrument } from "./instrument.ts"
import "./trace.ts"
import { postprocess } from "../postprocess/postprocess.ts"
import { connect_inspector, disconnect_inspector } from "../utils/function_location.ts"

// https://nodejs.org/api/module.html#customization-hooks

// https://nodejs.org/api/module.html#loadurl-context-nextload
// https://nodejs.org/api/module.html#synchronous-hooks-accepted-by-moduleregisterhooks
const filenames: string[] = []
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context)

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
})

connect_inspector()
process.on("beforeExit", () => {
  postprocess(filenames)
  disconnect_inspector()
})



