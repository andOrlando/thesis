
# plan is as follows:
- instrument code with loader
  - only instrument code we want to instrument, find package.json from the entrypoint
- log types of the following
  - all function calls
  - all variable declarations?
    - objects get wrapped in proxies


# how traces are stored
one trace object is one set of types to a function call. ideally we would like to collapse these traces, so we don't have a billion repeates of ``(int, int) -> int`

two ways of doing this
- only store what we see when we enter the function (and maybe when we leave the function so we know if types have been changed)
  - **pros**: simpler, can immediately get types
  - **cons**: may be more difficult to see types added to objects
- keep track of object refs and try to detemrine an exhaustive list of properties
  - **pros**: more exhaustive type checking, should be able to profile functions more easily
  - **cons**: would not be able to collapse traces since we don't necessarily know true types until execution completely finishes

what I might do is keep track of refs for functions but only profile at start and finish for objects. If we're passing a function through we want to know the arguments to the function in the caller as well as the callee so refs are needed

For objects it is probably better not to do this as it would likely suffice to know property types before and after execution. In weird cases we'll need to do type assertions after the fact, but we would have needed to do that anyways. See:
```ts
function dog(o: {a: int|str, b?: int} {
  o.a = o.a.length // needs to become (o.a as string).length
  o.b = 1
})
dog({a: "hi"})
```

Objects can be recursively defined which is bad, I'm not actually sure if you're allowed to have recursive types as inline definitions so we may have to create types in this case.
```js
dog = {} // {}
dog.dog = dog // <ref *1> { dog: [Circular *1] }
```


# how call annotations work
all functions are annotated such that we send args, yields and returns. Args will be sent without destructuring, and the `__logarg` function will also return, if we want to profile the function, a callid generated with `crypto.randomUUID` (since we can't just check call frame equality like in python and we need to konw where the return is coming from)






# TODOS (not written in code)
- literally anything with promises
- profile elements of array destructuring rather than the array itself
- figure out generics
- add types to variables that static analysis can't figure out
  - globals like window
  - initializing a variable to an empty list to get filled in later (defaults to never[])
