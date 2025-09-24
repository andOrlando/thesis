type Call = {
  loc: string
  args: any[]
}
type Return = {
  loc: string
  val?: any
}
type Yeild = {
  loc: string
  val: any
}

const calls: Record<string, Set<string[]>> = {}
const returns: Record<string, Set<string>> = {}
const yields: Record<string, Set<string>> = {}

// TODO: actually implement
function compute_type(a: any): string {
  return typeof a
}

// TODO: actually implement
function shouldprofile(_loc: string): boolean {
  return true
}

global.__logarg = function(loc: string, ...args: any[]) {
  if (!shouldprofile(loc)) return
  
  if (calls[loc] === undefined) calls[loc] = new Set()
  calls[loc].add(args.map(compute_type))
}

global.__logret = function(loc: string, val?: any): any|undefined {
  if (!shouldprofile(loc)) return val
  
  if (returns[loc] === undefined) returns[loc] = new Set()
  returns[loc].add(compute_type(val))
  return val
}

global.__logyield = function(loc: string, val: any): any {
  if (!shouldprofile(loc)) return val
  
  if (yields[loc] === undefined) yields[loc] = new Set()
  yields[loc].add(compute_type(val))
  return val
}

// delegated yield, watch what gets yielded
global.__logdelyield = function<T>(loc: string, val: Iterator<T>): Iterator<T> {
  const oldnext = val.next
  val.next = () => {
    const res = oldnext()
    if (yields[loc] === undefined) yields[loc] = new Set()
    yields[loc].add(compute_type(res.value))
    return res
  }
  return val
}

process.on("beforeExit", () => {
  // can schedule async tasks if I feel like it
  console.log(calls)
  console.log(returns)
  console.log(yields)
})
