//https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API
import ts from "typescript"
import { readFileSync } from "fs"
import { calls } from "../instrument/trace.ts"

const transformer = <T extends ts.Node>(context: ts.TransformationContext) => (root: T) => {
  const source = root.getSourceFile()
  const filename = source.fileName
  
  function visit(node: ts.Node) {
    node = ts.visitEachChild(node, visit, context)
    switch (node.kind) {
      case ts.SyntaxKind.FunctionDeclaration:
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
      case ts.SyntaxKind.MethodDeclaration:
      case ts.SyntaxKind.Constructor:
      case ts.SyntaxKind.GetAccessor:
      case ts.SyntaxKind.SetAccessor:
        // has this function been seen before
        const location = `${filename}:${node.getStart(source, true)}`
        if (calls[location] === undefined) break // we haven't annotated
        console.log(calls[location])

        const parameters = (node as ts.FunctionLikeDeclarationBase).parameters
        for (const param of parameters) {
        }

      
        break

    }

    return node
  }

  return ts.visitNode(root, visit)
}

export function transform(filename: string) {
  const source = ts.createSourceFile(filename, readFileSync(filename).toString(), ts.ScriptTarget.ES2024)
  ts.transform(source, [transformer])
}


