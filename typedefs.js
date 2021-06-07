/* eslint-disable max-len */
// https://github.com/google/closure-compiler/wiki/A-word-about-the-type-Object

// =============================== scalars =====================================

/**
 * Имя поля БД
 *
 * @typedef {String} dbFieldName
 */

/**
 * Значение ключевого поля записи БД
 *
 * @typedef {String|Number} dbRecordKey
 */

// =============================== schemas =====================================

/**
 * Метаинформация о поле БД
 * @typedef {Object} dbFieldSchema
 *
 * @property {Number} index
 * @property {String} name
 * @property {Number} length
 * @property {sql.TYPES} type
 * @property {Number} scale
 * @property {Number} precision
 * @property {Boolean} nullable
 * @property {Boolean} caseSensitive
 * @property {Boolean} identity
 * @property {Boolean} excludeFromInsert
 * @property {Boolean} readOnly
 * @property {String} inputDateFormat
 * @property {*} default_
 * @property {Boolean} ignoreTZ - игнорировать указание на таймзону в строке, содержащей дату (при разборе в функции getValueForSQL)
 */

/**
 * Метаинформация для формирования инструкции SQL  MERGE
 * @typedef {Object} mergeRules
 *
 * @property {dbFieldName[]} mergeIdentity - массив имен полей, идентифицирующих запись, используемый в выражении ON в MERGE
 * @property {dbFieldName[]} excludeFromInsert - массив имен полей, исключаемых из списка при вставке в MERGE. Обычно это автоинкрементное поле.
 * @property {Boolean} noUpdateIfNull - если true - старые не нулевые значения полей не будут перезаписаны нулами при апдейте
 */

/**
 * Массив объектов с метаинформацией о полях
 *
 * @typedef {dbFieldSchema[]} dbRecordSchema
 */

/**
 * Метаинформацией о полях, проиндексированная именами полей. (sql.recordset.columns)
 *
 * @typedef {Object<dbFieldName, dbFieldSchema>} dbRecordSchemaAssoc
 */

/**
 * Объект корректировки типов полей. Наименованию поля соответствует новый тип.
 *
 * @typedef {Object<dbFieldName, dbFieldSchema>} fieldTypeCorrection
 * В частности, используется для полей, хранящих знаяения типа json в поле типа varchar(max)
 * тогда необходимо явно задать тип поля "json". Если имя поля заканчивается на _json, коррекция типа произойдет автоматически.
 * Также используется для указания входного формата для преобразования строки в тип datetime (свойство inputDateFormat в схеме поля)
 */

// =============================== records =====================================

/**
 * Запись БД. Объект, проиндексированный именами полей. Значения - значения полей
 *
 * @typedef {Object<dbFieldName, *>} dbRecord
 */

/**
 * Массив записей БД
 *
 * @typedef {dbRecord[]} dbRecordSet
 *
 * @property {boolean} _isPreparedForSQL - Признак того, что значения полей подготовлены для использования в строке SQL
 */

/**
 * Пакет записей БД.
 * Объект, проиндексированный алиасами. Каждый подобъект содержит dbRecord.
 *
 * @typedef {Object<dbRecordKey, dbRecord>} dbRecordSetAssoc
 */

// ============================ proto records ==================================

/**
 * Индекс поля БД из мета-информации в формате proto3
 *
 * @typedef {Number} dbFieldIndexProto
 */

/**
 * Запись БД,
 * проиндексированная номерами полей из описания в формате proto3. Значения - значения полей
 *
 * @typedef {Object<dbFieldIndexProto, *>} dbRecordProto
 */

/**
 * Пакет записей БД.
 * Объект, проиндексированный алиасами. Каждый подобъект содержит dbRecord.
 *
 * @typedef {dbRecordProto[]} dbRecordSetProto
 */

// =============================== changes =====================================

/**
 * Информация о старом и новом значении поля
 *
 * @typedef {Object} dbFieldChangeInfo
 *
 * @property {*} o - старое значение
 * @property {*} n - новое значение
 */

/**
 * Информация об изменениях записи БД
 * Объект, проиндексированный именами полей. Подобъекты содержат информацию о старом и новом значении поля.
 *
 * @typedef {Object<dbFieldName, dbFieldChangeInfo>} dbRecordChanges
 */

/**
 * Информация об изменениях пакета записей БД
 * Объект, индексированный алиасами. Каждый подобъект содержит информацию об изменениях в записи БД.
 *
 * @typedef {!Object<dbRecordKey, dbRecordChanges>} dbRecordSetChangesAssoc
 */

// ===== ====

/**
 * @typedef {Object} mergeResultType
 *
 * @property {Number} total - кол-во затронутых записей
 * @property {Number} inserted - кол-во добавленных записей
 * @property {Number} updated - кол-во измененых записей
 */

// ===== proto ====

/**
 * Информация об изменениях записи БД
 * Объект, проиндексированный прото-индексами полей. Подобъекты содержат информацию о старом и новом значении поля.
 *
 * @typedef {Object<dbFieldIndexProto, dbFieldChangeInfo>} dbRecordChangesProto
 */

/**
 * Информация об изменениях пакета записей БД. Объект, индексирован алиасами.
 *
 * @typedef {!Object<dbRecordKey, dbRecordChangesProto>} dbRecordSetChangesProtoAssoc
 */

/**
 * @typedef {Object} getRecordSchemaOptions
 *
 * @property {String[]} omitFields  - массив имен полей, которые нужно удалить из схемы (не уитывается, если asArray = false)
 * @property {String[]} pickFields - массив имен полей, которые нужно оставить в схеме
 * @property {fieldTypeCorrection} fieldTypeCorrection
 */

/**
 * Greeting config
 * @typedef {Object} dbConnection
 *
 * @property {sql} sql
 * @property {sql.ConnectionPool} pool
 */
