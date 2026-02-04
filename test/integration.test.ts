import { describe, it, before, after } from "node:test"
import assert from "node:assert"
import child_process from "node:child_process"
import { OutputMethods } from "../postprocess/postprocess.ts"
import os from "node:os"
import fs from "node:fs"
import dedent from "dedent-js"
import path from "path"

let tmpdir: string|undefined = undefined
function setup() {
  tmpdir = path.join(os.tmpdir(), "thesis")
  fs.rmSync(tmpdir, { recursive: true, force: true })
  fs.mkdirSync(tmpdir)

  // symlink node_modules and package.json
  fs.symlinkSync("./dummy_node_modules", path.join(tmpdir, "node_modules"), "dir")
  fs.symlinkSync("./dummy_package.json", path.join(tmpdir, "package.json"), "dir")
}

function teardown() {
  // unlink and delete
  fs.unlinkSync(path.join(tmpdir!, "node_modules"))
  fs.unlinkSync(path.join(tmpdir!, "package.json"))
  fs.rmSync(tmpdir!, { recursive: true, force: true })
}

function run_self(text: string, ...others: string[]) {
  let path = tmpdir!+"/1.js"
  fs.writeFileSync(path, text)
  
  others.forEach((s, i) => fs.writeFileSync(tmpdir!+`/${i+2}.js`, s))
  
  const child = child_process.spawnSync(process.execPath, ["--import=code/entry", path], { env: {
    OUTPUT: OutputMethods.PRINT
  }})
  return [child.stdout.toString(), child.stderr.toString()]
}


describe("basic integration tests", () => {

  before(setup)
  after(teardown)
  
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

  before(setup)
  after(teardown)
  
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

  before(setup)
  after(teardown)
    
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

  before(setup)
  after(teardown)
  
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

  before(setup)
  after(teardown)

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
  
  it("should type import used classes", () => {
    let [out, _] = run_self(dedent(`
    import { f } from "./2.js";
    class Dog{};
    f(new Dog());`), 
    "export function f(a) { return a; }")
    
    assert.equal(out.split("\n").slice(6, -2).join("\n"), dedent(`
    import type { Dog } from "./1.js";

    export function f(a: Dog): Dog { return a; }`))
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








