import { registerHooks } from "node:module"
import { instrument, filenames } from "./instrument.ts"
import "./trace.ts"

// https://nodejs.org/api/module.html#customization-hooks

// https://nodejs.org/api/module.html#loadurl-context-nextload
// https://nodejs.org/api/module.html#synchronous-hooks-accepted-by-moduleregisterhooks
registerHooks({
  load(url, context, nextLoad) {
    console.log(url)
    const loaded = nextLoad(url, context)

    // only care about code
    if (typeof loaded.format !== "string" || !(["commonjs", "commonjs-typescript", "module", "module-typescript"].includes(loaded.format)))
      return loaded

    // no node_modules
    if (url.includes("node_modules")) return loaded
    
    loaded.source = instrument(String(loaded.source), url.substring(7))

    return loaded
  }
})

import { transform } from "../transform/transform.ts"
process.on("beforeExit", () => {
  filenames.forEach(a => transform(a))
})



