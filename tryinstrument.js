import { instrument } from "./instrument/instrument.ts"
import * as fs from "fs"

let fname = process.argv[2]
let fdata = fs.readFileSync(fname)
console.log(instrument(fdata, fname))




