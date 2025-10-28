import { describe, it } from "node:test"
import assert from "node:assert"
import child_process from "node:child_process"
import { OutputMethods } from "../postprocess/postprocess.ts"
import os from "node:os"
import fs from "node:fs"
import dedent from "dedent-js"

function run_self(text: string) {
  let path = os.tmpdir()+"/test.js"
  fs.writeFileSync(path, text)
  
  const child = child_process.spawnSync(process.execPath, ["--import=code/entry", path], { env: {
    OUTPUT: OutputMethods.PRINT
  }})
  return [child.stdout.toString(), child.stderr.toString()]
}

function run_tsc(file: string) {
  
}

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

  it("should handle generators", () => {
    let [out, _] = run_self(dedent(`
    function* f() { yield 3; return "hi" }
    for (const a of f()) {}
    `))

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
    for (const a of f()) {}
    `))

    assert.equal(out.split("\n")[1], `function* f(): Generator<number> { yield* [1, 2, 3] }`)
  })
  
})








