import * as acorn from "acorn"
import * as walk from "acorn-walk"
import * as astring from "astring"


const uuid_underscore = () => {
  let s = crypto.randomUUID().replace(/-/g, "_")
  return "a"+s.substring(1)
}

function add_let_to_closest_body(ancestors, name) {
  const declaration = {
    type: 'VariableDeclaration',
    kind: 'let',
    declarations: [{
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name },
      init: null
    }]
  };

  // Walk ancestors from innermost to outermost
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const node = ancestors[i];

    // Program and BlockStatement have a `body` that is an array of statements
    if (node.type === 'Program' || node.type === 'BlockStatement') {
      node.body.unshift(declaration);
      return node;
    }

    // A function with a block body — its `.body` is the BlockStatement
    if (
      (node.type === 'FunctionDeclaration' ||
       node.type === 'FunctionExpression' ||
       node.type === 'ArrowFunctionExpression') &&
      node.body.type === 'BlockStatement'
    ) {
      node.body.body.unshift(declaration);
      return node.body;
    }

    // StaticBlock (class static { }) also has a statement-array body
    if (node.type === 'StaticBlock') {
      node.body.unshift(declaration);
      return node;
    }
  }

  return null; // nothing suitable found
}

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

function name_anonymous_function(node: acorn.ArrowFunctionExpression | acorn.FunctionExpression): [string, acorn.AssignmentExpression] {
  let uuid = uuid_underscore()

  return [uuid, {
      type: "AssignmentExpression",
      operator: "=",
      left: {
        type: "Identifier",
        name: uuid
      } as acorn.Identifier,
      right: node
    } as acorn.AssignmentExpression]
  // return [uuid, {
  //   type: "ExpressionStatement",
  //   expression: {
  //     type: "AssignmentExpression",
  //     operator: "=",
  //     left: {
  //       type: "Identifier",
  //       name: uuid
  //     } as acorn.Identifier,
  //     right: node
  //   } as acorn.AssignmentExpression
  // } as acorn.ExpressionStatement]
  
}

function make_call_expression(logtype: "__logarg"|"__logret"|"__logyield"|"__logdelyield", params: acorn.Expression[]): acorn.CallExpression {
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
    arguments: params,
    optional: false
  } as acorn.CallExpression
}


