import * as acorn from "acorn"
import * as walk from "acorn-walk"
import * as astring from "astring"

function make_expression_body(node: acorn.Function) {
  const exp: acorn.Expression = node.body as acorn.Expression
  node.expression = true;
  node.body = {
    type: "BlockStatement",
    body: [{
      type: "ReturnStatement",
      argument: exp
    } as acorn.ReturnStatement]
  } as acorn.BlockStatement
}

function handle_pattern(param: acorn.Pattern): [string, acorn.Pattern, acorn.VariableDeclaration|undefined] {

  // identifier will be the string identifier we'll replace the argument with
  // this can be undefined iff 
  let identifier: string
  // param_ast will be the 
  let param_ast: acorn.Pattern
  let destructure_ast: acorn.VariableDeclaration|undefined

  switch (param.type) {
    case "ArrayPattern":
    case "ObjectPattern":
      identifier = crypto.randomUUID()
      param_ast = {
        type: "Identifier",
        name: identifier
      } as acorn.Identifier

      // make the destructuring statement
      destructure_ast = {
        type: "VariableDeclaration",
        declarations: [{
          type: "VariableDeclarator",
          id: param,
          init: {
            type: "Identifier",
            name: identifier
          } as acorn.Identifier
        } as acorn.VariableDeclarator],
        kind: "let",
      } as acorn.VariableDeclaration

      break

    case "Identifier":
      identifier = param.name
      param_ast = param
      break

    case "RestElement":
      // if we see an ArrayPattern then it'll suffice to do what we do with ArrayPattern
      let argument: acorn.Pattern
      switch (param.argument.type) {
        // if we see identifier it's totally fine
        case "Identifier":
          identifier = param.argument.name
          argument = param.argument
          break

        // ObjectPattern would result in effectively unusable parameters but it's not incorrect
        // grammar, so it's possible to see dead code that's technically correct. For the sake
        // of consistancy we'll profile it but TODO: could just not keep track of it for marginal
        // performance gains
        // function dog(...{a, b}) // a and b will simply always be undefined
        case "ObjectPattern":
        // if we see ArrayPattern add destructuring code, our argument will be the identifier
        case "ArrayPattern":
          identifier = crypto.randomUUID()
          argument = {
            type: "Identifier",
            name: identifier
          } as acorn.Identifier
          destructure_ast = {
            type: "VariableDeclaration",
            declarations: [{
              type: "VariableDeclarator",
              id: param.argument,
              init: {
                type: "Identifier",
                name: identifier
              } as acorn.Identifier
            } as acorn.VariableDeclarator],
            kind: "let",
          } as acorn.VariableDeclaration
          break

        // these are all impossible gramatically and will throw unreachable
        case "MemberExpression":
        case "RestElement":
        case "AssignmentPattern":
          throw new Error(`incorrect pattern ${param.type} after a RestElement`)
      }

      param_ast = {
        type: "RestElement",
        argument: argument
      } as acorn.RestElement

      break

    case "AssignmentPattern":
      if (param.left.type === "AssignmentPattern") throw new Error("Can't have double assignment")

      let _param_ast: acorn.Pattern
      [identifier, _param_ast, destructure_ast] = handle_pattern(param.left)
      param_ast = {
        type: "AssignmentPattern",
        left: _param_ast,
        right: param.right
      } as acorn.AssignmentPattern
      
      break

    case "MemberExpression":
      throw new Error("unreachable")
  }

  return [identifier, param_ast, destructure_ast]
}

function make_call_expression(logtype: "__logarg"|"__logret"|"__logyield"|"__logdelyield", location: string, ...params: acorn.Expression[]): acorn.CallExpression {
  return {
    type: "CallExpression",
    callee: {
      type: "MemberExpression",
      object: {
        type: "Identifier",
        name: "global"
      } as acorn.Identifier,
      property: {
        type: "Identifier",
        name: logtype
      } as acorn.Identifier,
      computed: false,
      optional: false
    } as acorn.MemberExpression,
    arguments: [
      {
        type: "Literal",
        value: location,
        raw: `"${location}"`
      },
      ...params
    ],
    optional: false
  } as acorn.CallExpression
}


function instrument_body(node: acorn.Function, path: string) {

  // we can make this type assertion because all expressions we've turned into bodies
  if (node.body.type !== "BlockStatement")
    throw new Error("Saw a non-block node type in function body")

  const body: acorn.BlockStatement = node.body
  
  // this will be the final list of parameters that goes into the log
  const params: string[] = []
  // this will be the modified params ast
  const params_ast: acorn.Pattern[] = []

  for (let param of node.params) {

    const [identifier, param_ast, destructure_ast] = handle_pattern(param)

    // add param identifier and ast
    params_ast.push(param_ast)
    params.push(identifier)

    // add destructuring to the body
    if (destructure_ast !== undefined) {
      body.body.unshift(destructure_ast)
    }
  }

  // add initial logging statement
  const location = `${path}:${node.start}`

  node.params = params_ast
  body.body.unshift({
    type: "ExpressionStatement",
    expression: make_call_expression("__logarg", location, ...params.map(name => ({
        type: "Identifier",
        name: name
      } as acorn.Identifier)))
  } as acorn.ExpressionStatement)

  // annotate yields and returns but cease annotating if we see an inner function
  walk.recursive(body, undefined, {
    // do nothing when we see a function
    Function: () => {},

    ReturnStatement(node: acorn.ReturnStatement, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      node.argument = make_call_expression("__logret", location, arg)
    },
    YieldExpression(node: acorn.YieldExpression, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      // we also have delegate, yield* Iterator which we have to handle
      // TODO lol
      node.argument = make_call_expression(node.delegate ? "__logdelyield" : "__logyield", location, arg)
    }
  })
}

export function transform(source: string, path: string): string {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module" })

  walk.simple(ast, {
    Function(node: acorn.Function) {
      // if we have an expression function, give it a body so we can add instrumentation
      if (node.expression) make_expression_body(node)

      // add profiling for args, returns, yeilds
      instrument_body(node, path)
    },
    // AssignmentExpression(node: acorn.AssignmentExpression) {
      // do something
    // }
    
  })
  
  return astring.generate(ast)
}






