import ts from "typescript"

import { locate } from "../utils/function_location.ts"
import type { Location } from "../utils/function_location.ts"
import { ObjectFunction } from "./constructor_library.ts"
import { combine_traces, combine_types } from "./combine.ts"
import { calls, funcref_trace_map, objref_objti_map } from "../instrument/trace.ts"

// references linked to a FunctionTI
export const function_typeinfo_map: WeakMap<Function, FunctionTI> = new WeakMap()

// property id for wrapping
export const WRAP_PARAMID = crypto.randomUUID()

export function compute_typeinfo(t: any, refs?: WeakMap<any, TypeInfo>): TypeInfo {
  if (refs === undefined) refs = new WeakMap()
  switch (typeof t) {
    case "object":
      // null is a primitive even though it's an object
      if (t === null) return new PrimitiveTI(null)
      // if we've seen this reference before, make it circular
      if (refs.has(t)) return refs.get(t)!
      
      // TODO: add cases for array, class, object without class, primitive classes vs. imported, etc 
      // determine if there's a more specific case of object we can use or if it's just an object
      // if Array.isArray we're an array
      if (Array.isArray(t)) return new ArrayTI(t, refs)

      // if we have a constructor in the protype this is our class
      if (Object.getPrototypeOf(t).constructor !== ObjectFunction) return new ClassTI(t)
      
      return new ObjectTI(t, refs)
    case "function":
      return new FunctionRefTI(t)
    default:
      return new PrimitiveTI(t)
  }
}

export interface TypeInfo {
  type: string
  toUnique: () => string
  // toAst: () => ts.TypeNode
  toTypeString: (indentation: string, level: number) => string
}

export class PrimitiveTI implements TypeInfo {
  type: string
  constructor(t: string|number|bigint|boolean|undefined|symbol|null) {
    this.type = typeof t
    // typeof null === "object" so we need to have this case
    if (t === null) this.type = "null"
  }
  toUnique() {
    return this.type
  }
  toAst() {
    let kind: number
    switch (this.type) {
      case "string":
        kind = ts.SyntaxKind.StringKeyword
        break
      case "number":
        kind = ts.SyntaxKind.NumberKeyword
        break
      case "bigint":
        kind = ts.SyntaxKind.BigIntKeyword
        break
      case "boolean":
        kind = ts.SyntaxKind.BooleanKeyword
        break
      case "undefined":
        kind = ts.SyntaxKind.UndefinedKeyword
        break
      case "symbol":
        throw new Error("TODO: what's the kind for a symbol")
      case "null":
        kind = ts.SyntaxKind.NullKeyword
        break
      default:
        throw new Error("unreachable")
    }

    return ts.factory.createKeywordTypeNode(kind)
  }
  toTypeString() {
    return this.type
  }
}
export class FunctionRefTI implements TypeInfo {
  type: "functionref"
  ref: Function
  constructor(t: Function) {
    this.type = "functionref"
    this.ref = t
    if (!function_typeinfo_map.has(t)) {
      function_typeinfo_map.set(t, new FunctionTI(t))
    }
  }
  get location() {
    return function_typeinfo_map.get(this.ref)!.location
  }
  get traces() {
    return function_typeinfo_map.get(this.ref)!.traces
  }
  get uuid() {
    return function_typeinfo_map.get(this.ref)!.uuid
  }
  toUnique() {
    return this.uuid
  }
  toTypeString(text: string, level: number) {
    return function_typeinfo_map.get(this.ref)!.toTypeString(text, level)
  }
}
export class FunctionTI implements TypeInfo {
  // TODO: it's probably bad to have this as a promise
  // not sure yet how to resolve the async
  location_promise: Promise<void>
  location: Location|undefined
  traces: TraceSet
  uuid: string
  type: "function"
  constructor(t: Function) {
    this.type = "function"
    this.uuid = crypto.randomUUID()

    // if we're passed a wrapped function, unwrap it
    while (t.hasOwnProperty(WRAP_PARAMID)) {
      t = t[WRAP_PARAMID] as Function
    }

    // if this function has already been profiled by us, use the one traceset
    // if it has not, it's still possilbe that it's profiled in the future, so add to the map
    if (funcref_trace_map.has(t)) {
      this.traces = funcref_trace_map.get(t)!
    } else {
      this.traces = new TraceSet()
      funcref_trace_map.set(t, this.traces)
    }
    
    this.location_promise = new Promise(async resolve => {
      this.location = await locate(t)
      resolve()
    })
  }
  toUnique() {
    return this.uuid
  }
  toTypeString(text: string, level: number) {
    
    // if it hasn't been called, just return Function
    if (this.traces.size === 0) return "Function"
    
    // TODO: determine param names from location and do stuff with that
    if (this.location !== undefined) {}

    let trace = combine_traces(this.traces.traces)
    let params = trace.args.map(a => a.toTypeString(text, level))
      .map((a, i) => `p${i}: ${a}`)
      .join(", ")

    // TODO: handle yields
    let returns = trace.returns.toTypeString(text, level)
    return `(${params}) => ${returns}`
  }
}

