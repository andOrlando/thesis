


function* f() {
  yield* [1, 2, 3]
}

for (const a of f()) { console.log(a) }
