import fs from "node:fs"
import * as path from "path"
import { Project, Node } from "ts-morph"
import { ClassTI } from "../typeinfo/types.ts"
import { combine_traces, combine_types } from "../typeinfo/combine.ts"
import { calls } from "../instrument/trace.ts"
import { add_imports } from "./imports.ts"

export function transform(filename: string) {
  const project = new Project()
  const source = project.createSourceFile(filename, fs.readFileSync(filename).toString(), {overwrite: true})
  const indentation = source.getIndentationText()
  const imports: Map<string, Set<string>> = new Map()

  const node_location_map: WeakMap<Node, string> = new WeakMap()

  // get locations before we do any transforms
  source.forEachDescendant((node, _traversal) => {
    if (!(
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    )) return

    node_location_map.set(node, `${filename}:${node.getStart(true)}`)
  })

  let generic_offset = 0
  function visit(node: Node) {
    // if not a function skip
    if (!(
      Node.isFunctionDeclaration(node) ||
      Node.isFunctionExpression(node) ||
      Node.isArrowFunction(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    )) {
      node.forEachChild(visit)
      return
    }

    const location = node_location_map.get(node)
    if (location === undefined || calls[location] === undefined) return node // we haven't annotated
    let [trace, generics] = combine_traces(calls[location].traces)
    let level = node.getIndentationLevel();
    let ctx = { indentation, level, generic_offset, n_generics: generics.length }

    // add all class types to imports if need be
    for (const ti of [...trace.args, trace.returns, ...trace.yields]) {
      if (!(ti instanceof ClassTI)) continue
      // can skip classes without locations
      if (ti.location === undefined) continue

      const fname = ti.location!.location
      if (fname == filename) continue
      if (!imports.has(fname)) imports.set(fname, new Set())
      imports.get(fname)!.add(ti.name)
    }
    
    // make generics
    node.addTypeParameters(generics.map((typs, i) => ({
      name: `T${i+ctx.generic_offset}`,
      constraint: typs.toTypeString(ctx)
    })))
    
    node.getParameters().forEach((param, i) => {
      // TODO: if we're array destructuring do something
      param.setType(trace.args[i].toTypeString(ctx))
    })
    generic_offset += generics.length

    // set return type
    if (trace.yields.length !== 0) {
      let gen = [combine_types(trace.yields).toTypeString(ctx)]
      if (trace.returns.type !== "undefined") gen.push(trace.returns.toTypeString(ctx))
      node.setReturnType(`Generator<${gen.join(", ")}>`)
      return
    }

    if (trace.returns.type !== "undefined") node.setReturnType(trace.returns.toTypeString(ctx))

    node.forEachChild(visit)
    generic_offset -= generics.length
  }
  
  visit(source)
  
  // source.forEachDescendant((node, _traversal) => {
  //   if (!(
  //     Node.isFunctionDeclaration(node) ||
  //     Node.isFunctionExpression(node) ||
  //     Node.isArrowFunction(node) ||
  //     Node.isMethodDeclaration(node) ||
  //     Node.isConstructorDeclaration(node) ||
  //     Node.isGetAccessorDeclaration(node) ||
  //     Node.isSetAccessorDeclaration(node)
  //   )) return

  //   const location = node_location_map.get(node)
  //   if (location === undefined || calls[location] === undefined) return node // we haven't annotated
  //   let [trace, generics] = combine_traces(calls[location].traces)
  //   let level = node.getIndentationLevel();

  //   // add all class types to imports if need be
  //   for (const ti of [...trace.args, trace.returns, ...trace.yields]) {
  //     if (!(ti instanceof ClassTI)) continue
  //     // can skip classes without locations
  //     if (ti.location === undefined) continue

  //     const fname = ti.location!.location
  //     if (fname == filename) continue
  //     if (!imports.has(fname)) imports.set(fname, new Set())
  //     imports.get(fname)!.add(ti.name)
  //   }
    
  //   // make generics
  //   node.addTypeParameters(generics.map((typs, i) => ({
  //     name: `T${i}`,
  //     constraint: typs.toTypeString(indentation, level, 0)
  //   })))
    
  //   node.getParameters().forEach((param, i) => {
  //     // TODO: if we're array destructuring do something
      
  //     param.setType(trace.args[i].toTypeString(indentation, level, 0))
  //   })

  //   // set return type
  //   // TODO: do generators
  //   if (trace.yields.length !== 0) {
  //     let gen = [combine_types(trace.yields).toTypeString(indentation, level, 0)]
  //     if (trace.returns.type !== "undefined") gen.push(trace.returns.toTypeString(indentation, level, 0))
  //     node.setReturnType(`Generator<${gen.join(", ")}>`)
  //     return
  //   }

  //   if (trace.returns.type !== "undefined") node.setReturnType(trace.returns.toTypeString(indentation, level, 0))

  // })
  
  // add_imports(source, path.dirname(filename), imports)
  add_imports(source, path.dirname(filename)+path.sep, imports)
  return source.getFullText()
}



