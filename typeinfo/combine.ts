import { Trace, UnionTI, PrimitiveTI, ArrayTI, GenericTI, ObjectTI, TupleTI, FunctionTI, TraceSet } from "./types.ts"
import type { TypeInfo } from "./types.ts"

const TUPLE_MAX_LENGTH=5

/*
int int [int int]
str int [str str str]

wants to become

int   str   THIS equal
str   str
int[] str[] THIS equal

T int [T, T]
T int [T, T, T]



int str [str, int]
str str [str, str]

wants to become
int str THIS EQUAL
str str
[   [
str str
int str THIS EQUAL
]   ]

T str [str, T]
T str [str, T]


int {name: str, value: int}
str {name: str, value: str}

wants to be come
int         str
{           {
name: str   name: str
value: int  value: str
}           }

T {name: str, value: T}
T {name: str, value: T}


if array is homogenous we treat as T[]
if array is not but all are same length we can expand [str, T]
if we have guarenteed property on object we can expand { name: string, value: T }




https://github.com/RightTyper/RightTyper/blob/main/righttyper/generalize.py
*/


/*
[[[int, int], [int, int]], [[int, int], [int, int]]] sees multiple arrays of uniform type and becomes {type: array, value: [arrayti, arrayti]}
wanna call again for [[int, int, int, int], [int, int, int, int]] to become {type: array, value: [int, int]}

[[int, str], [int, int]] is a tuple, becomes {type: tuple, value: [[int, int], [str, int]]}


*/

function transpose(arr: any[][]) {
  return arr[0].map((_, col) => arr.map(row => row[col]))
}

interface Container {
  container: true,
  type: string,
  value: any
  keys?: (string|symbol)[]
  n?: number
}

// isyield is so we don't try to turn the yield, which we treat as an ArrayTI into a tuple
function abstract_nested_types(tis: TypeInfo[], isyield?: boolean): TypeInfo[] | Container {
  if (tis.length == 0) return tis
  
  // initial checks to disqualify fast
  // can die if we see primitives, if we see both objects and arrays
  let seen_array = false
  let seen_object = false
  for (const ti of tis) {
    if (ti.type !== "array" && ti.type !== "object") return tis
    seen_array = seen_array || ti.type === "array"
    seen_object = seen_object || ti.type === "object"
    if (seen_array && seen_object) return tis
  }

  // TODO: tuple check can be done at the typeinfo level instead of here so we don't need to store large arrays
  // are they tuples
  // criteria for tuples: less than TUPLE_MAX_LENGTH elements, uniform, 
  let is_tuple = true
  let len = -1
  for (const ti of tis) {
    if (ti.type !== "array") {
      is_tuple = false
      break
    }
    if ((ti as ArrayTI).elemtypes.length > TUPLE_MAX_LENGTH
        || (ti as ArrayTI).elemtypes.length == 0
        || isyield) {
        // || tis.length == 1) {
      is_tuple = false
      break
    }
    if (len === -1) len = (ti as ArrayTI).elemtypes.length
    else {
      if ((ti as ArrayTI).elemtypes.length !== len) {
        is_tuple = false
        break
      }
    }
    if (is_tuple) {
      return {
        container: true,
        type: "tuple",
        value: (tis[0] as ArrayTI).elemtypes.map((_, col) => abstract_nested_types((tis as ArrayTI[]).map(row => row.elemtypes[col])))
      }
    }
  }
  
  // are they homogenous lists
  let is_homogenous = true
  for (const ti of tis) {
    if (!(ti instanceof ArrayTI)) {
      is_homogenous = false
      break
    }

    // check if elemtypes are unique
    let elemtypes = new Set(ti.elemtypes.map(a => a.toUnique()))
    
    if (elemtypes.size > 1 || elemtypes.size == 0) {
      is_homogenous = false
      break
    }
    
  }
  if (is_homogenous) {
    return {
      container: true,
      type: "array",
      value: abstract_nested_types((tis as ArrayTI[]).map(a => a.elemtypes[0]))
    }
  }

  // TODO: determine if record in type info somehow
  // is it always the same object
  let is_same = true
  let type_intersection: Set<string|Symbol>|undefined = undefined
  for (const ti of tis) {
    if (ti.type !== "object") {
      is_same = false
      break
    }
    if (type_intersection === undefined) {
      type_intersection = new Set(Reflect.ownKeys((ti as ObjectTI).params))
    }
    else {
      type_intersection = new Set([...Reflect.ownKeys((ti as ObjectTI).params)].filter(a => type_intersection!.has(a)))
    }
    if (type_intersection.size === 0) {
      is_same = false
      break
    }
  }
  
  if (is_same) {
    // inserting keys into this should be a deterministic process
    // so when recreating the traces we should be able to just use the same ordering
    let types: {[key: symbol|string]: TypeInfo[]} = {}
    let keys = new Set<symbol|string>()
    for (const ti of (tis as ObjectTI[])) {
      [...Reflect.ownKeys(ti.params)].forEach(e => keys.add(e))
    }
    keys.forEach(key => types[key] = [])
    let keys_arr = [...keys]
    
    for (const ti of (tis as ObjectTI[])) {
      for (const key of keys_arr) {
        types[key].push(ti.params[key] ?? new PrimitiveTI(undefined))
      }
    }
    
    // TODO: when recursing here we need to check for recursion in the objects
    return {
      container: true,
      type: "object",
      value: Object.entries(types).map(([_key, value]) => abstract_nested_types(value)),
      keys: keys_arr,
      n: tis.length
    }
  }
  
  return tis
}

