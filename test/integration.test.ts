import { describe, it } from "node:test"
import assert from "node:assert"
import child_process from "node:child_process"
import { OutputMethods } from "../postprocess/postprocess.ts"
import os from "node:os"
import fs from "node:fs"
import dedent from "dedent-js"

function run_self(text: string, ...others: string[]) {
  let tmp = os.tmpdir()
  let path = tmp+"/1.js"
  fs.writeFileSync(path, text)
  
  others.forEach((s, i) => fs.writeFileSync(tmp+`/${i+2}.js`, s))
  
  const child = child_process.spawnSync(process.execPath, ["--import=code/entry", path], { env: {
    OUTPUT: OutputMethods.PRINT
  }})
  return [child.stdout.toString(), child.stderr.toString()]
}

// function run_tsc(file: string) {
// }

describe("basic integration tests", () => {
  it("should handle primitives", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return }
    f(1)`))

    assert.equal(out.split("\n")[1], "function f(a: number) { return }")
  })
  it("should handle objects", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return }
    f({a: 1})`))
    
    assert.equal(out.split("\n")[1], "function f(a: { a: number }) { return }")
  })

  it("should handle unions", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return }
    f(1);
    f("a")`))

    assert.equal(out.split("\n")[1], "function f(a: number|string) { return }")
  })

  it("should handle arrays", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return }
    f([1, 2, 3])`))

    assert.equal(out.split("\n")[1], "function f(a: number[]) { return }")
  })

})
describe("integration tests for iterators", () => {
  
  it("should handle generators", () => {
    let [out, _] = run_self(dedent(`
    function* f() { yield 3; return "hi" }
    for (const a of f()) {}`))

    assert.equal(out.split("\n")[1], `function* f(): Generator<number, string> { yield 3; return "hi" }`)
  })

  it("should handle generators without returns", () => {
    let [out, _] = run_self(dedent(`
    function* f() { yield 3 }
    for (const a of f()) {}
    `))

    assert.equal(out.split("\n")[1], `function* f(): Generator<number> { yield 3 }`)
  })

  it("should handle delegated generators", () => {
    let [out, _] = run_self(dedent(`
    function* f() { yield* [1, 2, 3] }
    for (const a of f()) {}`))

    assert.equal(out.split("\n")[1], `function* f(): Generator<number> { yield* [1, 2, 3] }`)
  })

})

describe("integration tests for higher order functions", () => {

  it("should handle functions", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { a("hi") }
    function g(s) { return s }
    f(g)`))

    assert.equal(out.split("\n")[1], `function f(a: (p0: string) => string) { a("hi") }`)
    assert.equal(out.split("\n")[2], `function g(s: string): string { return s }`)
  })


  it("should handle functions 2", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { a("hi") }
    function g(s) { return s }
    g("hi")
    f(g)`))

    assert.equal(out.split("\n")[1], `function f(a: (p0: string) => string) { a("hi") }`)
    assert.equal(out.split("\n")[2], `function g(s: string): string { return s }`)
  })
  
})
  
describe("integration tests for objects", () => {
  
  it("should handle easy objects", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return a }
    f({a: 1})`))

    assert.equal(out.split("\n")[1], `function f(a: { a: number }): { a: number } { return a }`)
  })

  it("should handle objects with assignment", () => {
    let [out, _] = run_self(dedent(`
    function f(a) {
      a.b = 1
      return a
    }
    f({a: 1})`))

    assert.equal(out.split("\n").slice(1, -2).join("\n"), dedent(`
    function f(a: { a: number, b?: number }): { a: number, b?: number } {
      a.b = 1
      return a
    }
    f({a: 1})`))
  })

})

describe("integration tests for classes", () => {
set 
  it("should handle simple builtin classes", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return a }
    f(new Date())
    `))

    assert.equal(out.split("\n")[1], `function f(a: Date): Date { return a }`)
  })

  it("should handle builtin classes with generics", {skip: true}, () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return a }
    let dog = new Set()
    dog.add(5)
    f(dog)`))

    assert.equal(out.split("\n")[1], "function f(a: Set<number>): Set<number> { return a }")
  })

  it("should handle classes", () => {
    let [out, _] = run_self(dedent(`
    function f(a) { return a }

    class Dog {}
    f(new Dog())`))

    assert.equal(out.split("\n")[1], "function f(a: Dog): Dog { return a }")
  })
  
  it("should type import used classes", {skip: true}, () => {
    let [out, _] = run_self(dedent(`
    import { f } from "./2.js"
    class Dog{}
    f(new Dog())`), 
    "export function f(a) { return a }")
    
    console.log(out)
    dedent(`
    type import { Dog } from "./1.js"
    function f(a: Dog): Dog { return a }`)
    assert.fail()
  })
  
  it("should annotate constructors", () => {
    let [out, _] = run_self(dedent(`
    class Dog {
      fetch(s) { return s }
    }
    (new Dog()).fetch("stick")`))

    assert.equal(out.split("\n")[2], "  fetch(s: string): string { return s }")
  })


  it("should annotate methods", () => {
    let [out, _] = run_self(dedent(`
    class Dog {
      fetch(s) { return s }
    }
    (new Dog()).fetch("stick")`))

    assert.equal(out.split("\n")[2], "  fetch(s: string): string { return s }")
  })

  
  it("should annotate getters", () => {
    let [out, _] = run_self(dedent(`
    class Dog {
      get bark() { return "woof" }
    }
    (new Dog()).bark`))

    assert.equal(out.split("\n")[2], `  get bark(): string { return "woof" }`)
    
  })


  it("should annotate setters", () => {
    let [out, _] = run_self(dedent(`
    class Dog {
      set bark(s) {}
    }
    (new Dog()).bark = "woof"`))

    assert.equal(out.split("\n")[2], "  set bark(s: string) {}")
    
  })

  
  it("should annotate parameters", () => {
    
  })

 
})








