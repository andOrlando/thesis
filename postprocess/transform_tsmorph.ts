import { Project, Node, SourceFile } from "ts-morph"
import type { ImportDeclarationStructure, OptionalKind } from "ts-morph"
import fs from "node:fs"
import * as path from "path"
import { calls } from "../instrument/trace.ts"
import { combine_traces, combine_types } from "../typeinfo/combine.ts"
import { ClassTI } from "../typeinfo/types.ts"


export function transform(filename: string) {
  const project = new Project()
  const source = project.createSourceFile(filename, fs.readFileSync(filename).toString(), {overwrite: true})
  const indentation = source.getIndentationText()
  const imports: Map<string, Set<string>> = new Map()
  // console.log(calls)

  const node_location_map: WeakMap<Node, string> = new WeakMap()

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

    const location = node_location_map.get(node)
    if (location === undefined || calls[location] === undefined) return node // we haven't annotated
    let trace = combine_traces(calls[location].traces)
    let level = node.getIndentationLevel();

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
    
    let i=0
    node.getParameters().forEach((param, i) => {
      // TODO: if we're array destructuring do something
      
      param.setType(trace.args[i].toTypeString(indentation, level))
    })

    // set return type
    // TODO: do generators
    if (trace.yields.length !== 0) {
      let gen = [combine_types(trace.yields).toTypeString(indentation, level)]
      if (trace.returns.type !== "undefined") gen.push(trace.returns.toTypeString(indentation, level))
      node.setReturnType(`Generator<${gen.join(", ")}>`)
      return
    }

    if (trace.returns.type !== "undefined") node.setReturnType(trace.returns.toTypeString(indentation, level))
    // }

  })
  
  // add_imports(source, path.dirname(filename), imports)
  add_imports(source, path.dirname(filename)+path.sep, imports)
  return source.getFullText()
}

const module_pkgjson: Map<string, Object> = new Map();
function get_pkgjson(basepath: string, modname: string): Object {
  if (!module_pkgjson.has(modname)) {
    let pkg_path = basepath+"node_modules"+path.sep+modname+path.sep+"package.json"
    let pkg_string = fs.readFileSync(pkg_path, "utf8")
    module_pkgjson.set(modname, JSON.parse(pkg_string))
  }
  return module_pkgjson.get(modname)!
}

function search_exports(key: string, value: Object|string|(Object|string)[], source: string, modname: string): string|undefined {
  if (typeof value == "string") {
    if (value != `./${source}`) return undefined
    // if we have "." it's package name
    // otherwise we concatenate without ./ to package name
    if (key == ".") return modname
    return `${modname}/${key.replace(/^\.\//, "")}`
  }
  else if (Array.isArray(value)) {
  
    for (const elem of value) {
      let res = search_exports(key, elem, source, modname)
      if (res != undefined) return res
    }
  }

  // otherwise its an object
  else {
    // if it's an object we don't particularly care what the key is, we just care about the value
    for (const elem of Object.values(value)) {
      let res = search_exports(key, elem, source, modname)
      if (res != undefined) return res
    }
  }
}

function compute_import(filepath: string, abspath: string): string {

  // if we don't see node_modules we can just transform to relative import
  // also need to strip .ts/.js/.mjs etc.
  if (!abspath.includes(`${path.sep}node_modules${path.sep}`)) {
    // if we don't start with ./ we need to start with ./
    let s = path.relative(filepath, abspath)
    if (!s.startsWith(".")) s = `./${s}`
    return s
  }

  // we may need to transform absolute paths into node imports
  // if we have `exports` and see the file in one of the exports, import from there
  // if we have `main` and see the file there, import just the package name
  //
  // if it's neither exports nor main, we need to direct import.
  // if in any of the above situations it's an internal class, we need to add a d.ts file to add a public type for that class
  const mod_re = new RegExp(`(.*\\${path.sep})node_modules\\${path.sep}(.*?)\\${path.sep}(.*)(\\..*?$)`)
  const [_, basepath, modname, sourcepath, extension] = mod_re.exec(abspath)!
  const pkgjson = get_pkgjson(basepath, modname)

  // if we have exports and filepath in exports
  if ("exports" in pkgjson) {
    for (const [key, value] of Object.entries(pkgjson.exports as Object)) {
      let res = search_exports(key, value, `${sourcepath}${extension}`, modname)
      if (res) return res
    }
  }

  // could also just be what we're given in main, in which case we just use modname
  if ("main" in pkgjson && pkgjson.main == `${sourcepath}${extension}`) {
    return modname
  }
  
  // if we could not compute the modspec at all we need to just use abspath
  return path.relative(filepath, abspath)
}

function add_imports(source: SourceFile, filepath: string, imports: Map<string, Set<string>>) {
  const old_imports = source.getImportDeclarations()
  const last_import = imports[old_imports.length-1]
  const new_imports: OptionalKind<ImportDeclarationStructure>[] = []

  for (const [abspath, names] of imports.entries()) {
    const modspec = compute_import(filepath, abspath)
    const string_imports = old_imports.filter(a => a.getModuleSpecifierValue() == modspec)
        .map(a => a.getNamedImports().map(a => a.getName()))
        .flat()
    const to_be_imported = Array.from(names).filter(a => !string_imports.includes(a))
    new_imports.push({
      isTypeOnly: true,
      moduleSpecifier: modspec,
      namedImports: to_be_imported
    })
  }

  source.insertImportDeclarations(last_import ? last_import.getChildIndex() : 0, new_imports)
}



