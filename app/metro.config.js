// One project, one root: the API client now lives inside src/shared/api, so
// Metro has nothing to resolve outside this directory.
const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Pin module resolution to this project. Without it Metro walks up the repo and
// can find a second copy of React, which fails at runtime with "invalid hook
// call" rather than at build time.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.disableHierarchicalLookup = true;

// jspdf's `node` export is `dist/jspdf.node.min.js`, which calls AMD-style
// `require(["html2canvas"], cb)`. Metro cannot transform that call, and the web
// export's static-rendering pass resolves packages under the `node` condition -
// so the whole web build failed the moment any route reached the documents
// slice, even though `lib/pdf.ts` only ever imports jspdf lazily, on a click,
// in a browser. Every platform gets the ES build instead: it is the one the
// browser runs anyway, and on the server and on a device it is bundled but
// never evaluated, because `pdf.ts` refuses before the import on native.
const jspdfBrowserBuild = path.resolve(__dirname, 'node_modules/jspdf/dist/jspdf.es.min.js');
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'jspdf') return { type: 'sourceFile', filePath: jspdfBrowserBuild };
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
