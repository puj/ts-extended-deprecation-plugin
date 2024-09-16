import * as ts from "typescript";
import { findNodeAtPosition, getSymbolAtNode, isSupportedFileType, isSymbolDeprecated } from "./utils";
import { Diagnostic } from "typescript";

// Common function to create diagnostic for deprecated symbols
function createDeprecatedDiagnostic(
    node: ts.Node,
    symbol: ts.Symbol,
    checker: ts.TypeChecker,
    sourceFile: ts.SourceFile,
    priorDiagnostics: Diagnostic[],
    log: (message: string) => void
): Diagnostic | null {
    const diagnosticStart = node.getStart();
    const diagnosticEnd = node.getEnd() - node.getStart();
    const diagnosticCode = 6385; // Deprecated code

    const declaration = symbol.getDeclarations()[0];
    const deprecationSourceStart = declaration.getStart();
    const deprecationSourceEnd = declaration.getEnd();
    const deprecationSourceFile = declaration.getSourceFile();

    const alreadyReported = priorDiagnostics.some(
        diagnostic =>
            diagnostic.start === diagnosticStart &&
            diagnostic.length === diagnosticEnd &&
            diagnostic.code === diagnosticCode
    );

    if (!alreadyReported) {
        log(`Adding diagnostic for deprecated symbol: ${symbol.getName()}`);
        return {
            file: sourceFile,
            start: diagnosticStart,
            length: diagnosticEnd,
            messageText: `'${symbol.getName()}' is deprecated.`,
            category: ts.DiagnosticCategory.Warning,
            reportsDeprecated: true,
            code: diagnosticCode,
            relatedInformation: [
                {
                    start: deprecationSourceStart,
                    length: deprecationSourceEnd - deprecationSourceStart,
                    file: deprecationSourceFile,
                    messageText: "The declaration was marked as deprecated here.",
                    category: ts.DiagnosticCategory.Error,
                    code: 2798
                }
            ]
        };
    }
    return null;
}

// Helper function to create detailed deprecation message for QuickInfo
function createDeprecatedQuickInfoTag(symbol: ts.Symbol, checker: ts.TypeChecker): ts.JSDocTagInfo | null {
    const declaration = symbol.getDeclarations()[0];
    const sourceFile = declaration.getSourceFile();
    const start = declaration.getStart();
    const end = declaration.getEnd();

    return {
        name: "deprecated",
        text: [
            {
                kind: "text",
                text: `Symbol '${symbol.getName()}' is deprecated.`
            },
            {
                kind: "space",
                text: " "
            },
            {
                kind: "text",
                text: `Declared in ${sourceFile.fileName} at line ${
                    sourceFile.getLineAndCharacterOfPosition(start).line + 1
                }.`
            }
        ]
    };
}

// The factory function that TypeScript expects
function init({ typescript: ts }) {
    return {
        create(info) {
            const proxy = Object.create(null);
            const oldGetQuickInfoAtPosition = info.languageService.getQuickInfoAtPosition;
            const oldGetSemanticDiagnostics = info.languageService.getSemanticDiagnostics;
            const oldGetSuggestionDiagnostics = info.languageService.getSuggestionDiagnostics;

            // Logging to TypeScript Server
            const log = message => info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);

            log("Plugin Initialized - hotloading");

            const checker = info.languageService.getProgram()?.getTypeChecker();

            // Hook into the quick info to display tooltips
            proxy.getQuickInfoAtPosition = (fileName, position) => {
                if (!isSupportedFileType(fileName)) return oldGetQuickInfoAtPosition(fileName, position);

                const quickInfo: ts.QuickInfo = oldGetQuickInfoAtPosition(fileName, position);
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const node = findNodeAtPosition(sourceFile, position);

                if (node && checker) {
                    const symbol = checker.getSymbolAtLocation(node);
                    if (symbol && isSymbolDeprecated(symbol)) {
                        log(`Deprecated symbol detected: ${symbol.getName()}`);

                        // Create detailed deprecation message with source information
                        const deprecationTag = createDeprecatedQuickInfoTag(symbol, checker);
                        if (deprecationTag) {
                            quickInfo.tags = quickInfo.tags || [];
                            quickInfo.tags.push(deprecationTag);
                        }
                    }
                }

                return quickInfo;
            };

            // Common logic for both suggestion and semantic diagnostics
            const checkDiagnostics = (fileName, priorDiagnostics, category) => {
                const sourceFile = info.languageService.getProgram()?.getSourceFile(fileName);
                const diagnostics: Diagnostic[] = [];

                if (sourceFile && checker && isSupportedFileType(fileName)) {
                    log(`Checking ${fileName} for deprecated symbols`);

                    const visit = node => {
                        const symbol = getSymbolAtNode(checker, node);
                        if (symbol && isSymbolDeprecated(symbol)) {
                            const diagnostic = createDeprecatedDiagnostic(
                                node,
                                symbol,
                                checker,
                                sourceFile,
                                priorDiagnostics,
                                log
                            );
                            if (diagnostic) {
                                diagnostic.category = category;
                                diagnostics.push(diagnostic);
                            }
                        }
                        ts.forEachChild(node, visit);
                    };

                    visit(sourceFile);
                }

                return priorDiagnostics.concat(diagnostics);
            };

            // Override suggestion diagnostics
            proxy.getSuggestionDiagnostics = fileName => {
                const priorDiagnostics = oldGetSuggestionDiagnostics(fileName);
                return checkDiagnostics(fileName, priorDiagnostics, ts.DiagnosticCategory.Suggestion);
            };

            // Override semantic diagnostics
            proxy.getSemanticDiagnostics = fileName => {
                const priorDiagnostics = oldGetSemanticDiagnostics(fileName);
                return checkDiagnostics(fileName, priorDiagnostics, ts.DiagnosticCategory.Warning);
            };

            return proxy;
        }
    };
}

module.exports = init;