// node is function to instrument
// path is filepath, used in logging
// self? is the expression we pass into logging to get the function object
// location_num? is for member expresisons, we might have a different location
function instrument_body(node: acorn.Function, path: string, self?: acorn.Expression, location_num?: number) {

  // we can make this type assertion because all expressions we've turned into bodies
  if (node.body.type !== "BlockStatement")
    throw new Error("Saw a non-block node type in function body")

  const body: acorn.BlockStatement = node.body
  const location = `${path}:${location_num === undefined ? node.start : location_num}`
  
  const uuids = node.params.map(uuid_underscore)
  const callid_varname = uuid_underscore()

  // if we're not explicitly given a self, we can just assume we're in
  // a normal function with a name
  let self_expr = self || {
    type: "Identifier",
    name: node.id!.name
  } as acorn.Identifier
  
  
  // we need to handle array destructures seperately because we want to know
  // 1. the types of all the named variables
  // 2. the types of all the rest of the array, if it exists
  // so we need to pass in everything to logarg
  // 
  // function dog([[a, b], ...c]) {}
  // becomes
  // function dog(<uuid>) {
  //   let [[<uuid1>, <uuid2>, ...<uuid3>], ...<uuid4>] = <uuid>
  //   let [[{ a, b }, b], c] = __logarg(<uuid1>, <uuid2>, <uuid3>, <uuid4>)
  // }
  const uuids_expanded: string[] = []
  function visit_arrays(p: acorn.ArrayPattern, uuids: string[]): acorn.ArrayPattern {
    let elems: (acorn.ArrayPattern | acorn.Identifier | acorn.RestElement)[] = []
    for (const elem of p.elements) {
      if (elem == null) continue
      if (elem.type === "ArrayPattern") elems.push(visit_arrays(elem, uuids))
      else {
        let uuid = uuid_underscore()
        uuids.push(uuid)
        elems.push({
          type: "Identifier",
          name: uuid
        } as acorn.Identifier)
      }
    }
    // if the last one isn't a rest element we have to append a made-up rest element
    // we'll have to take this into account when processing the destructured array as well
    if (p.elements.length > 0 && p.elements[p.elements.length-1]?.type != "RestElement") {
      let uuid = uuid_underscore()
      uuids.push(uuid)
      elems.push({
        type: "RestElement",
        argument: {
          type: "Identifier",
          name: uuid
        } as acorn.Identifier
      } as acorn.RestElement)
    }

    return {
      type: "ArrayPattern",
      elements: elems
    } as acorn.ArrayPattern
  }
  
  let destructure_assignments = node.params.map((param, i) => {
    if (param.type !== "ArrayPattern") {
      uuids_expanded.push(uuids[i])
      return
    }

    // push to body a destructure statement and construct our uuids_expanded
    let assignee = visit_arrays(param, uuids_expanded)

    // add an assignment to the body, left = uuid
    return {
      type: "VariableDeclaration",
      declarations: [
        {
          type: "VariableDeclarator",
          id: assignee,
          init: {
            type: "Identifier",
            name: uuids[i]
          } as acorn.Identifier
        } as acorn.VariableDeclarator
      ],
      kind: "let",
    } as acorn.VariableDeclaration
  })

  // add the destructuring statements to the body
  // those are the let [[<uuid1>, <uuid2>, ...<uuid3>], ...<uuid4>] = <uuid>
  
  // destructure patterns should have the original patterns
  // this is the part that goes on the left half of the assignment, in [param1, param2]
  const destructure_patterns: acorn.Pattern[] = node.params.map(a => {
    if (a.type == "AssignmentPattern") return a.left
    return a
  })
  
  // right hand of the assignment, __logarg(...uuids)
  // we want to expand the uuids of array destructures
  body.body.unshift({
    type: "VariableDeclaration",
    kind: "let",
    declarations: [{
      type: "VariableDeclarator",
      id: {
        type: "ArrayPattern",
        elements: [
          {
            type: "Identifier",
            name: callid_varname
          } as acorn.Identifier,
          ...destructure_patterns
        ]
      } as acorn.ArrayPattern,
      init: make_call_expression("__logarg", [
        {
          type: "Literal",
          value: location,
          raw: `"${location}"`
        } as acorn.Literal,
        ...uuids_expanded.map(a => ({ type: "Identifier", name: a } as acorn.Identifier))
      ])
    } as acorn.VariableDeclarator]
  } as acorn.VariableDeclaration)

  destructure_assignments.forEach(a => a ? body.body.unshift(a) : undefined)

  // update the params
  node.params = node.params.map((a, i) => {
    if (a.type == "AssignmentPattern") return {
      type: "AssignmentPattern",
      left: {
        type: "Identifier",
        name: uuids[i]
      } as acorn.Identifier,
      right: a.right
    } as acorn.AssignmentPattern

    return {
      type: "Identifier",
      name: uuids[i]
    } as acorn.Identifier
  })
  
  // annotate yields and returns but cease annotating if we see an inner function
  walk.recursive(body, undefined, {
    // do nothing when we see a function
    Function: () => {},

    ReturnStatement(node: acorn.ReturnStatement, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      node.argument = make_call_expression("__logret", [
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        self_expr,
        arg
      ])
    },
    YieldExpression(node: acorn.YieldExpression, _state, _callback) {
      const arg = node.argument ?? {
        type: "Identifier",
        name: "undefined"
      } as acorn.Identifier
      // we also have delegate, yield* Iterator which we have to handle
      // TODO lol
      node.argument = make_call_expression(node.delegate ? "__logdelyield" : "__logyield", [
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        arg
      ])
    }
  })

  // if the last element of the body isn't a return statement, add one
  // this could be unreachable if there's an exhaustive branch but this doesn't add much overhead
  if (body.body[body.body.length-1].type !== "ReturnStatement") {
    body.body.push({
      type: "ReturnStatement",
      argument: make_call_expression("__logret", [
        {
          type: "Identifier",
          name: callid_varname,
        } as acorn.Identifier,
        self_expr,
        {
          type: "Identifier",
          name: "undefined"
        } as acorn.Identifier,
      ])
    } as acorn.ReturnStatement)
  }
}

