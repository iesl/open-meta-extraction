import _ from 'lodash';

import Koa, { Context } from 'koa';
import koaBody from 'koa-body';
import Router from '@koa/router';
import json from 'koa-json';
import { Server } from 'http';
import { SatelliteCommLink } from '@watr/commlinks';
import { AlphaRecord, getServiceLogger, prettyFormat, URLRecord } from '@watr/commonlib';
import { RecordRequest, URLRequest } from '~/workflow/common/datatypes';
import { Logger } from 'winston';

export class RestPortal {
  port: number;
  app: Koa;
  server: Server | undefined;
  log: Logger;

  public constructor(app: Koa, port: number) {
    this.app = app;
    this.port = port;
    this.log = getServiceLogger('RestService');
  }

  async run(): Promise<void> {
    if (this.server !== undefined) {
      return;
    }
    const log = this.log;
    const port = this.port;

    this.server = this.app.listen(port, function() {
      log.info(`Koa is listening to http://localhost:${port}`);
    });
  }
  async close(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    return new Promise((resolve) => {
      server.on('close', () => resolve(undefined));
      server.close();
    });
  }
  async setCommLink(commLink: SatelliteCommLink<RestPortal>): Promise<void> {
    this.app.context.commLink = commLink;
    this.app.context.log = commLink.log;
  }
}

function getCommLink(ctx: Koa.DefaultContext): SatelliteCommLink<RestPortal> {
  return ctx.commLink;
}
function getLog(ctx: Koa.DefaultContext): Logger {
  return ctx.log;
}

export async function createRestServer(): Promise<RestPortal> {
  const app = new Koa();
  const rootRouter = new Router();
  const portalRouter = new Router({
    prefix: '/extractor'
  });

  app.use(async (ctx, next) => {
    const log = getLog(ctx);
    const { method, path } = ctx;
    log.info(`${method} ${path}`)
    await next();
    log.info(`completed: ${method} ${path}`)
  })

  portalRouter
    .get('/', getRoot)
    // .post('/record.json', koaBody(), postRecordJson)
    .post('/url', koaBody(), postURL)
    ;

  const port = 3100;

  rootRouter
    .use('/', ((ctx: Context, next) => {
      ctx.set('Access-Control-Allow-Origin', '*');
      return next();
    }))
    .use(portalRouter.routes())
    .use(portalRouter.allowedMethods())
    ;

  app
    .use(rootRouter.routes())
    .use(rootRouter.allowedMethods())
    .use(json({ pretty: false }))
    ;

  app.on('error', err => {
    console.error('server error', err)
  });

  return new RestPortal(app, port);
}

async function postURL(ctx: Context): Promise<void> {
  const commLink = getCommLink(ctx);
  const requestBody = ctx.request.body;
  const responseBody: Record<string, string> = {};
  ctx.response.body = responseBody;
  if (requestBody === undefined) {
    responseBody.status = 'error';
    responseBody.errors = 'Empty request body';
    return;
  }
  const decoded = URLRecord.decode(requestBody);
  if (_.isString(decoded)) {
    responseBody.status = 'error';
    responseBody.errors = `Request is not a valid url (${prettyFormat(requestBody, { colors: false })})`;
    return;
  }

  const url = decoded.url;
  const responseRec = await commLink.call('runOneURL', URLRequest(url));

  _.merge(responseBody, responseRec);
}

// async function postRecordJson(ctx: Context): Promise<void> {
//   const commLink = getCommLink(ctx);
//   const requestBody = ctx.request.body;
//   const responseBody: Record<string, string> = {};
//   ctx.response.body = responseBody;

//   if (requestBody) {
//     const decoded = AlphaRecord.decode(requestBody);
//     if (_.isString(decoded)) {
//       responseBody.status = 'error';
//       responseBody.errors = decoded;
//     } else {
//       const responseRec = await commLink.call('runOneAlphaRecNoDB', RecordRequest(decoded));
//       _.merge(responseBody, responseRec);
//     }

//   } else {
//     responseBody.status = 'error';
//     responseBody.errors = 'Empty request body';
//   }
// }

async function getRoot(ctx: Context): Promise<void> {
  const log = getLog(ctx);
  const p = ctx.path;
  log.info(`get / (${p})`);
}
