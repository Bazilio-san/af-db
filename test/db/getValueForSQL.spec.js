/* eslint-disable max-len */
/* eslint-disable no-console */

// "America/Toronto"  -05:00
// "Europe/Berlin"    +01:00
// "Europe/Moscow"    +03:00

const { expect } = require('chai');
const { sql } = require('../../dist/cjs/index');

describe('sql.getValueForSQL() should work properly', () => {
  before((next) => {
    sql.setTimeZone('Europe/Moscow');
    next();
  });
  describe('should parse date properly', () => {
    const testArr = [
      ['2000-01-22T11:59:59.123', '2000-01-22T11:59:59.123'],
      ['2000-01-22T11:59:59.12', '2000-01-22T11:59:59.120'],
      ['2000-01-22T11:59:59', '2000-01-22T11:59:59.000'],
      ['2000-01-22T11:59', '2000-01-22T11:59:00.000'],
      ['2000-01-22 11:59:59.123', '2000-01-22T11:59:59.123'],
      ['2000-01-22 11:59:59.12', '2000-01-22T11:59:59.120'],
      ['2000-01-22 11:59:59.1', '2000-01-22T11:59:59.100'],
      ['2000-01-22 11:59:59', '2000-01-22T11:59:59.000'],
      ['2000-01-22 11:59', '2000-01-22T11:59:00.000'],
      ['2000-01-22 11:2', '2000-01-22T11:02:00.000'],
      ['2000-01-22 2:2', '2000-01-22T02:02:00.000'],
      ['2000-1-2 02:02', '2000-01-02T02:02:00.000'],
      ['2019-8-9 5:16:14 AM', '2019-08-09T05:16:14.000'],
      ['2019-8-9 5:16:14 PM', '2019-08-09T17:16:14.000'],
    ];
    testArr.forEach((pair) => {
      it(`- like '${pair[0]}'`, () => {
        const dateStrOut = sql.getValueForSQL(pair[0], 'datetime');
        expect(dateStrOut).to.equal(`'${pair[1]}'`);
      });
    });
  });

  describe('should work with timezone properly', () => {
    describe('should parse date properly', () => {
      const testArr = [
        ['2000-01-22T11:59:59.123Z', '2000-01-22T14:59:59.123'],
        ['2000-01-22T11:59:59.123+0300', '2000-01-22T11:59:59.123'],
        ['Thu Aug 08 2019 05:16:14 GMT+0300 (GMT+03:00)', '2019-08-08T05:16:14.000'],
      ];
      testArr.forEach((pair) => {
        it(`- like '${pair[0]}'`, () => {
          const dateStrOut = sql.getValueForSQL(pair[0], 'datetime');
          expect(dateStrOut).to.equal(`'${pair[1]}'`);
        });
      });
    });
    describe(`should ignore timezone with option 'ignoreTZ'`, () => {
      const testArr = [
        ['2000-01-22T11:59:59.123Z', '2000-01-22T11:59:59.123'],
        ['2000-01-22T11:59:59.123+0600', '2000-01-22T11:59:59.123'],
        ['2000-01-22T11:59:59.123-0600', '2000-01-22T11:59:59.123'],
        ['2000-01-22T11:59:59.123-04', '2000-01-22T11:59:59.123'],
        ['2000-01-22T11:59:59.123+0430', '2000-01-22T11:59:59.123'],
        ['Thu Aug 08 2019 05:16:14 GMT+0100 (GMT+01:00)', '2019-08-08T05:16:14.000'],
        ['Thu Aug 08 2019 05:16:14 GMT+0700 (GMT+07:00)', '2019-08-08T05:16:14.000'],
        ['Thu Aug 08 2019 05:16:14 GMT+0700', '2019-08-08T05:16:14.000'],
      ];
      testArr.forEach((pair) => {
        it(`- in date like '${pair[0]}'`, () => {
          const dateStrOut = sql.getValueForSQL(pair[0], { type: 'datetime', ignoreTZ: true });
          expect(dateStrOut).to.equal(`'${pair[1]}'`);
        });
      });
    });
  });
});