export class ObjectTI implements TypeInfo {
  params: Map<string|symbol, TypeInfo>
  type: "object"
  constructor(t: Object, refs: WeakMap<any, TypeInfo>) {
    if (objref_objti_map.has(t)) return objref_objti_map.get(t)!
    objref_objti_map.set(t, this)
    
    this.type = "object"
    this.params = new Map()

    refs.set(t, this)
    for (const key of Object.keys(t)) {
      this.params.set(key, compute_typeinfo(t[key], refs))
    }
  }
  
  // we can cache tostring because these are effectively frozen
  #string_cached?: string
  toUnique() {
    if (this.#string_cached !== undefined) return this.#string_cached
    
    // first DFS through child objects to determine if ciruclar
    // then compute string iwth <ref> and [Circular] like how console.log does it

    const seen = new WeakSet()
    const repeated: ObjectTI[] = []
    function visit(obj: ObjectTI) {
      if (seen.has(obj) && !repeated.includes(obj)) {
        repeated.push(obj)
        return
      }
      seen.add(obj)
      for (const child of obj.params.values()) {
        if (!(child instanceof ObjectTI)) continue
        visit(child)
      }
    }
    visit(this)
    
    // construct the string, knowing the reference indices from `repeated`
    // Since we're DFSing the first time we see a ref it should be the <ref *i>
    // and all future times should be children annotated with [Circular *i]
    const seen2: WeakSet<ObjectTI> = new WeakSet([this])

    // arrow function because we need to preserve `this`
    const _toUnique = (obj: ObjectTI) => {
      const params: string[] = []
      for (const key of obj.params.keys()) {
        const value = obj.params.get(key)!
        if (!(value instanceof ObjectTI)) {
          params.push(`${String(key)}:${value.toUnique()}`)
          continue
        }

        // if this isn't circular we're good
        let idx = repeated.indexOf(value)
        if (idx === -1) {
          params.push(`${String(key)}:${_toUnique(value)}`)
        }
        
        // if it is circular and it's the first time we're seeing this, <ref *i>
        else if (!seen2.has(value)) {
          seen2.add(value)
          params.push(`${String(key)}:<ref *${idx}>${_toUnique(value)}`)
        }

        // otherwise we're circular
        else {
          params.push(`${String(key)}:<Circular *${idx}>`)
        }
      }

      let res = `{${params.join(",")}}`
      let idx = repeated.indexOf(this)
      if (idx !== -1) res = `<ref *${idx}>${res}`
      return res
    }
    
    this.#string_cached = _toUnique(this)
    return this.#string_cached
  }

  toTypeString(text: string, level: number) {
    let seen = new WeakSet<Object>()
    function _toTypeString(node: ObjectTI, level: number) {
      // if it's cyclic just put Object
      if (node.type !== "object") return node.toTypeString(text, 0)
      if (seen.has(node)) return "Object"
      seen.add(node)

      // otherwise we can do it as normal
      // threshold for readability is >4 params or any param is >40 characters
      // TODO: make this an option

      let types: Record<string|symbol, string> = {}
      let questionmark: (string|symbol)[] = []
      for (const key of node.params.keys()) {
        // if we have an object that's undefined|something then we do some extra special stuff
        let typ = node.params.get(key)
        if (typ instanceof UnionTI && typ.types.types.some(t => t.type === "undefined")) {
          typ = new UnionTI(typ.types.types.filter(t => t.type !== "undefined"))
          questionmark.push(key)
        }
        
        types[key] = typ!.toTypeString(text, level)
      }

      function compute_keystring(key: string): string {
        let res = key.match(/^[a-zA-Z_$]\w*$/) ? key : `"${key}"`
        res = questionmark.includes(key) ? `${res}?` : res
        return res
      }

      // TODO: print keys in order that they're seen in destructuring?
      let keys = Object.keys(types)
      if (keys.some(a => a.length > 40) || keys.length > 4) {
        // we need to indent which in practice means line breaking with \n+\t*level after the first open bracket until the last close bracket, which gets \n+\t*(level-1)
        return Object.entries(types).map(([key, value]: [string, string], i) => {
          // indent everything below
          value = value.split("\n").map(a => text.repeat(level+1)+a).join("\n")
          // write the properties
          let res = "\n" + text.repeat(level+1) + `${compute_keystring(key)}: ${value}`
          // last guy also has to include the next line for the closing bracket
          if (i == keys.length-1) res = res + "\n" + text.repeat(level)
          return res
        }).join("")
      }

      return `{ ${Object.entries(types).map(([key, value]) => `${compute_keystring(key)}: ${value}`).join(", ")} }`
    }
    return _toTypeString(this, level)
  }


  
}

// TODO: not finished
export class ArrayTI implements TypeInfo {
  elemtypes: TypeInfo[]
  type: "array"
  constructor(t: any[], refs: WeakMap<any, TypeInfo>) {
    this.type = "array"
    this.elemtypes = t.map(a => compute_typeinfo(a, refs))
  }
  toUnique() {
    return `(${this.elemtypes.map(a => a.toUnique()).join("|")})[]`
  }
  toTypeString(text: string, level: number) {
    let type = combine_types(this.elemtypes)
    if (type instanceof ArrayTI || type instanceof PrimitiveTI) return `${type.toTypeString(text, level)}[]`
    return `(${type.toTypeString(text, level)})[]`
  }
}

// special case of ObjectTI where we accumulate with respect to
// the function hash in a WeakMap, similar to what we do for functions
// TODO: add type params
// TODO: somehow tell thing to import it and generate .ts.d if not existing
export class ClassTI implements TypeInfo {
  location: Promise<Location|undefined>
  name: string
  type: "class"
  constructor(t: Object) {
    this.type = "class"
    this.location = locate(Object.getPrototypeOf(t).constructor)
    this.name = t.constructor.name
  }
  toUnique() {
    return this.toString()
  }
  toAst() {
    return ts.factory.createTypeReferenceNode(this.name, [])
  }
  toTypeString() {
    // TODO: we also have to import this name
    return this.name
  }
}



export class UnionTI implements TypeInfo {
  types: TypeInfoSet
  type: "union"
  constructor(types: TypeInfo[]) {
    this.type = "union"
    this.types = new TypeInfoSet()
    types.forEach(t => this.types.add(t))
  }
  toUnique() {
    return [...this.types.typeset].join("|")
  }
  toTypeString(text: string, level: number) {
    return this.types.types.map(a => a.toTypeString(text, level)).join("|")
  }
}




export class Trace {
  args: TypeInfo[]
  yields: TypeInfo[]
  returns: TypeInfo
  constructor(args: any[]) {
    // TODO: can we do this computation in a worker thread so collecting traces isn't blocking
    this.args = args.map(a => compute_typeinfo(a))
    this.yields = []
    this.returns = new PrimitiveTI(undefined)
  }
  toUnique() {
    return `[${this.args.map(a => a.toUnique()).join(",")}],[${this.yields.map(a => a.toUnique()).join(",")}],${this.returns.toUnique()}`
  }
}

export class TraceSet {
  traces: Trace[]
  traceset: Set<string>
  size: number

  constructor() {
    this.traces = []
    this.traceset = new Set()
    this.size = 0
  }

  add(trace: Trace) {
    const trace_s = trace.toUnique()
    if (this.traceset.has(trace_s)) return
    this.traceset.add(trace_s)
    this.traces.push(trace)
    this.size++
  }

  has(trace: Trace) {
    return this.traceset.has(trace.toUnique())
  }
}


export class TypeInfoSet {
  types: TypeInfo[]
  typeset: Set<string>
  constructor() {
    this.types = []
    this.typeset = new Set()
  }
  add(type: TypeInfo) {
    const type_s = type.toUnique()
    if (this.typeset.has(type_s)) return
    this.typeset.add(type_s)
    this.types.push(type)
  }
  remove(type: TypeInfo) {
    const type_s = type.toUnique()
    if (!this.typeset.has(type_s)) return
    this.typeset.delete(type_s)
    this.types = this.types.filter(a => a.toUnique() !== type_s)
  }
  has(type: TypeInfo) {
    return this.typeset.has(type.toUnique())
  }
}





