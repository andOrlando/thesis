import { Trace, UnionTI, PrimitiveTI } from "./types.ts"
import type { TypeInfo } from "./types.ts"


//TODO: implement
export function combine_traces(traces: Trace[]): Trace {
  // TODO: do generics
  
  // otherwise try to combine types in a trace
  let result = new Trace([])
  let maxargs = Math.max(...traces.map(t => t.args.length))

  for (let i=0; i<maxargs; i++) {
    result.args.push(combine_types(traces.map(t => t.args[i] ?? new PrimitiveTI(undefined))))
  }
  // if we have yields, combine them
  if (traces.reduce((sum, a) => sum + a.yields.length, 0) > 0) {
    result.yields.push(combine_types(traces.map(t => combine_types(t.yields))))
  }
  result.returns = combine_types(traces.map(t => t.returns))

  return result
}


// TODO: implement
export function combine_types(types: TypeInfo[]): TypeInfo {
  if (types.length == 0) return new PrimitiveTI(undefined)
  let first = types[0].toUnique()
  if (types.every(a => first === a.toUnique())) return types[0]
  
  let union_types: TypeInfo[] = []
  types.forEach(t => {
    if (t instanceof UnionTI) union_types.concat(t.types.types)
    else union_types.push(t)
  })

  return new UnionTI(union_types)
}





