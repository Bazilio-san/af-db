// noinspection SqlResolve
/* eslint-disable max-len */
/* eslint-disable no-console */

const config = require('config');
const sql = require('mssql');
const moment = require('moment-timezone');
const _ = require('lodash');
const cache = require('memory-cache');
const U = require('af-fns');
const echo = require('af-echo');

const timezone = config.get('timezone');
moment.tz.setDefault(timezone);

const { database: { dialect = 'mssql' } = {} } = config;
const IS_POSTGRES = dialect === 'postgres';
/**
 * Оборачивает строку в одинарные кавычки, если второй аргумент не true
 * @param {String} val
 * @param {boolean} noQuotes
 * @returns {string}
 */
const q = (val, noQuotes) => (noQuotes ? val : `'${val}'`);

/**
 * Изменение timezone объекта moment этого модуля.
 * Влияет на время, которое парсится из строки в функции getValueForSQL()
 * Функция используется для целей тестирования.
 * @param tz
 */
sql.setTimeZone = (tz) => {
    moment.tz.setDefault(tz);
};

/**
 * Подготовка строки для передачи в SQL
 *
 * @param {String|Number|Null} str - значение, которое нужно подготовить для передачи в SQL
 * @param {boolean|Number}     nullable - подставлять NULL, если значение пусто или пустая строка.
 * @param {Number}             len - ограничение на длину поля. Если передано, строка урезается
 * @param {String} default_    Значение, которое будет подставлено, если передано пустое значение и nullable = false
 * @param {boolean} noQuotes
 * @param {boolean} escapeOnlySingleQuotes
 * @returns {string}
 */
sql.s = (str, nullable = false, len = 0, default_ = null, noQuotes, escapeOnlySingleQuotes = false) => {
    str = (String(str || '')).trim();
    if (!str) {
        if (nullable) return 'NULL';
        return default_ ? q(default_, noQuotes) : null;
    }
    str = U.se(str, escapeOnlySingleQuotes);
    if (len > 0) {
        str = str.substr(0, len);
    }
    return q(str, noQuotes);
};

sql.DEF_UID = '00000000-0000-0000-0000-000000000000';

const FIELD_SCHEMA_PROPS = ['index', 'name', 'length', 'type', 'scale', 'precision', 'nullable', 'caseSensitive',
    'identity', 'mergeIdentity', 'readOnly', 'inputDateFormat', 'default_'];

/**
 * Корректировка схемы таблицы
 * Поля с суфиксом _json получают тип "json". Остальные корректировки берутся из fieldTypeCorrection
 * Например, для полей типа datetime можно передавать свойство inputDateFormat
 *
 * @param {dbRecordSchemaAssoc} recordSchemaAssoc
 * @param {fieldTypeCorrection} fieldTypeCorrection - объект корректировок
 */
