module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
};