import { findNodeAtPosition, isSupportedFileType, isSymbolDeprecated } from "./utils";

// The factory function that TypeScript expects
function init({ typescript: ts }) {
    return {
        create(info) {
            const proxy = Object.create(null);
            const oldGetQuickInfoAtPosition = info.languageService.getQuickInfoAtPosition;
            const oldGetSemanticDiagnostics = info.languageService.getSemanticDiagnostics;

            // Override console.log to log to TypeScript Server
            const log = message => {
                info.project.projectService.logger.info(`[DEPRECATION PLUGIN]: ${message}`);
            };

            log("Plugin Initialized - hotloading");

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
                    log(`Checking for deprecated symbols in ${fileName}`);
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
}

module.exports = init;