sql.correctRecordSchema = (recordSchemaAssoc, fieldTypeCorrection) => {
    _.each(recordSchemaAssoc, (fieldSchema, fieldName) => {
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
        _.each(fieldTypeCorrection, (correction, fieldName) => {
            FIELD_SCHEMA_PROPS.forEach((prop) => {
                if (correction[prop] !== undefined) {
                    if (!recordSchemaAssoc[fieldName]) {
                        recordSchemaAssoc[fieldName] = {};
                    }
                    recordSchemaAssoc[fieldName][prop] = correction[prop];
                }
            });
        });
    }
};

/**
 * Возвращает схему полей таблицы БД. Либо в виде объекта, либо в виде массива
 * Если asArray = true, то вернет dbRecordSchema, при этом удалит поля, указанные в omitFields
 * Инае вернет dbRecordSchemaAssoc
 *
 * @param {String} connectionId - ID соединения (borf|cep|hr|global)
 * @param {String} schemaAndTable субъект в выражении FROM для таблицы, схему которой нужно вернуть
 * @param {getRecordSchemaOptions} options  - массив имен полей, которые нужно удалить из схемы (не уитывается, если asArray = false)
 * @returns {Object}
 */
sql.getRecordSchema3 = async (connectionId, schemaAndTable, options = {}) => {
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
            withClause
        } = {}
    } = options;
    const cPool = await module.exports.db.getPoolConnection(connectionId, 'getRecordSchema');
    const request = new sql.Request(cPool);
    request.stream = false;
    let res;
    try {
        res = await request.query(`SELECT TOP (1) *
                                   FROM ${schemaAndTable}`);
    } catch (err) {
        echo.mErr(err, {
            lb: 2,
            msg: `getRecordSchema SQL ERROR`,
            thr: 1
        });
    }
    const { columns } = res.recordset;
    let schemaAssoc = Array.isArray(omitFields) ? _.omit(columns, omitFields) : columns;
    schemaAssoc = Array.isArray(pickFields) ? _.pick(schemaAssoc, pickFields) : schemaAssoc;
    sql.correctRecordSchema(schemaAssoc, fieldTypeCorrection);
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
    let updateFieldsList;
    if (noUpdateIfNull) {
        updateFieldsList = updateFields.map(
            (fName) => (`target.[${fName}] = COALESCE(source.[${fName}], target.[${fName}])`)
        )
            .join(', ');
    } else {
        updateFieldsList = updateFields.map((fName) => (`target.[${fName}] = source.[${fName}]`))
            .join(', ');
    }
    const dbConfig = module.exports.db.getDbConfig(connectionId);
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
        getMergeSQL (packet, prepareOoptions = {}) {
            const {
                preparePacket = false,
                addValues4NotNullableFields = false,
                addMissingFields = false,
                validate = false
            } = prepareOoptions;
            if (preparePacket) {
                sql.prepareDataForSQL(packet, this.schema, addValues4NotNullableFields, addMissingFields, validate);
            }
            const values = `(${packet.map((r) => (fields.map((fName) => (r[fName]))
                .join(',')))
                .join(`)\n,(`)})`;
            const mergeSQL = `
${'DECLARE'} @t TABLE ( act VARCHAR(20));
DECLARE @total AS INTEGER;
DECLARE @i AS INTEGER;
DECLARE @u AS INTEGER;
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
        )
OUTPUT $action INTO @t;
SET @total = @@ROWCOUNT;
SELECT @i = COUNT(*) FROM @t WHERE act = 'INSERT';
SELECT @u = COUNT(*) FROM @t WHERE act != 'INSERT';
SELECT @total as total, @i as inserted, @u as updated;
                `;
            return typeof mergeCorrection === 'function' ? mergeCorrection(mergeSQL) : mergeSQL;
        },
        getInsertSQL (packet, addOutputInserted = false) {
            if (!Array.isArray(packet)) {
                packet = [packet];
            }
            const values = `(${packet.map((r) => (insertFields.map((fName) => (r[fName] === undefined ? 'NULL' : r[fName]))
                .join(',')))
                .join(`)\n,(`)})`;
            return `INSERT INTO ${schemaAndTable} (${insertFieldsList}) ${addOutputInserted ? ' OUTPUT inserted.* ' : ''} VALUES ${values}`;
        },
        getUpdateSQL (record) {
            const recordForSQL = sql.getRecordValuesForSQL(record, this.schema);
            const setArray = [];
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
        }
    };

    cache.put(propertyPath, result);
    return result;
};

sql.binToHexString = (value) => {
    if (!value) {
        return null;
    }
    return `0x${value.toString('hex')
        .toUpperCase()}`;
};

/**
 * Оборачивает инструкции SQL в транзакцию
 * @param {string} strSQL
 * @returns {string}
 */
