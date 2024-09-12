const init = modules => {
    const ts = modules.typescript;
    console.log(["DEPRECATION PLUGIN LOADED"]);

    // Check if the file is TypeScript or JavaScript
    const isSupportedFileType = fileName => {
        return (
            fileName.endsWith(".ts") ||
            fileName.endsWith(".tsx") ||
            fileName.endsWith(".js") ||
            fileName.endsWith(".jsx")
        );
    };

    // Find the node at the given position in the file
    const findNodeAtPosition = (sourceFile, position) => {
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
    const isSymbolDeprecated = (symbol, checker, node) => {
        const declaration = symbol.getDeclarations()?.[0];
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

    return {
        create: info => {
            const proxy = Object.create(null);
            const oldGetQuickInfoAtPosition = info.languageService.getQuickInfoAtPosition;
            const oldGetSemanticDiagnostics = info.languageService.getSemanticDiagnostics;

            // Override console.log to log to TypeScript Server
            const log = message => {
                info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);
            };

            log("Plugin Initialized");

            const checker = info.languageService.getProgram()?.getTypeChecker();

            // Hook into the quick info to display tooltips
            proxy.getQuickInfoAtPosition = (fileName, position) => {
                // Ensure we're working with TypeScript/JavaScript files
                if (!isSupportedFileType(fileName)) return oldGetQuickInfoAtPosition(fileName, position);

                const quickInfo = oldGetQuickInfoAtPosition(fileName, position);
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const node = findNodeAtPosition(sourceFile, position);
                if (node && checker) {
                    const symbol = checker.getSymbolAtLocation(node);
                    if (symbol && isSymbolDeprecated(symbol, checker, node)) {
                        // Log for troubleshooting
                        log(`Deprecated symbol detected: ${symbol.getName()}`);
                        // Inject deprecation notice in the hover tooltip
                        quickInfo.tags = [
                            {
                                name: "deprecated",
                                text: [
                                    {
                                        kind: "text",
                                        text: "Symbol is deprecated."
                                    }
                                ]
                            }
                        ];
                    }
                }
                return quickInfo;
            };

            // Hook into diagnostics for deprecation warnings
            proxy.getSemanticDiagnostics = fileName => {
                const priorDiagnostics = oldGetSemanticDiagnostics(fileName);
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const diagnostics = [];

                if (sourceFile && checker && isSupportedFileType(fileName)) {
                    // Walk through AST and mark deprecated usages
                    ts.forEachChild(sourceFile, node => {
                        const symbol = checker.getSymbolAtLocation(node);
                        if (symbol && isSymbolDeprecated(symbol, checker, node)) {
                            log(`Adding diagnostic for deprecated symbol: ${symbol.getName()}`);
                            diagnostics.push({
                                file: sourceFile,
                                start: node.getStart(),
                                length: node.getEnd() - node.getStart(),
                                messageText: `Symbol ${symbol.getName()} is deprecated.`,
                                category: ts.DiagnosticCategory.Warning,
                                code: 9999 // Custom code
                            });
                        }
                    });
                }

                return priorDiagnostics.concat(diagnostics);
            };

            return proxy;
        }
    };
};

module.exports = init;
