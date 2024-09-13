const ts = require("typescript");

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
export const isSymbolDeprecated = (symbol, checker, node) => {
    if (!symbol) return false; // Ensure symbol is defined
    const declaration = symbol.getDeclarations?.()[0];
    if (!declaration) return false;

    const comments = getPrecedingComments(declaration, node);
    return comments.some(comment => comment.includes("@deprecated"));
};

// Retrieve the comments directly preceding a node (can be // or /* */ comments)
const getPrecedingComments = (declaration, node) => {
    const sourceFile = node.getSourceFile();
    const fullText = sourceFile.getFullText();
    const comments = [];

    // Get the position of the declaration
    const leadingCommentRanges = ts.getLeadingCommentRanges(fullText, declaration.getFullStart()) || [];
    leadingCommentRanges.forEach(range => {
        const comment = fullText.substring(range.pos, range.end);
        comments.push(comment);
    });

    return comments;
};
