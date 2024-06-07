/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable @typescript-eslint/no-var-requires */
const tsPreset = require('ts-jest/jest-preset');
// const mongoPreset = require('@shelf/jest-mongodb/jest-preset');

const jestOverwrites = {
  roots: ['<rootDir>/lib'],
  testMatch: ['**/*.spec.ts'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules'],
};

module.exports = {
  ...tsPreset,
  ...jestOverwrites,
  verbose: true,
  clearMocks: true,
  testEnvironment: 'node',
};
