module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    requireModule: ['ts-node/register'],
    require: ['features/support/**/*.ts', 'features/steps/**/*.ts'],
    format: ['progress', 'html:reports/cucumber.html'],
  },
};
