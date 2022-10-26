/**
 * Имя поля БД
 */
export type TFieldName = string;

/**
 * Значение ключевого поля записи БД
 */
export type TRecordKey = string | number;

/**
 * Метаинформация о поле БД
 */
export interface IFieldSchema {
  index?: number,
  name?: string,
  length?: number,
  type?: any,
  arrayType?: any,
  scale?: number,
  precision?: number,
  nullable?: boolean,
  caseSensitive?: boolean,
  identity?: boolean,
  excludeFromInsert?: boolean,
  readOnly?: boolean,
  inputDateFormat?: string,
  default_?: any,
  // - игнорировать указание на таймзону в строке, содержащей дату (при разборе в функции getValueForSQL)
  ignoreTZ?: boolean,
  noQuotes?: boolean,
  escapeOnlySingleQuotes?: boolean,
}

/**
 * Массив объектов с метаинформацией о полях
 */
export type TRecordSchema = IFieldSchema[]

/**
 * Метаинформацией о полях, проиндексированная именами полей. (sql.recordset.columns)
 */
export interface TRecordSchemaAssoc {
  [fieldName: TFieldName]: IFieldSchema
}

/**
 * Объект корректировки типов полей. Наименованию поля соответствует новый тип.
 *
 * В частности, используется для полей, хранящих знаяения типа json в поле типа varchar(max)
 * тогда необходимо явно задать тип поля "json". Если имя поля заканчивается на _json, коррекция типа произойдет автоматически.
 * Также используется для указания входного формата для преобразования строки в тип datetime (свойство inputDateFormat в схеме поля)
 */
export interface TFieldTypeCorrection {
  [fieldName: TFieldName]: IFieldSchema
}
// =============================== records =====================================

/**
 * Запись БД. Объект, проиндексированный именами полей. Значения - значения полей
 */
export interface TDBRecord {
  [fieldName: TFieldName]: any
}

/**
 * Массив записей БД
 *
 * _isPreparedForSQL - Признак того, что значения полей подготовлены для использования в строке SQL
 */
export type TRecordSet = TDBRecord[] & {_isPreparedForSQL?: boolean}

/**
 * Пакет записей БД.
 * Объект, проиндексированный алиасами. Каждый подобъект содержит TDBRecord.
 */
export interface TRecordSetAssoc {
  [recordKey: TRecordKey]: TDBRecord
}

export interface TMergeResult {
  // кол-во затронутых записей
  total: number,
  // кол-во добавленных записей
  inserted: number,
  // кол-во измененных записей
  updated: number,
}

/**
 * Метаинформация для формирования инструкции SQL  MERGE
 */
export interface TMergeRules {
  // массив имен полей, идентифицирующих запись, используемый в выражении ON в MERGE
  mergeIdentity?: TFieldName[],
  // массив имен полей, исключаемых из списка при вставке в MERGE. Обычно это автоинкрементное поле.
  excludeFromInsert?: TFieldName[],
  // если true - старые не нулевые значения полей не будут перезаписаны нулами при апдейте
  noUpdateIfNull?: boolean,
  correction?: Function,
  withClause?: string,
}

export interface TGetRecordSchemaOptions {
  // массив имен полей, которые нужно удалить из схемы (не уитывается, если asArray = false)
  omitFields?: string[],
  // массив имен полей, которые нужно оставить в схеме
  pickFields?: string[],
  // кол-во измененных записей
  fieldTypeCorrection?: TFieldTypeCorrection,
  mergeRules?: TMergeRules,
  noReturnMergeResult?: boolean,
}

export interface TGetPoolConnectionOptions {
  // Префикс в сообщении о закрытии пула (название синхронизации)
  prefix?: string,
  // Что делать при ошибке соединения:
  // 'exit' - завершить скрипт,
  // 'throw' - бросить исключение.
  // Если не задано - только сообщать в консоль.
  onError?: 'exit' | 'throw'
  errorCode?: number
}

interface IDBConfigCommon {
  dialect: 'mssql' | 'pg',
  port: string | number | null,
  database: string,
  user: string,
  password: string,
}

interface IDBConfigMSSQL extends IDBConfigCommon {
  server: string,
}

interface IDBConfigPG extends IDBConfigCommon {
  host: string,
}

export type IDBConfig = IDBConfigMSSQL | IDBConfigPG

export interface IGetMergeSQLOptions{
  preparePacket?: boolean,
  addValues4NotNullableFields?: boolean,
  addMissingFields?: boolean,
  validate?: boolean,
}