function deabstract(elem: Container|TypeInfo[]): TypeInfo[] {
  if (!("container" in elem)) return elem

  let res: TypeInfo[]
  switch (elem.type) {
    case "object":
      // if we're empty object just return n empty objects
      if (elem.value.length == 0) return Array.from({length: elem.n!}, () => new ObjectTI({}))
    
      let keys = elem.keys!
      res = []

      for (let i=0; i<elem.n!; i++) {
        let params = {}
        for (let j=0; j<keys.length; j++) {
          params[keys[j]] = deabstract(elem.value[j])[i]
        }
        res.push(new ObjectTI(params))
      }

      return res
    case "tuple":
      res = []

      // we'll never be an empty tuple so we're certain we have at least one value
      // first deabstract values
      let values_deabs = elem.value.map((a: TypeInfo[]) => deabstract(a))
      for (let i=0; i<values_deabs[0].length; i++) {
        res.push(new TupleTI(values_deabs.map((a: TypeInfo[]) => a[i])))
      }

      return res
    case "array":
      return deabstract(elem.value).map((a: TypeInfo) => new ArrayTI([a]))
   
  }
  throw Error("unreachable")
}


function compute_generics(traces: Trace[]): [Trace[], TypeInfo[]] {
  
  let traces_u: TypeInfo[][] = traces.map(trace => [...trace.args, new ArrayTI(trace.yields), trace.returns])

  // add metadata to complex types so we can unrwap
  // each row will either be the traces for a parameter or a container
  // containers represent multiple rows in some manner and will be unrolled in the next step
  let types_abs: (TypeInfo[]|Container)[] = transpose(traces_u).map((elem, i) => abstract_nested_types(elem, i==traces_u[0].length-2))

  // unwrap types_abs
  function unwrap(elem: Container|TypeInfo[]) {
    if (!("container" in elem)) return [elem]
    switch (elem.type) {
      case "object":
      case "tuple":
        return (elem.value as TypeInfo[][]).map(unwrap).flat()
      case "array":
        return unwrap(elem.value)
    }
    throw Error("unreachable")
  }

  let types_simple: TypeInfo[][] = []
  for (const elem of types_abs) {
    types_simple.push(...unwrap(elem))
  }

  // let rows = transpose(types_simple)
  let rows = types_simple

  // compute generics
  // each row is a typeinfo slot that could be a generic
  // any two columns with equivalent rows should be replaced with equivalent generics
  let generics = rows.map(() => -1)
  let generic_index = 0
  let generics_values: TypeInfo[] = []

  for (let i=0; i<rows.length-1; i++) {
    if (generics[i] !== -1) continue
    // if it's just one type don't make it generic
    if (new Set(deabstract(rows[i]).map(a => a.toUnique())).size <= 1) continue
    
    outer:
    for (let j=i+1; j<rows.length; j++) {
      if (generics[j] !== -1) continue
      // check for equality
      for (let k=0; k<rows[i].length; k++) {
        if (rows[i][k].toUnique() !== rows[j][k].toUnique()) {
          continue outer
        }
      }

      // if we find now difference, mark i and j as the same
      if (generics[i] == -1) {
        generics_values.push(new UnionTI(rows[i]))
        generics[i] = generic_index++
      }
      generics[j] = generics[i]
    }
  }
  
  // recombine our generics into types_abs
  let i=0
  function rewrap(elem: Container|TypeInfo[], arr?: any[], j?: number) {
    if (!("container" in elem)) {
      if (generics[i] !== -1) arr![j!] = (arr![j!] as any[]).map(_ => new GenericTI(generics[i]))
      i++
      return
    }

    switch (elem.type) {
      case "object":
      case "tuple":
        elem.value.forEach((e: Container|TypeInfo[], k: number) => rewrap(e, elem.value, k))
        break
      case "array":
        if (!("container" in elem.value)) {
          if (generics[i] !== -1) elem.value = (elem.value as any[]).map(_ => new GenericTI(generics[i]))
          i++
          return
        }

        // otherwise it's some container
        // there isn't actually an array or j we will need to write back to so it's ok to leave blank
        rewrap(elem.value)
        break
    }
  }

  types_abs.forEach((elem, j) => rewrap(elem, types_abs, j))

  // finally we deabstract our types back into traces_u type structure
  let traces_u_g: TypeInfo[][] = transpose(types_abs.map(elem => deabstract(elem)))

  // finally finally we remake our traces
  // second last should be yield, last should be return
  let res = traces.map((trace, i) => {
    let trace_new =  new Trace([], trace.location);
    trace_new.args = traces_u_g[i].slice(0, -2)
    trace_new.yields = (traces_u_g[i][traces_u_g[i].length-2] as ArrayTI).elemtypes
    trace_new.returns = traces_u_g[i][traces_u_g[i].length-1]
    return trace_new
  })

  return [res, generics_values]
  
}