sql.wrapTransaction = (strSQL) => `BEGIN TRY
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
 * Возвращает значение, готовое для использования в строке SQL запроса
 * @param {*} value
 * @param {dbFieldSchema} fieldSchema
 * @param {Boolean} validate - Флаг необходимости валидации значения
 * @param {Boolean} escapeOnlySingleQuotes
 * @returns {String|Number}
 */
sql.getValueForSQL = (value, fieldSchema, validate = false, escapeOnlySingleQuotes = false) => {
    if (typeof fieldSchema === 'string') {
        fieldSchema = { type: fieldSchema };
    }
    const {
        type,
        arrayType,
        length = 0,
        scale,
        nullable = true,
        inputDateFormat,
        default_,
        noQuotes,
        name,
        escapeOnlySingleQuotes: eosq
    } = fieldSchema;
    let val;

    escapeOnlySingleQuotes = escapeOnlySingleQuotes || eosq;

    function prepareNumber (min, max, value_ = value) {
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
            return sql.s(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
        case 'string':
        case sql.Char:
        case sql.NChar:
        case sql.Text:
        case sql.NText:
        case sql.VarChar:
        case sql.NVarChar:
        case sql.Xml:
            return sql.s(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
        case 'uid':
        case 'uuid':
        case 'uniqueIdentifier':
        case sql.UniqueIdentifier:
            if (!value || typeof value !== 'string' || !/^[A-F\d]{8}(-[A-F\d]{4}){4}[A-F\d]{8}/i.test(value)) {
                value = null;
            } else {
                value = value.substr(0, 36)
                    .toUpperCase();
            }
            return sql.s(value, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
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
                return sql.s(null, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
            }
            if (fieldSchema.ignoreTZ) {
                let offset = val._tzm;
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
                    return q(val.format(`YYYY-MM-DDTHH:mm:ss.SSS0`)
                        .substr(0, 23), noQuotes);
                case 'time':
                case sql.Time:
                    return q(val.format('HH:mm:ss.SSS0')
                        .substr(0, 12), noQuotes);
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
                return sql.s(null, nullable, 0, default_, noQuotes, escapeOnlySingleQuotes);
            }
            if (scale > 3 && typeof value === 'string') {
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
            return sql.binToHexString(value);
        case sql.UDT:
        case sql.Geography:
        case sql.Geometry:
        case sql.Variant:
            return sql.s(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
        case 'array': {
            let arr = [];
            if (Array.isArray(value) && value.length) {
                switch (subType) {
                    case 'int':
                    case 'integer':
                        arr = value.map((v) => prepareNumber(-2147483648, 2147483647, v));
                        break;
                    // case 'string':
                    default:
                        arr = value.map((v) => sql.s(v, nullable, length, undefined, true, false))
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
            return sql.s(value, nullable, length, default_, noQuotes, escapeOnlySingleQuotes);
    }
};

/**
 * Возвращает проверенное и серилизованное значение
 * @param {*} value
 * @param {dbFieldSchema} fieldSchema
 * @returns {String|Number}
 */
sql.serialize = (value, fieldSchema) => {
    const val = sql.getValueForSQL(value, fieldSchema);
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
 * @param {String|Date} val - дата-время строкой или Data
 * @param {Boolean} quotes - Если true - строка оборачивается в одинарные кавычки
 * @returns {String}
 */
sql.startOfDate = (val, quotes = false) => {
    const date = moment(val);
    if (!date.isValid()) {
        return quotes ? 'NULL' : null;
    }
    val = date.format('YYYY-MM-DD');
    return quotes ? `'${val}'` : val;
};

/**
 * Возвращает дату в формате 'YYY-MM-DDT23:59:59.999'
 * @param {String|Date} val - дата-время строкой или Data
 * @param {Boolean} quotes - Если true - строка оборачивается в одинарные кавычки
 * @returns {String}
 */
sql.endOfDate = (val, quotes = false) => {
    const date = moment(val);
    if (!date.isValid()) {
        return quotes ? 'NULL' : null;
    }
    val = date.format('YYYY-MM-DDT23:59:59.999');
    return quotes ? `'${val}'` : val;
};

/**
 * Возвращает рекорд, в котором все значения преобразовыны в строки и подготовлены для прямой вставки в SQL
 * В частности, если значение типа строка, то оно уже заключено в одинарные кавычки
 *
 * @param {dbRecord} record
 * @param {dbRecordSchema} recordSchema
 * @returns {dbRecord}
 */
sql.getRecordValuesForSQL = (record, recordSchema) => {
    const recordValuesForSQL = {};
    const validate = undefined;
    const escapeOnlySingleQuotes = true;
    recordSchema.forEach((fieldSchema) => {
        const { name } = fieldSchema;
        if (Object.prototype.hasOwnProperty.call(record, name)) {
            recordValuesForSQL[name] = sql.getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes);
        }
    });
    return recordValuesForSQL;
};

/**
 * Возвращает подготовленное выражение SET для использования в UPDATE
 * @param {dbRecord} record
 * @param {dbRecordSchema} recordSchema
 * @returns {string}
 */
sql.getSqlSetExpression = (record, recordSchema) => {
    const setArray = [];
    const validate = undefined;
    const escapeOnlySingleQuotes = true;
    recordSchema.forEach((fieldSchema) => {
        const { name } = fieldSchema;
        if (Object.prototype.hasOwnProperty.call(record, name)) {
            setArray.push(`[${name}] = ${sql.getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes)}`);
        }
    });
    return `SET ${setArray.join(', ')}`;
};

/**
 * Возвращает подготовленное выражение (...поля...) VALUES (...значения...) для использования в INSERT
 * @param {dbRecord} record
 * @param {dbRecordSchema} recordSchema
 * @param {Boolean} addOutputInserted - Если true, добавляется выражение OUTPUT inserted.* перед VALUES
 * @returns {string}
 */
sql.getSqlValuesExpression = (record, recordSchema, addOutputInserted) => {
    const fieldsArray = [];
    const valuesArray = [];
    const validate = undefined;
    const escapeOnlySingleQuotes = true;
    recordSchema.forEach((fieldSchema) => {
        const { name } = fieldSchema;
        if (Object.prototype.hasOwnProperty.call(record, name)) {
            fieldsArray.push(name);
            valuesArray.push(sql.getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes));
        }
    });
    return `([${fieldsArray.join('], [')}]) ${addOutputInserted ? ' OUTPUT inserted.* ' : ''} VALUES (${valuesArray.join(', ')})`;
};

/**
 * Подготовка значений записи для использования в SQL
 *
 * Все поля записи обрабатываются функцией getValueForSQL
 *
 * @param {dbRecord} record - запись для вставки/обновления таблицы БД
 * @param {dbRecordSchema} recordSchema объект описания структуры таблицы
 * @param {Boolean} addValues4NotNullableFields Для полей, не допускающих NULL будет добавлено наиболее подходящее значение
 * @param {Boolean} addMissingFields - Если TRUE - в записи добавляются пропущенные поля со значениями NULL, '', ...
 * @param {Boolean} validate - Флаг необходимости валидации значений записи
 * @param {Boolean} escapeOnlySingleQuotes
 */
sql.prepareRecordForSQL = (
    record,
    recordSchema,
    addValues4NotNullableFields = false,
    addMissingFields = false,
    validate = false,
    escapeOnlySingleQuotes = false
) => {
    recordSchema.forEach((fieldSchema) => {
        const { name } = fieldSchema;
        if (Object.prototype.hasOwnProperty.call(record, name)) {
            record[name] = sql.getValueForSQL(record[name], fieldSchema, validate, escapeOnlySingleQuotes);
        } else if ((!fieldSchema.nullable && addValues4NotNullableFields) || addMissingFields) {
            record[name] = sql.getValueForSQL(null, fieldSchema, validate, escapeOnlySingleQuotes);
        }
    });
};

/**
 * Подготовка данных для SQL
 *
 * Все поля всех записей обрабатываются функцией getValueForSQL
 *
 * @param {dbRecordSet} recordSet - массив объектов - записей для вставки/обновления таблицы БД
 * @param {dbRecordSchema} recordSchema объект описания структуры таблицы
 * @param {Boolean} addValues4NotNullableFields Для полей, не допускающих NULL будет добавлено наиболее подходящее значение
 * @param {Boolean} addMissingFields - Если TRUE - в записи добавляются пропущенные поля со значениями NULL, '', ...
 * @param {Boolean} validate - Флаг необходимости валидации значений
 * @param {Boolean} escapeOnlySingleQuotes
 */
sql.prepareDataForSQL = (
    recordSet,
    recordSchema,
    addValues4NotNullableFields = false,
    addMissingFields = false,
    validate = false,
    escapeOnlySingleQuotes = false
) => {
    if (recordSet._isPreparedForSQL) {
        return;
    }
    recordSet.forEach((record) => {
        sql.prepareRecordForSQL(
            record,
            recordSchema,
            addValues4NotNullableFields,
            addMissingFields,
            validate,
            escapeOnlySingleQuotes
        );
    });
    recordSet._isPreparedForSQL = true;
};

sql.getRowsAffected = (qResult) => (qResult.rowsAffected && qResult.rowsAffected.reduce((a, v) => a + v, 0)) || 0;

sql.on('error', (err) => {
    echo.error('SQL-ERROR', err);
});

const pools = {};

const db = {
    getDbConfig: (connectionId) => config.get(`database.${connectionId}`),

    /**
     * @typedef {Object} getPoolConnectionOptions
     *
     * @param {String} [prefix] - Префикс в сообщении о закрытии пула (название синхронизации)
     * @param {String} [onError] - что делать при ошибке соединения:
     *      'exit' - завершить скрипт,
     *      'throw' - бросить исключение.
     *      Если не задано - только сообщать в консоль.
     */

    /**
     * Возвращает пул соединений для БД, соответстующей преданному ID соединения (borf|cep|hr|global)
     * В случае, если не удается создать пул или открыть соединение, прерывает работу скрипта
     * @param {String} connectionId
     * @param {getPoolConnectionOptions} options
     * @returns {sql.ConnectionPool}
     */
    getPoolConnection: async (connectionId, options = {}) => {
        const helpErr = new Error();
        const {
            prefix = '',
            onError
        } = options; // onError = [exit|throw]
        let lb = -4;
        try {
            let pool = pools[connectionId];
            if (pool) {
                return pool;
            }
            lb = -8;
            const cfg = config.database;
            const dbConfig = config.util.extendDeep({}, cfg._common_ || {}, cfg[connectionId]);
            lb = -12;
            pool = new sql.ConnectionPool(dbConfig);
            if (typeof pool !== 'object') {
                echo.error(prefix, `Cant create connection pool "${connectionId}"`);
                process.exit(0);
            }
            pools[connectionId] = pool;
            pool._connectionId = connectionId;
            pool.on('close', () => {
                delete pools[connectionId];
            });
            pool.on('error', (err) => {
                echo.error('POOL-ERROR', err);
            });
            lb = -27;
            await pool.connect();
            return pool;
        } catch (err) {
            const errMsg = `Cant connect to "${connectionId}" db`;
            if (onError === 'exit') {
                echo.error(prefix, `${errMsg}\n${err}\nEXIT PROCESS`);
                process.exit(0);
                return;
            }
            echo.mErr(err, {
                helpErr,
                lb,
                msg: errMsg,
                thr: onError === 'throw'
            });
        }
    },

    /**
     * Закрывает указанные соединения с БД
     *
     * @param {sql.ConnectionPool|sql.ConnectionPool[]} poolsToClose - пул или массив пулов
     * @param {String} prefix - Префикс в сообщении о закрытии пула (название синхронизации)
     * @param {Boolean} noEcho - подавление сообщений о закрытии соединения
     */
    close: (poolsToClose, prefix, noEcho = false) => {
        if (!Array.isArray(poolsToClose)) {
            poolsToClose = [poolsToClose];
        }
        for (let i = 0; i < poolsToClose.length; i++) {
            let pool = poolsToClose[i];
            let connectionId;
            if (pool) {
                if (typeof pool === 'string') {
                    connectionId = pool;
                    pool = pools[connectionId];
                } else if (typeof pool === 'object') {
                    connectionId = pool._connectionId;
                }
                if (connectionId) {
                    delete pools[connectionId];
                }
                if (pool && pool.close) {
                    pool.close();
                    if (!noEcho && connectionId) {
                        const msg = `pool "${connectionId}" closed`;
                        if (prefix) {
                            echo.info(prefix, msg);
                        } else {
                            echo.info(msg);
                        }
                    }
                }
            }
        }
    },

    /**
     * Закрывает все соединения с БД
     *
     * @param {String} prefix - Префикс в сообщении о закрытии пула (название синхронизации)
     * @param {Boolean} noEcho - подавление сообщений о закрытии соединения
     */
    closeAllConnections: (prefix, noEcho = false) => {
        const poolsToClose = _.map(pools, (p) => p);
        module.exports.db.close(poolsToClose, prefix, noEcho);
    },

    /**
     * Закрывает указанные соединения с БД и прерывает работу скрипта
     *
     * @param {sql.ConnectionPool|sql.ConnectionPool[]} poolsToClose - пул или массив пулов
     * @param {String} prefix - Префикс в сообщении о закрытии пула (название синхронизации)
     */
    closeAndExit: (poolsToClose, prefix) => {
        module.exports.db.close(poolsToClose, prefix);
        process.exit(0);
    },

    Request: async (connectionId, strSQL) => {
        const pool = await db.getPoolConnection(connectionId, { onError: 'throw' });
        const request = new sql.Request(pool);
        if (strSQL) {
            return request.query(strSQL);
        }
        return request;
    }
};

module.exports = {
    sql,
    db
};

/**
 * @deprecated since version 2.0.0
 * Преобразование объекта метаданных <queryResult>.recordset.columns в массив,
 * упорядоченный по порядку следования полей в БД
 *
 * @param {dbRecordSchemaAssoc} recordSchemaAssoc
 * @param {Array<String>} omitFields - массив имен полей, которые нужно удалить из схемы
 * @param {fieldTypeCorrection} fieldTypeCorrection
 * @param {Array<String>} pickFields - массив имен полей, которые нужно оставить в схеме
 * @returns {dbRecordSchema}
 */
sql.recordSchemaToArray = (recordSchemaAssoc, omitFields = [], fieldTypeCorrection = [], pickFields) => {
    _.each(fieldTypeCorrection, (type, fieldName) => {
        recordSchemaAssoc[fieldName].type = type;
    });
    _.each(recordSchemaAssoc, (item, name) => {
        if (/_json$/i.test(name) || /[a-z\d]Json$/.test(name)) {
            item.type = 'json';
        }
    });
    let recordSchema = _.map(recordSchemaAssoc, (fo) => (fo))
        .sort((a, b) => {
            if (a.index > b.index) return 1;
            if (a.index < b.index) return -1;
            return 0;
        })
        .filter((value) => !omitFields.includes(value.name));
    if (Array.isArray(pickFields)) {
        recordSchema = recordSchema.filter((value) => pickFields.includes(value.name));
    }
    return recordSchema;
};
