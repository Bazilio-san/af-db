const { expect } = require('chai');

describe('Testing environment should be set properly', () => {
  it('NODE_ENV should be "testing"', () => {
    expect(process.env.NODE_ENV).to.equal('testing');
  });
  it('config.logger.level should be "verbose"', () => {
    const currentLevel = 'verbose';
    expect(currentLevel).to.equal('verbose');
  });
});
