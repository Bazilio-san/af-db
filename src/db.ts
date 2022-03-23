import * as config from 'config';
import { ConnectionPool } from 'mssql';
import * as moment from 'moment-timezone';
import * as _ from 'lodash';
import { TGetPoolConnectionOptions } from './interfaces';

const sql = require('mssql');
const echo = require('af-echo');

const timezone = config.get('timezone') as string;
moment.tz.setDefault(timezone);

export const getFirstConfigId = () => Object.keys(config.get('database') || {}).filter((v) => !['dialect', '_common_'].includes(v))[0];
export const getDbConfig = (connectionId: string) => config.get(`database.${connectionId}`);

export const pools: {
  [poolId: string]: ConnectionPool
} = {};

/**
 * Возвращает пул соединений для БД, соответстующей преданному ID соединения (borf|cep|hr|global)
 * В случае, если не удается создать пул или открыть соединение, прерывает работу скрипта
 */
export const getPoolConnection = async (connectionId: string, options: TGetPoolConnectionOptions = {}): Promise<ConnectionPool | undefined> => {
  const helpErr = new Error();
  const {
    prefix = '',
    onError,
  } = options; // onError = [exit|throw]
  let lb = -4;
  try {
    let pool = pools[connectionId];
    if (pool) {
      return pool;
    }
    lb = -8;
    const cfg: any = config.get('database');
    const dbConfig = config.util.extendDeep({}, cfg._common_ || {}, cfg[connectionId]);
    lb = -12;
    pool = new sql.ConnectionPool(dbConfig);
    if (typeof pool !== 'object') {
      echo.error(prefix, `Cant create connection pool "${connectionId}"`);
      process.exit(0);
    }
    pools[connectionId] = pool;
    // @ts-ignore
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
      thr: onError === 'throw',
    });
  }
};

/**
 * Закрывает указанные соединения с БД
 *
 * poolsToClose - пул или массив пулов
 * prefix - Префикс в сообщении о закрытии пула (название синхронизации)
 * noEcho - подавление сообщений о закрытии соединения
 */
export const close = (poolsToClose: any | any[], prefix?: string, noEcho?: boolean) => {
  if (!Array.isArray(poolsToClose)) {
    poolsToClose = [poolsToClose];
  }
  for (let i = 0; i < poolsToClose.length; i++) {
    let pool = poolsToClose[i];
    let connectionId: string = '';
    if (pool) {
      if (typeof pool === 'string') {
        connectionId = pool;
        pool = pools[connectionId];
      } else if (typeof pool === 'object') {
        // @ts-ignore
        connectionId = pool._connectionId;
      }
      if (connectionId) {
        delete pools[connectionId];
      }
      if (pool && pool.close) {
        pool.close().then(() => {
          if (!noEcho && connectionId) {
            const msg = `pool "${connectionId}" closed`;
            if (prefix) {
              echo.info(prefix, msg);
            } else {
              echo.info(msg);
            }
          }
        });
      }
    }
  }
};

/**
 * Закрывает все соединения с БД
 *
 * prefix - Префикс в сообщении о закрытии пула (название синхронизации)
 * noEcho - подавление сообщений о закрытии соединения
 */
export const closeAllConnections = (prefix?: string, noEcho?: boolean) => {
  const poolsToClose = _.map(pools, (p) => p);
  close(poolsToClose, prefix, noEcho);
};

/**
 * Закрывает указанные соединения с БД и прерывает работу скрипта
 *
 * poolsToClose - пул или массив пулов
 * prefix - Префикс в сообщении о закрытии пула (название синхронизации)
 */
export const closeAndExit = (poolsToClose: ConnectionPool | ConnectionPool[], prefix?: string) => {
  close(poolsToClose, prefix);
  process.exit(0);
};

export const Request = async (connectionId: string, strSQL: string): Promise<any> => {
  const pool = await getPoolConnection(connectionId, { onError: 'throw' });
  const request = new sql.Request(pool);
  if (strSQL) {
    return request.query(strSQL);
  }
  return request;
};