export function combine_traces(traces: Trace[]): [Trace, TypeInfo[]] {

  // do generics
  let generics: TypeInfo[];
  [traces, generics] = compute_generics(traces)
  
  // otherwise try to combine types in a trace
  let result = new Trace([], traces[0].location)
  let maxargs = Math.max(...traces.map(t => t.args.length))

  for (let i=0; i<maxargs; i++) {
    result.args.push(combine_types(traces.map(t => t.args[i] ?? new PrimitiveTI(undefined))))
  }
  // if we have yields, combine them
  if (traces.reduce((sum, a) => sum + a.yields.length, 0) > 0) {
    result.yields.push(combine_types(traces.map(t => combine_types(t.yields))))
  }
  result.returns = combine_types(traces.map(t => t.returns))

  return [result, generics]
}


export function combine_types(types: TypeInfo[]): TypeInfo {
  
  for (const elem of types) {

    // combine functions into one guy
    // TODO: should we only do this if location is the same or not?
    // pros: we could use actual paremeter names for functions
    // cons: it could make things messy, like () => string|() => string|() => string
    if (elem instanceof FunctionTI) {
      let funcs = types.filter(a => a instanceof FunctionTI)

      if (funcs.length <= 1) continue
      
      let max_args = funcs.reduce((acc, func) => Math.max(acc, func.traces.traces[0].args.length), 0)

      let fti = new FunctionTI(new TraceSet())
      for (const func of funcs) {
        for (const trace of func.traces.traces) {
          let trace_copy = Object.assign(Object.create(Object.getPrototypeOf(trace)), trace)
          trace_copy.args = trace_copy.args.concat(Array(max_args-trace_copy.args.length).fill(new PrimitiveTI(undefined)))
          fti.traces.add(trace_copy)
        }
      }
      
      return combine_types([...types.filter(a => !(a instanceof FunctionTI)), fti])
    }

    // combine tuples into one guy
    if (elem instanceof TupleTI) {
      // merge with all other tuples of same length
      let tups = types.filter(a => a instanceof TupleTI && (a as TupleTI).elems.length == elem.elems.length) as TupleTI[]

      // if there's only one with this length we can't combine
      if (tups.length <= 1) continue

      let tup: TypeInfo[] = []
      for (let i=0; i<tups[0].elems.length; i++) {
        tup.push(combine_types(tups.map(a => a.elems[i])))
      }
      
      return combine_types([...types.filter(a => !(a instanceof TupleTI) || a.elems.length != elem.elems.length), new TupleTI(tup)])
    }

    // combine all arrays into one guy
    // TODO: I'm not sure if I should have special cases for this
    // should [int[], str[]] become (int|str)[] or int[]|str[]? depends
    if (elem instanceof ArrayTI) {
      // merge with all other arrays
      let arrs = types.filter(a => a instanceof ArrayTI)

      // if there's only one skip
      if (arrs.length <= 1) continue

      // otherwise we just union everything
      return combine_types([...types.filter(a => !(a instanceof ArrayTI)), new ArrayTI([combine_types(arrs.flatMap(a => a.elemtypes))])])
    }

    // try to combine some objects into one guy
    // this is also naive for now, we will only try to combine if we have some overlap between everything
    if (elem instanceof ObjectTI) {
      let objs = types.filter(a => a instanceof ObjectTI) 

      // if we just got one object skip
      if (objs.length <= 1) continue

      let keyintersect = new Set(Reflect.ownKeys(objs[0].params))
      let keyunion = new Set(keyintersect)
      objs.slice(1).forEach(a => {
        keyintersect = new Set([...Reflect.ownKeys(a.params)].filter(a => keyintersect.has(a)))
        Reflect.ownKeys(a.params).forEach(a => keyunion.add(a))
      })
      
      // if there's no intersection give up
      if (keyintersect.size == 0) continue

      // otherwise we're going to union everything across everything
      // this might be a bit overzelous in combining things so TODO make this better later
      let res = new ObjectTI({})
      for (const key of keyunion) {
        res.params[key] = combine_types(objs.map(obj => obj.params[key] ?? new PrimitiveTI(undefined)))
      }

      return combine_types([...types.filter(a => !(a instanceof ObjectTI)), res])
    }
    
    
  }

  // otherwise first deduplicate primitives
  let seen_uniques = new Set()
  types = types.filter(typ => {
    let u = typ.toUnique()
    if (!seen_uniques.has(u)) {
      seen_uniques.add(u)
      return true
    }
  })

  // then union if we need to union, otherwise just return
  if (types.length > 1) return new UnionTI(types)
  return types[0]
}



