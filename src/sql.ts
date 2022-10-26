/* eslint-disable no-console, max-len,no-fallthrough */
// noinspection SqlResolve
import * as config from 'config';
// eslint-disable-next-line import/no-duplicates
import { IResult } from 'mssql';
// eslint-disable-next-line import/no-duplicates
import * as moment from 'moment-timezone';
import * as _ from 'lodash';
import * as cache from 'memory-cache';
import {
  IDBConfig,
  IFieldSchema,
  IGetMergeSQLOptions,
  TDBRecord,
  TFieldName,
  TFieldTypeCorrection,
  TGetRecordSchemaOptions,
  TRecordSchema,
  TRecordSchemaAssoc,
  TRecordSet,
} from './interfaces';
import * as db from './db';

export const sql = require('mssql');
const echo = require('af-echo');
const U = require('af-fns');

const timezone = config.get('timezone') as string;
moment.tz.setDefault(timezone);

const { dialect } = config.get('database');
const IS_POSTGRES = dialect === 'postgres';

// @ts-ignore
sql.on('error', (err) => {
  echo.error('SQL-ERROR', err);
});

/**
 * Оборачивает строку в одинарные кавычки, если второй аргумент не true
 */
const q = (val: string, noQuotes?: boolean): string => (noQuotes ? val : `'${val}'`);

/**
 * Изменение timezone объекта moment этого модуля.
 * Влияет на время, которое парсится из строки в функции getValueForSQL()
 * Функция используется для целей тестирования.
 */
export const setTimeZone = (tz: string) => {
  moment.tz.setDefault(tz);
};

/**
 * Подготовка строки для передачи в SQL
 */
export const prepareSqlString = (
  // Значение, которое нужно подготовить для передачи в SQL
  str: string | number | null,
  // Подставлять NULL, если значение пусто или пустая строка.
  nullable: boolean | number = false,
  // Ограничение на длину поля. Если передано, строка урезается
  len: number = 0,
  // Значение, которое будет подставлено, если передано пустое значение и nullable = false
  default_: string | null = null,
  noQuotes: boolean = false,
  escapeOnlySingleQuotes: boolean = false,
): string | null => {
  str = (String(str || '')).trim();
  if (!str) {
    if (str == null) {
      if (nullable) return 'NULL';
      return default_ ? q(default_, noQuotes) : null; // Это нештатная ситуация, т.к. вернется null и поле ен получит никакого значения ( ,, )
    }
    return q(String(str), noQuotes);
  }
  str = U.se(str, escapeOnlySingleQuotes);
  if (len > 0) {
    str = str ? String(str).substring(0, len) : null;
  }
  return q(String(str), noQuotes);
};

export const s = prepareSqlString;

const FIELD_SCHEMA_PROPS = ['index', 'name', 'length', 'type', 'scale', 'precision', 'nullable', 'caseSensitive',
  'identity', 'mergeIdentity', 'readOnly', 'inputDateFormat', 'default_'];

/**
 * Корректировка схемы таблицы
 * Поля с суффиксом _json получают тип "json". Остальные корректировки берутся из fieldTypeCorrection
 * Например, для полей типа datetime можно передавать свойство inputDateFormat
 */
export const correctRecordSchema = (
  recordSchemaAssoc: TRecordSchemaAssoc,
  // объект корректировок
  fieldTypeCorrection?: TFieldTypeCorrection,
) => {
  _.each(recordSchemaAssoc, (fieldSchema: IFieldSchema, fieldName: TFieldName) => {
    if (/_json$/i.test(fieldName)) {
      fieldSchema.type = 'json';
    }
    switch (fieldSchema.type) {
      case sql.NChar:
      case sql.NText:
      case sql.NVarChar:
        if (fieldSchema.length) {
          fieldSchema.length = Math.floor(fieldSchema.length / 2);
        }
        break;
      case sql.UniqueIdentifier:
        fieldSchema.length = 36;
        break;
      default:
    }
  });
  if (fieldTypeCorrection && typeof fieldTypeCorrection === 'object') {
    _.each(fieldTypeCorrection, (correction: IFieldSchema, fieldName: TFieldName) => {
      FIELD_SCHEMA_PROPS.forEach((prop) => {
        if (correction[prop] !== undefined) {
          if (!recordSchemaAssoc[fieldName]) {
            recordSchemaAssoc[fieldName] = {} as IFieldSchema;
          }
          recordSchemaAssoc[fieldName][prop] = correction[prop];
        }
      });
    });
  }
};

