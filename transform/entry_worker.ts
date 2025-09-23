// https://nodejs.org/api/module.html#customization-hooks

import { register } from "node:module"
register("./load_worker.ts", import.meta.url)


