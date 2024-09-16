import * as ts from "typescript";

// Check if the file is TypeScript or JavaScript
export const isSupportedFileType = fileName => {
    return (
        fileName.endsWith(".ts") || fileName.endsWith(".tsx") || fileName.endsWith(".js") || fileName.endsWith(".jsx")
    );
};

// Find the node at the given position in the file
export const findNodeAtPosition = (sourceFile, position) => {
    if (!sourceFile) return undefined;
    const find = node => {
        if (position >= node.getStart() && position < node.getEnd()) {
            return ts.forEachChild(node, find) || node;
        }
        return undefined;
    };
    return find(sourceFile);
};

// Check if a symbol is marked as deprecated in any type of comment
export const isSymbolDeprecated = symbol => {
    if (!symbol) return false; // Ensure symbol is defined

    const declarations = symbol.getDeclarations();
    if (!declarations || declarations.length === 0) {
        console.log("[DEPRECATION PLUGIN] No declarations found for symbol.");
        return false;
    }

    if (symbol.getName() === "LoadingMessage") {
        console.log(`[DEPRECATION PLUGIN] Found ${declarations.length} declarations for symbol ${symbol.getName()}`);
    }

    for (const declaration of declarations) {
        // Retrieve all comments preceding the declaration
        const comments = getAllPrecedingComments(declaration);

        if (comments.length > 0) {
            console.log(`[DEPRECATION PLUGIN] Checking symbol: ${symbol.getName()}`);
            console.log(`[DEPRECATION PLUGIN] Found ${comments.length} comments.`);
            console.log(`[DEPRECATION PLUGIN] Comments: ${comments}`);
        }
        for (const comment of comments) {
            if (comment.includes("@deprecated")) {
                console.log(`[DEPRECATION PLUGIN] Symbol ${symbol.getName()} is deprecated.`);
                return true;
            }
        }
    }

    return false;
};

// Retrieve all comments (JSDoc and non-JSDoc) preceding a node
export const getAllPrecedingComments = declaration => {
    const sourceFile = declaration.getSourceFile();
    const fullText = sourceFile.getFullText();
    const comments = [];

    // Get the position of the declaration
    const declarationFullStart = declaration.getFullStart();

    // Retrieve leading comments (non-JSDoc)
    const leadingCommentRanges = ts.getLeadingCommentRanges(fullText, declarationFullStart) || [];
    if (leadingCommentRanges.length > 0) {
        console.log(`[DEPRECATION PLUGIN] Leading comment ranges (non-JSDoc): ${leadingCommentRanges.length}`);
    }

    leadingCommentRanges.forEach(range => {
        const comment = fullText.substring(range.pos, range.end);
        comments.push(comment);
    });

    // Retrieve JSDoc comments
    const jsDocCommentRanges: ts.TextRange = ts.getCommentRange(declaration.parent);
    if (jsDocCommentRanges) {
        console.log(
            `[DEPRECATION PLUGIN] JSDoc comment ranges: ${jsDocCommentRanges?.pos} - ${jsDocCommentRanges?.end}`
        );
        const jsDocComment = fullText.substring(jsDocCommentRanges.pos, jsDocCommentRanges.end);
        comments.push(jsDocComment);
    }

    return comments;
};

// Helper function to retrieve the symbol at a node
export const getSymbolAtNode = (checker, node) => {
    const symbol = checker.getSymbolAtLocation(node.name);
    return symbol;
};
