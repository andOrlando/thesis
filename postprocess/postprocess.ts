// import { transform } from "./transform.ts"
import { transform } from "./transform.ts"
import { writeFileSync, mkdirSync } from "fs"
import * as path from "path"

export const OutputMethods = {
  PRINT: "print",
  DIFF: "diff",
  WRITE: "write",
  COPY: "copy",
}

function commonBasePath(filenames: string[]): string {
  if (filenames.length === 0) return ""
  // Work with directories, not full paths — we don't want a common prefix
  // that slices into the middle of a filename.
  const dirs = filenames.map(f => path.dirname(path.resolve(f)).split(path.sep))
  const first = dirs[0]
  let i = 0
  while (i < first.length && dirs.every(d => d[i] === first[i])) i++
  return first.slice(0, i).join(path.sep) || path.sep
}


export function postprocess(filenames: string[]) {
  
  const output = process.env.OUTPUT ?? OutputMethods.PRINT
  const copy_dir: string = process.env.COPY_DIR ?? ""
  if (!Object.values(OutputMethods).includes(output)) throw Error("invalid output type")

  let transformed = filenames.map(a => transform(a))
  switch (output) {
    case OutputMethods.PRINT:
      for (let i=0; i<filenames.length; i++) {
        console.log(filenames[i])
        console.log(transformed[i])
        console.log("---")
      }
      break
    case OutputMethods.DIFF:
      throw Error("TODO: print diff")
    case OutputMethods.WRITE:
      for (let i=0; i<filenames.length; i++) {
        let newname = filenames[i].replace(/(.*)\..*/, "$1.ts")
        // console.log(`writing ${newname}`)
        writeFileSync(newname, transformed[i])
      }
      // console.log("done")
      break
    case OutputMethods.COPY:
      if (!copy_dir) throw Error("COPY_DIR env var must be set when OUTPUT=copy")
      const base = commonBasePath(filenames)
      for (let i = 0; i < filenames.length; i++) {
        const abs = path.resolve(filenames[i])
        const rel = path.relative(base, abs)
        const renamed = rel.replace(/(.*)\..*/, "$1.ts")
        const dest = path.join(copy_dir, renamed)
        mkdirSync(path.dirname(dest), { recursive: true })
        console.log(`writing ${dest}`)
        writeFileSync(dest, transformed[i])
      }
      console.log("done")
      break
    default:
      throw Error("unreachable")
  }
}