export const binToHexString = (value: any) => (value ? `0x${value.toString(16).toUpperCase()}` : null);

/**
 * Возвращает значение, готовое для использования в строке SQL запроса
 * validate - Флаг необходимости валидации значения
 */
export const getValueForSQL = (value: any, fieldSchema: IFieldSchema | string, validate?: boolean, escapeOnlySingleQuotes?: boolean): string | number | null => {
  if (typeof fieldSchema === 'string') {
    fieldSchema = { type: fieldSchema };
  }
  const {
    type,
    arrayType,
    length = 0,
    scale = null,
    nullable = true,
    inputDateFormat,
    default_,
    noQuotes,
    name,
  } = fieldSchema;
  let val;

  escapeOnlySingleQuotes = escapeOnlySingleQuotes || fieldSchema.escapeOnlySingleQuotes;

  function prepareNumber (min: number, max: number, value_ = value) {
    if (value_ === 'null' || value_ == null || Number.isNaN(value_)) {
      if (nullable) {
        return 'NULL';
      }
      return (default_ || default_ === 0) ? `${default_}` : null;
    }
    val = Number(value_);
    if (validate && (val < min || val > max)) {
      // throwValidateError()
      throw new Error(`Type [${type}] validate error. Value: ${val} / FName: ${name}`);
    }
    return `${val}`;
  }

  switch (type) {
    case 'json':
      if (Array.isArray(value) || typeof value === 'object') {
        value = JSON.stringify(value);
      }
      return prepareSqlString(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
    case 'string':
    case sql.Char:
    case sql.NChar:
    case sql.Text:
    case sql.NText:
    case sql.VarChar:
    case sql.NVarChar:
    case sql.Xml:
      return prepareSqlString(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
    case 'uid':
    case 'uuid':
    case 'uniqueIdentifier':
    case sql.UniqueIdentifier:
      if (!value || typeof value !== 'string' || !/^[A-F\d]{8}(-[A-F\d]{4}){4}[A-F\d]{8}/i.test(value)) {
        value = null;
      } else {
        value = value.substring(0, 36)
          .toUpperCase();
      }
      return prepareSqlString(value, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
    case 'datetime':
    case 'date':
    case 'time':
    case sql.DateTime:
    case sql.DateTime2:
    case sql.Time:
    case sql.Date:
    case sql.SmallDateTime:
      val = inputDateFormat ? moment(value, inputDateFormat) : moment(value);
      if (!val.isValid()) {
        return prepareSqlString(null, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
      }
      if (fieldSchema.ignoreTZ) {
        // @ts-ignore
        let offset = val._tzm;
        // @ts-ignore
        if (!val._a) {
          // Если moment не смог распарсить дату (типа (new Date()).toString()), то у него нет свойства _a. Используем костыль
          [, offset] = String(value)
            .match(/GMT([+-]\d+)/) || [];
        }
        val.utcOffset(offset);
      }
      switch (type) {
        case 'datetime':
        case sql.DateTime:
        case sql.DateTime2:
          return q(val.format(`YYYY-MM-DDTHH:mm:ss.SSS0`).substring(0, 23), noQuotes);
        case 'time':
        case sql.Time:
          return q(val.format('HH:mm:ss.SSS0')
            .substring(0, 12), noQuotes);
        case 'date':
        case sql.Date:
          return q(val.format('YYYY-MM-DD'), noQuotes);
        case sql.SmallDateTime:
          return q(`${val.format('YYYY-MM-DDTHH:mm')}:00`, noQuotes);
        default:
          return q(val.toISOString(), noQuotes);
      }
    case sql.DateTimeOffset:
      val = inputDateFormat ? moment(value, inputDateFormat) : moment(value);
      if (!val.isValid()) {
        return prepareSqlString(null, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
      }
      if (scale && scale > 3 && typeof value === 'string') {
        const [, micros] = /\.\d\d\d(\d+)[Z+]/.exec(value) || [];
        if (micros) {
          return q(val.format(`YYYY-MM-DDTHH:mm:ss.SSS${micros}Z`), noQuotes);
        }
      }
      return q(val.format(`YYYY-MM-DDTHH:mm:ss.${'S'.repeat(scale == null ? 3 : scale)}Z`), noQuotes);
    case 'boolean':
    case sql.Bit:
      if (IS_POSTGRES) {
        if (typeof value === 'string') {
          return /^(0|no|false|ложь)$/i.test(value) ? 'false' : 'true';
        }
        return value ? 'true' : 'false';
      }
      if (typeof value === 'string') {
        return /^(0|no|false|ложь)$/i.test(value) ? '0' : '1';
      }
      return value ? '1' : '0';

    case sql.TinyInt:
      return prepareNumber(0, 255);
    case 'smallint':
    case sql.SmallInt:
      return prepareNumber(-32768, 32767);
    case 'int':
    case sql.Int:
    case 'integer':
      return prepareNumber(-2147483648, 2147483647);
    case sql.BigInt:
      // eslint-disable-next-line no-loss-of-precision
      return prepareNumber(-9223372036854775808, 9223372036854775807);
    case 'number':
    case sql.Decimal:
    case sql.Float:
    case sql.Money:
    case sql.Numeric:
    case sql.SmallMoney:
    case sql.Real:
      if (value == null) {
        if (nullable) {
          return 'NULL';
        }
        return (default_ || default_ === 0) ? `${default_}` : null;
      }
      return `${value}`;
    case sql.Binary:
    case sql.VarBinary:
    case sql.Image:
      if (value == null) {
        if (nullable) {
          return 'NULL';
        }
        if (!default_) return null;
      }
      return binToHexString(value);
    case sql.UDT:
    case sql.Geography:
    case sql.Geometry:
    case sql.Variant:
      return prepareSqlString(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
    case 'array': {
      let arr: any[] = [];
      if (Array.isArray(value) && value.length) {
        switch (arrayType) {
          case 'int':
          case 'integer':
            arr = value.map((v) => prepareNumber(-2147483648, 2147483647, v));
            break;
          // case 'string':
          default:
            arr = value.map((v) => prepareSqlString(v, nullable, length, undefined, true, false))
              .filter((v) => !!v)
              .map((v) => `"${v}"`);
            break;
        }
      }
      if (arr.length) {
        return `{${arr.join(',')}`;
      }
      return '{}';
    }
    default:
      return prepareSqlString(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
  }
};

/**
 * Подготовка значений записи для использования в SQL
 *
 * Все поля записи обрабатываются функцией getValueForSQL
 */
export const prepareRecordForSQL = (
  // запись для вставки/обновления таблицы БД
  record: TDBRecord,
  // объект описания структуры таблицы
  recordSchema: TRecordSchema,
  // Для полей, не допускающих NULL будет добавлено наиболее подходящее значение
  addValues4NotNullableFields?: boolean,
  // Если TRUE - в записи добавляются пропущенные поля со значениями NULL, '', ...
  addMissingFields?: boolean,
  // Флаг необходимости валидации значений записи
  validate?: boolean,
  escapeOnlySingleQuotes?: boolean,
) => {
  recordSchema.forEach((fieldSchema: IFieldSchema) => {
    const { name = '_#foo#_' } = fieldSchema;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      record[name] = getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes);
    } else if ((!fieldSchema.nullable && addValues4NotNullableFields) || addMissingFields) {
      record[name] = getValueForSQL(null, fieldSchema, validate, escapeOnlySingleQuotes);
    }
  });
};

/**
 * Подготовка данных для SQL
 *
 * Все поля всех записей обрабатываются функцией getValueForSQL
 */
export const prepareDataForSQL = (
  // массив объектов - записей для вставки/обновления таблицы БД
  recordSet: TRecordSet,
  // объект описания структуры таблицы
  recordSchema: TRecordSchema,
  // Для полей, не допускающих NULL будет добавлено наиболее подходящее значение
  addValues4NotNullableFields?: boolean,
  // Если TRUE - в записи добавляются пропущенные поля со значениями NULL, '', ...
  addMissingFields?: boolean,
  // Флаг необходимости валидации значений
  validate?: boolean,
  escapeOnlySingleQuotes?: boolean,
) => {
  if (recordSet._isPreparedForSQL) {
    return;
  }
  recordSet.forEach((record) => {
    prepareRecordForSQL(
      record,
      recordSchema,
      addValues4NotNullableFields,
      addMissingFields,
      validate,
      escapeOnlySingleQuotes,
    );
  });
  recordSet._isPreparedForSQL = true;
};

/**
 * Возвращает рекорд, в котором все значения преобразованы в строки и подготовлены для прямой вставки в SQL
 * В частности, если значение типа строка, то оно уже заключено в одинарные кавычки
 */
export const getRecordValuesForSQL = (record: TDBRecord, recordSchema: TRecordSchema): TDBRecord => {
  const recordValuesForSQL = {};
  const validate = undefined;
  const escapeOnlySingleQuotes = true;
  recordSchema.forEach((fieldSchema) => {
    const { name = '_#foo#_' } = fieldSchema;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      recordValuesForSQL[name] = getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes);
    }
  });
  return recordValuesForSQL;
};

/**
 * Возвращает схему полей таблицы БД. Либо в виде объекта, либо в виде массива
 * Если asArray = true, то вернет TRecordSchema, при этом удалит поля, указанные в omitFields
 * Иначе вернет TRecordSchemaAssoc
 */
export const getRecordSchema3 = async (
  // ID соединения (borf|cep|hr|global)
  connectionId: string,
  // Субъект в выражении FROM для таблицы, схему которой нужно вернуть
  schemaAndTable: string,
  // Массив имен полей, которые нужно удалить из схемы (не уитывается, если asArray = false)
  options: TGetRecordSchemaOptions = {} as TGetRecordSchemaOptions,
) => {
  const propertyPath = `schemas.${connectionId}.${schemaAndTable}`;

  let result = cache.get(propertyPath);
  if (result) {
    return result;
  }
  const {
    omitFields,
    pickFields,
    fieldTypeCorrection,
    mergeRules: {
      mergeIdentity = [],
      excludeFromInsert = [],
      noUpdateIfNull = false,
      correction: mergeCorrection,
      withClause,
    } = {},
    noReturnMergeResult,
  } = options;
  const cPool = await db.getPoolConnection(connectionId, { prefix: 'getRecordSchema' });
  const request = new sql.Request(cPool);
  request.stream = false;
  let res: IResult<any>;
  try {
    res = await request.query(`${'SELECT'} TOP (1) * FROM ${schemaAndTable}`);
  } catch (err) {
    echo.mErr(err, {
      lb: 2,
      msg: `getRecordSchema SQL ERROR`,
      thr: 1,
    });
    return;
  }
  const { columns } = res.recordset;
  let schemaAssoc = Array.isArray(omitFields) ? _.omit(columns, omitFields) : columns;
  schemaAssoc = Array.isArray(pickFields) ? _.pick(schemaAssoc, pickFields) : schemaAssoc;
  correctRecordSchema(schemaAssoc, fieldTypeCorrection);
  const schema = _.map(schemaAssoc, (fo) => (fo))
    .sort((a, b) => {
      if (a.index > b.index) return 1;
      if (a.index < b.index) return -1;
      return 0;
    });
  const fields = schema.map(({ name }) => (name));
  const fieldsList = fields.map((fName) => `[${fName}]`)
    .join(', ');

  const onClause = `(${mergeIdentity.map((fName) => (`target.[${fName}] = source.[${fName}]`))
    .join(' AND ')})`;
  const insertFields = fields.filter((fName) => (!excludeFromInsert.includes(fName)));
  const insertSourceList = insertFields.map((fName) => (`source.[${fName}]`))
    .join(', ');
  const insertFieldsList = insertFields.map((fName) => `[${fName}]`)
    .join(', ');
  const updateFields = fields.filter((fName) => (!mergeIdentity.includes(fName)));
  let updateFieldsList: string;
  if (noUpdateIfNull) {
    updateFieldsList = updateFields.map((fName) => (`target.[${fName}] = COALESCE(source.[${fName}], target.[${fName}])`)).join(', ');
  } else {
    updateFieldsList = updateFields.map((fName) => (`target.[${fName}] = source.[${fName}]`)).join(', ');
  }
  const dbConfig: IDBConfig = db.getDbConfig(connectionId) as IDBConfig;
  const dbSchemaAndTable = `[${dbConfig.database}].${schemaAndTable}`;

  result = {
    connectionId,
    dbConfig,
    schemaAndTable,
    dbSchemaAndTable,
    columns,
    schemaAssoc,
    schema,
    fields,
    insertFields,
    insertFieldsList,
    withClause,
    updateFields,
    mergeIdentity,
    getMergeSQL (packet: TRecordSet, prepareOptions: IGetMergeSQLOptions = {}) {
      const { preparePacket, addValues4NotNullableFields, addMissingFields, validate } = prepareOptions;
      if (preparePacket) {
        prepareDataForSQL(packet, this.schema, addValues4NotNullableFields, addMissingFields, validate);
      }
      const values = `(${packet.map((r) => (fields.map((fName) => (r[fName]))
        .join(',')))
        .join(`)\n,(`)})`;
      let mergeSQL = `
MERGE ${schemaAndTable} ${withClause || ''} AS target
USING
(
    SELECT * FROM
    ( VALUES
        ${values}
    )
    AS s (
    ${fieldsList}
    )
)
AS source
ON ${onClause}
WHEN MATCHED THEN
    UPDATE SET
        ${updateFieldsList}
    WHEN NOT MATCHED THEN
        INSERT (
        ${insertFieldsList}
        )
        VALUES (
        ${insertSourceList}
        )`;
      if (!noReturnMergeResult) {
        mergeSQL = `
${'DECLARE'} @t TABLE ( act VARCHAR(20));
DECLARE @total AS INTEGER;
DECLARE @i AS INTEGER;
DECLARE @u AS INTEGER;
${mergeSQL}
OUTPUT $action INTO @t;
SET @total = @@ROWCOUNT;
SELECT @i = COUNT(*) FROM @t WHERE act = 'INSERT';
SELECT @u = COUNT(*) FROM @t WHERE act != 'INSERT';
SELECT @total as total, @i as inserted, @u as updated;
`;
      } else {
        mergeSQL += `;\n`;
      }
      return typeof mergeCorrection === 'function' ? mergeCorrection(mergeSQL) : mergeSQL;
    },

    getInsertSQL (packet: TRecordSet, addOutputInserted = false) {
      if (!Array.isArray(packet)) {
        packet = [packet];
      }
      const values = `(${packet.map((r) => (insertFields.map((fName) => (r[fName] === undefined ? 'NULL' : r[fName]))
        .join(',')))
        .join(`)\n,(`)})`;
      return `INSERT INTO ${schemaAndTable} (${insertFieldsList}) ${addOutputInserted ? ' OUTPUT inserted.* ' : ''} VALUES ${values}`;
    },

    getUpdateSQL (record: TRecordSet) {
      const recordForSQL = getRecordValuesForSQL(record, this.schema);
      const setArray: string[] = [];
      updateFields.forEach((fName) => {
        if (recordForSQL[fName] !== undefined) {
          setArray.push(`[${fName}] = ${recordForSQL[fName]}`);
        }
      });
      const where = `(${mergeIdentity.map((fName) => (`[${fName}] = ${recordForSQL[fName]}`))
        .join(' AND ')})`;
      return `UPDATE ${schemaAndTable}
              SET ${setArray.join(', ')}
              WHERE ${where};`;
    },
  };

  cache.put(propertyPath, result);
  return result;
};

/**
 * Оборачивает инструкции SQL в транзакцию
 * @param {string} strSQL
 * @returns {string}
 */
export const wrapTransaction = (strSQL: string) => `BEGIN TRY
    BEGIN TRANSACTION;

    ${strSQL}

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @ErrorMessage  NVARCHAR(MAX)
          , @ErrorSeverity INT
          , @ErrorState    INT;

    SELECT
        @ErrorMessage = ERROR_MESSAGE() + ' Line ' + CAST(ERROR_LINE() AS NVARCHAR(5))
      , @ErrorSeverity = ERROR_SEVERITY()
      , @ErrorState = ERROR_STATE();

    IF @@trancount > 0
    BEGIN
        ROLLBACK TRANSACTION;
    END;

    RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
END CATCH;`;

/**
 * Возвращает проверенное и серилизованное значение
 */
export const serialize = (value: any, fieldSchema: IFieldSchema): string | number | null => {
  const val = getValueForSQL(value, fieldSchema);
  if (val == null || val === 'NULL') {
    return null;
  }
  if (typeof val === 'number') {
    return val;
  }
  return String(val)
    .replace(/(^')|('$)/g, '');
};

/**
 * Возвращает дату в формате 'YYY-MM-DD'
 *
 * quotes - Если true - строка оборачивается в одинарные кавычки
 */
export const startOfDate = (val: string | Date, quotes: boolean = false): string | null => {
  const date = moment(val);
  if (!date.isValid()) {
    return quotes ? 'NULL' : null;
  }
  val = date.format('YYYY-MM-DD');
  return quotes ? `'${val}'` : val;
};

/**
 * Возвращает дату в формате 'YYY-MM-DDT23:59:59.999'
 *
 * val - дата-время строкой или Data
 * quotes - Если true - строка оборачивается в одинарные кавычки
 */
export const endOfDate = (val: string | Date, quotes: boolean = false): string | null => {
  const date = moment(val);
  if (!date.isValid()) {
    return quotes ? 'NULL' : null;
  }
  val = date.format('YYYY-MM-DDT23:59:59.999');
  return quotes ? `'${val}'` : val;
};

/**
 * Возвращает подготовленное выражение SET для использования в UPDATE
 */
export const getSqlSetExpression = (record: TDBRecord, recordSchema: TRecordSchema): string => {
  const setArray: string[] = [];
  const validate = undefined;
  const escapeOnlySingleQuotes = true;
  recordSchema.forEach((fieldSchema) => {
    const { name = '_#foo#_' } = fieldSchema;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      setArray.push(`[${name}] = ${getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes)}`);
    }
  });
  return `SET ${setArray.join(', ')}`;
};

/**
 * Возвращает подготовленное выражение (...поля...) VALUES (...значения...) для использования в INSERT
 *
 * addOutputInserted - Если true, добавляется выражение OUTPUT inserted.* перед VALUES
 */
export const getSqlValuesExpression = (record: TDBRecord, recordSchema: TRecordSchema, addOutputInserted: boolean = false): string => {
  const fieldsArray: string[] = [];
  const valuesArray: string[] = [];
  const validate = undefined;
  const escapeOnlySingleQuotes = true;
  recordSchema.forEach((fieldSchema) => {
    const { name = '_#foo#_' } = fieldSchema;
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      fieldsArray.push(name);
      valuesArray.push(String(getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes)));
    }
  });
  return `([${fieldsArray.join('], [')}]) ${addOutputInserted ? ' OUTPUT inserted.* ' : ''} VALUES (${valuesArray.join(', ')})`;
};

