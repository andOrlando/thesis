import { Trace, TraceSet, compute_typeinfo, function_typeinfo_map, ObjectTI } from "../typeinfo/types.ts"
import { ObjectFunction, GeneratorFunction } from "../typeinfo/constructor_library.ts"

const inflight: Record<string, Trace> = {}
export const calls: Record<string, TraceSet> = {}

// TODO: actually implement
function shouldprofile(_loc: string): boolean {
  return true
}


function wrap_function(f: Function): Function {
    // if we've already wrapped/are profiling this function, ignore
    if (function_typeinfo_map.has(f)) return f
    
    // at this point we've created the typeinfo so we
    // should already be in the function_typeinfo_map
    const fti = function_typeinfo_map.get(f)!
    const wrapped = function(...args: any[]) {
      fti.trace = new Trace(args)
      const res = f(...args)

      // if we're not a generator just profile the return
      if (typeof res !== "object" || res instanceof GeneratorFunction) {
        fti.trace.returns = compute_typeinfo(res)
        return res
      }

      // otherwise we have to wrap the generator in the same way
      const _next = res.next
      res.next = function(...b: any[]) {
        const next: { value: any, done?: boolean } = _next(...b)
        if (!next.done) fti.trace!.yields.push(compute_typeinfo(next.value))
        else fti.trace!.returns = compute_typeinfo(next.value)
        return next
      }
      return res
    }

    function_typeinfo_map.set(wrapped, fti)
    return wrapped
}

function wrap_object(o: Object, oti: ObjectTI): Object {
  return new Proxy(o, {
    get(t: Object, p: string|symbol, reciever: any) {
      // if oti.params[p]

      
      // oti.params[p] =

      return Reflect.get(t, p, reciever)
    }
  })
}







global.__logarg = function(loc: string, ...args: any[]): [string|undefined, ...any[]] {
  if (!shouldprofile(loc)) return [undefined, ...args]
  
  const callid = crypto.randomUUID()
  inflight[callid] = new Trace(args)

  // wrap all of our arguments as needed
  args = args.map((arg, i) => {
    if (typeof arg === "function") return wrap_function(arg)
    if (typeof arg === "object" && arg !== null) {
      // we wanna wrap objects whose constructor is ``object''
      // TODO: do something about classes
      if (Object.getPrototypeOf(arg).constructor === ObjectFunction) return wrap_object(arg, inflight[called].args[i])
    }
    return arg
  })
  
  return [callid, ...args]
}

global.__logret = function(loc: string, callid: string|undefined, val?: any): any|undefined {
  if (callid === undefined) return val
  
  // bank inflight[callid], cleanup
  inflight[callid].returns = compute_typeinfo(val)
  if (calls[loc] === undefined) calls[loc] = new TraceSet()
  calls[loc].add(inflight[callid])
  delete inflight[callid]

  return val
}

global.__logyield = function(callid: string|undefined, val: any): any {
  if (callid === undefined) return val
  
  inflight[callid].yields.push(compute_typeinfo(val))
  return val
}

// delegated yield, wrap the iterator
global.__logdelyield = function<T>(callid: string|undefined, val: Generator<T>): Generator<T> {
  if (callid === undefined) return val

  const _next = val.next
  val.next = function(...a) {
    const next: { value: T, done?: boolean } = _next(...a)
    if (!next.done) inflight[callid].yields.push(compute_typeinfo(next.value))
    else inflight[callid].returns = compute_typeinfo(next.value)
    return next
  }
  return val
}



