import { TypeInfo, Trace, UnionTI } from "./types.ts"


//TODO: implement
function combine_traces(traces: Trace[]): Trace {
  return traces[0]
}


// TODO: implement
function combine_types(types: TypeInfo[]): TypeInfo {
  if (types.length === 1) return types[0]
  
  return new UnionTI(types)
}





