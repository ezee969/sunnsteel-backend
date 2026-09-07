// Load decorators and module imports without creating Nest or connecting to a DB.
require('reflect-metadata');
require('../dist/src/app.module.js');
console.log('Compiled application module imports successfully');