export const getRowsAffected = (qResult: any) => (qResult.rowsAffected && qResult.rowsAffected.reduce((a: number, v: number) => a + v, 0)) || 0;

/**
 * @deprecated since version 2.0.0
 * Преобразование объекта метаданных <queryResult>.recordset.columns в массив,
 * упорядоченный по порядку следования полей в БД
 */
export const recordSchemaToArray = (
  recordSchemaAssoc: TRecordSchemaAssoc,
  // массив имен полей, которые нужно удалить из схемы
  omitFields: string[] = [],
  fieldTypeCorrection: TFieldTypeCorrection = {},
  // массив имен полей, которые нужно оставить в схеме
  pickFields: string[] = [],
): TRecordSchema => {
  _.each(fieldTypeCorrection, (type, fieldName) => {
    recordSchemaAssoc[fieldName].type = type;
  });
  _.each(recordSchemaAssoc, (item, name) => {
    if (/_json$/i.test(name) || /[a-z\d]Json$/.test(name)) {
      item.type = 'json';
    }
  });
  let recordSchema = _.map(recordSchemaAssoc, (fo) => (fo))
    .sort((a: any, b: any) => {
      if (a.index > b.index) return 1;
      if (a.index < b.index) return -1;
      return 0;
    })
    .filter((value: any) => !omitFields.includes(value.name));
  if (Array.isArray(pickFields)) {
    recordSchema = recordSchema.filter((value: any) => pickFields.includes(value.name));
  }
  return recordSchema;
};

Object.assign(sql, {
  setTimeZone,
  s: prepareSqlString,
  DEF_UID: '00000000-0000-0000-0000-000000000000',
  correctRecordSchema,
  getRecordSchema3,
  binToHexString,
  wrapTransaction,
  getValueForSQL,
  serialize,
  startOfDate,
  endOfDate,
  getRecordValuesForSQL,
  getSqlSetExpression,
  getSqlValuesExpression,
  prepareRecordForSQL,
  prepareDataForSQL,
  getRowsAffected,
  recordSchemaToArray,
});
