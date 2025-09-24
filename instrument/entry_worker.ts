// https://nodejs.org/api/module.html#customization-hooks

import { register } from "node:module"
import "./instrument.ts"
register("./load_worker.ts", import.meta.url)


