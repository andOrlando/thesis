import { describe, it } from "node:test"
import assert from "node:assert"
import { transform } from "../transform/transform_acorn.ts"
import dedent from "dedent-js"


describe("transform_acorn", () => {
  it("should instrument function definitions", () => {
    const res = transform("function dog() { return 'dog' }", "file")

    // should see log for arg and ret
    assert.equal(res.trim(), dedent(`
    function dog() {
      global.__logarg("file:0");
      return global.__logret("file:0", 'dog');
    }`))
  })

  it("should instrument nested functions correctly", () => {
    const res = transform(dedent(`
    function dog() {
      function dog2() {
        return "dog2";
      }
      return dog2();
    }`), "file")

  assert.equal(res.trim(), dedent(`
    function dog() {
      global.__logarg("file:0");
      function dog2() {
        global.__logarg("file:19");
        return global.__logret("file:19", "dog2");
      }
      return global.__logret("file:0", dog2());
    }`))
  })

  it("should instrument for multiple arguments", () => {
    const res = transform("function dog(a, b) { return a + b }", "file")
    assert.equal(res.trim(), dedent(`
    function dog(a, b) {
      global.__logarg("file:0", a, b);
      return global.__logret("file:0", a + b);
    }
    `))
  })

  it("should handle array destructuring", () => {
    const res = transform("function dog([a, b]) {}", "file")

    // should look like
    // function dog(UUID) {
    //   global.__logarg("file:0", UUID)
    //   let [a, b] = UUID
    // }
    assert.match(res, /function dog\([-\w\d]{36}\)\s+\{[\s\S]*let \[a, b\] = [-\w\d]{36};\s+\}/)
  })
  it("should handle object destructuring", () => {
    const res = transform("function dog({a, b}) {}", "file")

    // should look like
    // function dog(UUID) {
    //   global.__logarg("file:0", UUID)
    //   let {a, b} = UUID
    // }
    assert.match(res, /function dog\([-\w\d]{36}\)\s+\{[\s\S]*let \{a, b\} = [-\w\d]{36};\s+\}/)
  })
  it("should handle assignment", () => {
    const res = transform("function dog(a = 5) {}", "file")
    assert.match(res, /function dog\(a = 5\)\s+\{[\s\S]*\}/)
    
  })

  it("should handle assignment with non-identifiers", () => {
    const res = transform("function dog({a, b} = {a: 5, b: 5}) {}", "file")
    assert.match(res, /function dog\([-\w\d]{36} = {\s*a: 5,\s*b: 5\s*}\)\s+\{[\s\S]*let \{a, b\} = [-\w\d]{36};\s+\}/)
  })

  it("should handle expression functions", () => {
    const res = transform("dog = () => 'dog'", "file")
    assert.equal(res.trim(), dedent(`
    dog = () => {
      global.__logarg("file:6");
      return global.__logret("file:6", 'dog');
    };`))
  })

  it("should handle yeilds", () => {
    const res = transform("function* dog() { yield 5 }", "file")
    assert.equal(res.trim(), dedent(`
    function* dog() {
      global.__logarg("file:0");
      yield global.__logyield("file:0", 5);
    }`))
  })

  it("should handle delegate yields", () => {
    const res = transform("function* dog() { yield* [5] }", "file")
    assert.equal(res.trim(), dedent(`
    function* dog() {
      global.__logarg("file:0");
      yield* global.__logdelyield("file:0", [5]);
    }`))
  })
})
