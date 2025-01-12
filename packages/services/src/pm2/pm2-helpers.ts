import { getServiceLogger } from '@watr/commonlib';
import pm2 from 'pm2';
import workerThreads, { parentPort } from 'worker_threads';
import process from 'process';
import path from 'path';

function pm2List(): Promise<pm2.ProcessDescription[]> {
  return new Promise<pm2.ProcessDescription[]>((resolve, reject) => {
    pm2.list(function (error: Error, ls: pm2.ProcessDescription[]) {
      if (error) {
        reject(error);
        return;
      }
      resolve(ls);
    });
  });
}

async function pm2Start(...args: Parameters<typeof pm2.start>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pm2.start(args[0], args[1], function (error: Error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
async function pm2Restart(proc: string | number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pm2.restart(proc, function (error: Error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function pm2Stop(proc: string | number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pm2.stop(proc, function (error: Error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function pm2Delete(proc: string | number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    pm2.delete(proc, function (error: Error) {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export const pm2x = {
  start: pm2Start,
  stop: pm2Stop,
  restart: pm2Restart,
  delete: pm2Delete,
  list: pm2List,
  // reload: pm2Reload,
  // describe: pm2Describe,
  // connect: promisify(pm2.connect),
  // disconnect: promisify(pm2.disconnect),
};



function exitJob() {
  const { parentPort } = workerThreads;
  if (parentPort) parentPort.postMessage('done');
  else process.exit(0);
}

function getWorkerData(): any {
  const { workerData } = workerThreads;
  return workerData;
}

type JobLogger = (msg: string) => void;

function getJobLogger(jobFilename: string): JobLogger {
  const infoLogger = getServiceLogger(`job:${jobFilename}`).info;

  function jobLogger(msg: string): void {
    const { threadId, isMainThread } = workerThreads;
    const d = new Date();

    const localTime = d.toLocaleTimeString();
    const threadStr = isMainThread ? 't#main' : `t#${threadId}`;
    if (parentPort !== null) {
      parentPort.postMessage(`${localTime} [job:${jobFilename}:${threadStr}] - ${msg}`);
      return;
    }
    infoLogger(msg);
  }

  return jobLogger;
}

export async function runJob(
  jobFilename: string,
  jobFunc: (logger: JobLogger, workerData: any) => void | Promise<void>
): Promise<void> {
  const baseName = path.basename(jobFilename);
  const baseNoExt = baseName.substring(0, baseName.length - 3);
  const log: JobLogger = getJobLogger(baseNoExt);

  const workerData = getWorkerData();
  // const wdPretty = prettyFormat({ workerData, workerThreads})
  const args: string[] = workerData.job?.worker?.argv || [];

  log(`Begin: PM2/RunJob ${baseNoExt}: ${args.join(' ')}`);

  await Promise.resolve(jobFunc(log, workerData));

  log(`Done: PM2/RunJob '${baseNoExt}'`);
  exitJob();
}
