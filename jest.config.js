/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-var-requires */
const base = require('./jest.config.base');
const pack = require('./package');

module.exports = {
  ...base,
  name: pack.name,
  displayName: pack.name,
};
