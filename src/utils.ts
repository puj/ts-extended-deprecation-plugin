// utils.ts
import * as ts from "typescript";

/**
 * ==============================
 * File Type Utilities
 * ==============================
 */

/**
 * Checks if the provided file name corresponds to a supported file type (TypeScript or JavaScript).
 * @param fileName - The name of the file to check.
 * @returns True if the file is a .ts, .tsx, .js, or .jsx file; false otherwise.
 */
export function isSupportedFileType(fileName: string): boolean {
    const supportedExtensions = [".ts", ".tsx", ".js", ".jsx"];
    return supportedExtensions.some(ext => fileName.endsWith(ext));
}

/**
 * ==============================
 * AST Node Utilities
 * ==============================
 */

/**
 * Finds the AST node at the specified position within the source file.
 * @param sourceFile - The source file to search.
 * @param position - The position within the file.
 * @returns The node at the specified position, or undefined if not found.
 */
export function findNodeAtPosition(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
    function find(node: ts.Node): ts.Node | undefined {
        if (position >= node.getStart() && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
        return undefined;
    }
    return find(sourceFile);
}

/**
 * Retrieves all preceding comments (both JSDoc and regular comments) from a given AST node.
 * @param node - The AST node.
 * @returns An array of comment strings preceding the node.
 */
export function getCommentsFromNode(node: ts.Node): string[] {
    if (!node) {
        return [];
    }

    const comments: string[] = [];
    const sourceFile = node.getSourceFile();
    const fullText = sourceFile.getFullText();
    const nodeStart = node.getFullStart();

    // Retrieve leading comments (non-JSDoc)
    const leadingCommentRanges = ts.getLeadingCommentRanges(fullText, nodeStart) || [];
    for (const range of leadingCommentRanges) {
        const comment = fullText.substring(range.pos, range.end);
        comments.push(comment);
    }

    // Retrieve JSDoc comments
    const jsDocs = (node as any).jsDoc as ts.JSDoc[] | undefined;
    if (jsDocs) {
        for (const jsDoc of jsDocs) {
            const comment = jsDoc.getFullText(sourceFile).trim();
            comments.push(comment);
        }
    }

    return comments;
}

/**
 * Checks if an AST node is marked as deprecated.
 * @param checker - The TypeScript type checker.
 * @param node - The AST node.
 * @returns True if the node or its symbol is deprecated; false otherwise.
 */
export function isNodeDeprecated(checker: ts.TypeChecker, node: ts.Node): boolean {
    const symbol = getSymbolAtNode(checker, node);
    if (symbol && isSymbolDeprecated(symbol)) {
        return true;
    }

    // If the node is a declaration, check if it's deprecated
    if (ts.isDeclarationStatement(node) && isDeclarationDeprecated(node)) {
        return true;
    }

    return false;
}

/**
 * ==============================
 * Symbol Utilities
 * ==============================
 */

/**
 * Retrieves the symbol associated with a given AST node.
 * @param checker - The TypeScript type checker.
 * @param node - The AST node.
 * @returns The symbol associated with the node, or undefined if not found.
 */
export function getSymbolAtNode(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
    return checker.getSymbolAtLocation(node);
}

/**
 * Retrieves all preceding comments from all declarations of a given symbol.
 * @param symbol - The TypeScript symbol.
 * @returns An array of comment strings from all declarations of the symbol.
 */
export function getCommentsFromSymbol(symbol: ts.Symbol): string[] {
    const comments: string[] = [];
    const declarations = symbol.getDeclarations() || [];

    for (const declaration of declarations) {
        comments.push(...getCommentsFromDeclaration(declaration));
    }

    return comments;
}

/**
 * Checks if a symbol is marked as deprecated.
 * @param symbol - The TypeScript symbol.
 * @returns True if the symbol is deprecated; false otherwise.
 */
export function isSymbolDeprecated(symbol: ts.Symbol): boolean {
    const declarations = symbol.getDeclarations() || [];
    return declarations.some(isDeclarationDeprecated);
}

/**
 * ==============================
 * Declaration Utilities
 * ==============================
 */

/**
 * Retrieves all preceding comments (both JSDoc and regular comments) from a given declaration.
 * @param declaration - The AST declaration node.
 * @returns An array of comment strings preceding the declaration.
 */
export function getCommentsFromDeclaration(declaration: ts.Declaration): string[] {
    return getCommentsFromNode(declaration);
}

/**
 * Checks if a declaration is marked as deprecated.
 * @param declaration - The AST declaration node.
 * @returns True if the declaration is deprecated; false otherwise.
 */
export function isDeclarationDeprecated(declaration: ts.Declaration): boolean {
    // Check JSDoc tags for @deprecated
    // const jsDocs = (declaration as any).jsDoc as ts.JSDoc[] | undefined;
    // if (jsDocs) {
    //     for (const jsDoc of jsDocs) {
    //         if (jsDoc.tags) {
    //             for (const tag of jsDoc.tags) {
    //                 if (ts.isJSDocDeprecatedTag(tag)) {
    //                     return true;
    //                 }
    //             }
    //         }
    //     }
    // }

    // Check preceding comments for @deprecated
    const comments = getCommentsFromDeclaration(declaration);
    for (const comment of comments) {
        if (comment.includes("@deprecated")) {
            return true;
        }
    }

    return false;
}

/**
 * ==============================
 * JSDoc Utilities
 * ==============================
 */

/**
 * Retrieves all JSDoc tags of a specific kind preceding a node.
 * @param declaration - The AST declaration node.
 * @param tagName - The name of the JSDoc tag to retrieve.
 * @returns An array of JSDoc tags matching the specified name.
 */
export function getJsDocTags(declaration: ts.Declaration, tagName: string): ts.JSDocTag[] {
    const tags: ts.JSDocTag[] = [];
    const jsDocs = (declaration as any).jsDoc as ts.JSDoc[] | undefined;

    if (jsDocs) {
        for (const jsDoc of jsDocs) {
            if (jsDoc.tags) {
                for (const tag of jsDoc.tags) {
                    if (tag.tagName.text === tagName) {
                        tags.push(tag);
                    }
                }
            }
        }
    }

    return tags;
}
