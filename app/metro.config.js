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

module.exports = config;