export function instrument(source: string, path: string): string {
  let ast
  try {
    ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "module", locations: true })
  } catch {
    console.log("--------------------DIED-------------------\n", path, "\n", source, "\n")
  }

  walk.ancestor(ast, {
    Function(node: any, _state, ancestors) {
      if (node.__instrumented) return;
      // if we have an expression function, give it a body so we can add instrumentation
      if (node.expression) make_expression_body(node)

      // if it's a class method use `this.whatever` or `this[expression]`
      // if it's a getter we have to use Object.getOwnPropertyDescriptor(Object.getPrototype(this), "name").get
      // 
      // for methods we have to specify method_def.start as the location rather than just node.start since
      // tsmorph includes the get/set in the node, whereas acorn does not
      // if (ancestors.length > 1 && ancestors[ancestors.length-2].type == "Property"
      //     || ancestors[ancestors.length-2].type == "PropertyDefinition"){
      if (ancestors.length > 1 && ancestors[ancestors.length-2].type == "MethodDefinition") {
        let method_def = ancestors[ancestors.length-2] as acorn.MethodDefinition
        let funcref: acorn.Expression | undefined

        if (method_def.key.type == "PrivateIdentifier") {
          // if we have a private getter/setter it's impossible to get the function reference
          funcref = { type: "Identifier", name: "undefined" } as acorn.Identifier
        }
        else if (method_def.kind == "get" || method_def.kind == "set") {
          // if we have a public getter/setter we can get the funcref via the prototype
          // This code literally only matters in the case of someone passing a getter/setter function
          // into another function
          funcref = {
            type: "CallExpression",
            callee: {
              type: "MemberExpression",
              object: { type: "Identifier", name: "Object" } as acorn.Identifier,
              property: { type: "Identifier", name: "getOwnPropertyDescriptor"} as acorn.Identifier,
              computed: false,
              optional: false
            } as acorn.MemberExpression,
            arguments: [
              {
                type: "CallExpression",
                callee: {
                  type: "MemberExpression",
                  object: { type: "Identifier", name: "Object" } as acorn.Identifier,
                  property: { type: "Identifier", name: "getPrototypeOf"} as acorn.Identifier,
                  computed: false,
                  optional: false
                } as acorn.MemberExpression,
                arguments: [{ type: "ThisExpression"}]
              } as acorn.CallExpression,

              method_def.key.type == "Identifier" ?
                { type: "Literal", value: method_def.key.name, raw: `"${method_def.key.name}"`, } as acorn.Literal :
                method_def.key
            ] 

          } as acorn.CallExpression
        }
        else {
          // in a normal case we can just use `this.whatever` or `this["whatever"]`
          funcref = {
            type: "MemberExpression",
            object: { type: "ThisExpression" } as acorn.ThisExpression,
            property: method_def.key,
            computed: method_def.key.type != "Identifier",
            optional: false
          } as acorn.MemberExpression
        }

        instrument_body(node, path, funcref, method_def.start)
        return
      }
      
      // if we have an arrow function, give it a name inline as an expression
      else if (node.type == "ArrowFunctionExpression" || node.type == "FunctionExpression") {
        if (node.__instrumented) return;

        let node_copy = {...node}
        node_copy.__instrumented = true;

        let [uuid, expression] = name_anonymous_function(node_copy)
        add_let_to_closest_body(ancestors.slice(0, -1), uuid)

        for (const key in node) delete node[key]
        for (const key in expression) node[key] = expression[key]
        node.__instrumented = true;

        instrument_body(node_copy, path, {
          type: "Identifier",
          name: uuid
        } as acorn.Identifier)
        return
      }
      // else if (node.type == "ArrowFunctionExpression" || node.type == "FunctionExpression") {
        
      //   let node_copy = {...node}
      //   let [uuid, expression] = name_anonymous_function(node_copy as (acorn.ArrowFunctionExpression|acorn.FunctionExpression))
      //   // names.push(uuid)
      //   add_let_to_closest_body(ancestors.slice(0, -1), uuid)

      //   // we have to some pretty type unsafe stuff where we modify inplace the contents of node
      //   for (const key in node) delete node[key]

      //   // now we reconstruct node as an expression
      //   for (const key in expression) node[key] = expression[key]

      //   // finally we can instrument the body of the node copy
      //   instrument_body(node_copy, path, {
      //     type: "Identifier",
      //     name: uuid
      //   } as acorn.Identifier)
      //   return
      // }

      // if we `export function` we need to use the start of the export instead
      if (ancestors.length > 1 && ancestors[ancestors.length-2].type == "ExportNamedDeclaration") {
        instrument_body(node, path, undefined, ancestors[ancestors.length-2].start)
        return
      }
      
      // in normal case we can just instrument the body normally
      instrument_body(node, path)
    },
    // AssignmentExpression(node: acorn.AssignmentExpression) {
      // profile assignments too?
    // }
    
  })
  
  // console.dir(ast, {depth: null})
  // return astring.generate(ast)
  // console.log(ast)


  // Insert at the top of the program body
  // TODO: this should be done at the nearest block, not top of the file
  // if (names.length > 0) {
  //   ast.body.unshift({
  //     type: 'VariableDeclaration',
  //     kind: 'let',
  //     declarations: names.map(name => ({
  //       type: 'VariableDeclarator',
  //       id: { type: 'Identifier', name },
  //       init: null
  //     }))
  //   });
  // }

  let res = astring.generate(ast)
  // console.log(res)
  return res
}






