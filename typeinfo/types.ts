import locate from "../utils/function_location.ts"
import type { Location } from "../utils/function_location.ts"

// references linked to a FunctionTI
export const function_typeinfo_map: WeakMap<Function, FunctionTI> = new WeakMap()

// object constructor
const ObjectFunction = Object.getPrototypeOf({}).constructor

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
  toString: () => string
}

export class PrimitiveTI implements TypeInfo {
  type: string
  constructor(t: string|number|bigint|boolean|undefined|symbol|null) {
    this.type = typeof t
    // typeof null === "object" so we need to have this case
    if (t === null) this.type = "null"
  }
  toString() {
    return this.type
  }
}
export class FunctionRefTI implements TypeInfo {
  type: "functionref"
  ref: Function
  constructor(t: Function) {
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
  toString() {
    return this.uuid
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
    this.uuid = crypto.randomUUID()
    this.location = locate(t)
  }
  toString() {
    return this.uuid
  }
}

export class ObjectTI implements TypeInfo {
  params: Map<string, TypeInfo>
  type: string
  constructor(t: Object, refs: WeakMap<any, TypeInfo>) {
    this.type = typeof t
    this.params = new Map()

    refs.set(t, this)
    for (const key of Object.keys(t)) {
      this.params.set(key, compute_typeinfo(t[key], refs))
    }
  }
  
  // we can cache tostring because these are effectively frozen
  #string_cached?: string
  toString() {
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
    const _toString = (obj: ObjectTI) => {
      const params: string[] = []
      for (const key of obj.params.keys()) {
        const value = obj.params.get(key)!
        if (!(value instanceof ObjectTI)) {
          params.push(`${key}:${value}`)
          continue
        }

        // if this isn't circular we're good
        let idx = repeated.indexOf(value)
        if (idx === -1) {
          params.push(`${key}:${_toString(value)}`)
        }
        
        // if it is circular and it's the first time we're seeing this, <ref *i>
        else if (!seen2.has(value)) {
          seen2.add(value)
          params.push(`${key}:<ref *${idx}>${_toString(value)}`)
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
    
    this.#string_cached = _toString(this)
    return this.#string_cached
  }


  combine(o: ObjectTI): TypeInfo {
    // if we can determine that either this or the others' properties are a subset
    // then we can combine into one thing, types still have to match for a subset



    
    return this
  }


  
}

// TODO: not finished
export class ArrayTI implements TypeInfo {
  type: "array"
  elemtypes: TypeInfo[]
  constructor(t: any[], refs: WeakMap<any, TypeInfo>) {
    this.elemtypes = t.map(a => compute_typeinfo(a, refs))
  }
}

// special case of ObjectTI where we accumulate with respect to
// the function hash in a WeakMap, similar to what we do for functions
// TODO: not finished
export class ClassTI implements TypeInfo {
  type: "class"
  location: Promise<Location|undefined>
  constructor(t: Object) {
    this.location = locate(Object.getPrototypeOf(t).constructor)
  }
}



export class UnionTI implements TypeInfo {
  types: TypeInfo[]
  type: "union"
  constructor(types: TypeInfo[]) {
    this.types = types
  }
  toString() {
    return this.types.join("|")
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
  toString() {
    return `[${this.args.join(",")}],[${this.yields.join(",")}],${this.returns}`
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
    const trace_s = trace.toString()
    if (this.traceset.has(trace_s)) return
    this.traceset.add(trace_s)
    this.traces.push(trace)
  }

  has(trace: Trace) {
    return this.traceset.has(trace.toString())
  }
}







