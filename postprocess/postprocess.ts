// import { transform } from "./transform.ts"
import { transform } from "./transform_tsmorph.ts"

export const OutputMethods = {
  PRINT: "print",
  DIFF: "diff",
  WRITE: "write",
  COPY: "copy",
}

export function postprocess(filenames: string[]) {
  
  // TODO: wait for all location promises to resolve, become async
  
  const output = process.env.OUTPUT ?? OutputMethods.PRINT
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
      throw Error("TODO: write to original spot")
    case OutputMethods.COPY:
      throw Error("TODO: copy to new directory somewhere")
    default:
      throw Error("unreachable")
  }
}





