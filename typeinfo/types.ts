import ts from "typescript"

import { locate } from "../utils/function_location.ts"
import type { Location } from "../utils/function_location.ts"
import { ObjectFunction } from "./constructor_library.ts"
import { combine_types } from "./combine.ts"

// references linked to a FunctionTI
export const function_typeinfo_map: WeakMap<Function, FunctionTI> = new WeakMap()


export function compute_typeinfo(t: any, refs?: WeakMap<any, TypeInfo>) {
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
  toAst: () => ts.TypeNode
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
  get trace() {
    return function_typeinfo_map.get(this.ref)!.trace
  }
  get uuid() {
    return function_typeinfo_map.get(this.ref)!.uuid
  }
  toUnique() {
    return this.uuid
  }
  toAst() {
    return function_typeinfo_map.get(this.ref)!.toAst()
  }
}
export class FunctionTI implements TypeInfo {
  // TODO: it's probably bad to have this as a promise
  // not sure yet how to resolve the async
  location: Promise<Location|undefined>
  trace?: Trace
  uuid: string
  type: "function"
  constructor(t: Function) {
    this.type = "function"
    this.uuid = crypto.randomUUID()
    this.location = locate(t)
  }
  toUnique() {
    return this.uuid
  }
  toAst() {
    
    throw new Error("TODO: implement")
    return ts.factory.createFunctionTypeNode(undefined, [], ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword))
  }
}

export class ObjectTI implements TypeInfo {
  params: Map<string, TypeInfo>
  type: "object"
  constructor(t: Object, refs: WeakMap<any, TypeInfo>) {
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
          params.push(`${key}:${value.toUnique()}`)
          continue
        }

        // if this isn't circular we're good
        let idx = repeated.indexOf(value)
        if (idx === -1) {
          params.push(`${key}:${_toUnique(value)}`)
        }
        
        // if it is circular and it's the first time we're seeing this, <ref *i>
        else if (!seen2.has(value)) {
          seen2.add(value)
          params.push(`${key}:<ref *${idx}>${_toUnique(value)}`)
        }

        // otherwise we're circular
        else {
          params.push(`${key}:<Circular *${idx}>`)
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

  toAst() {

    let seen = new WeakSet<Object>()
    function _toAst(node: ObjectTI) {
      return ts.factory.createTypeLiteralNode([...node.params.entries()].map(([key, valueti]: [string, TypeInfo]): ts.TypeElement => {
        if (valueti instanceof ObjectTI) {
          if (seen.has(valueti)) return ts.factory.createPropertySignature(undefined, key, undefined, ts.factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword))
          seen.add(valueti)
          return ts.factory.createPropertySignature(undefined, key, undefined, _toAst(valueti))
        }
        
        return ts.factory.createPropertySignature(undefined, key, undefined, valueti.toAst())
      }))
    }

    return _toAst(this)
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
  toAst() {
    return ts.factory.createArrayTypeNode(combine_types(this.elemtypes).toAst())
  }
}

// special case of ObjectTI where we accumulate with respect to
// the function hash in a WeakMap, similar to what we do for functions
// TODO: not finished
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
  toAst() {
    return ts.factory.createUnionTypeNode(this.types.types.map(a => a.toAst()))
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

  constructor() {
    this.traces = []
    this.traceset = new Set()
  }

  add(trace: Trace) {
    const trace_s = trace.toUnique()
    if (this.traceset.has(trace_s)) return
    this.traceset.add(trace_s)
    this.traces.push(trace)
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





