import { Readable } from 'stream';

import {
  initScraper,
  Scraper,
  UrlFetchData,
  CrawlScheduler,
  initCrawlScheduler
} from '@watr/spider';

import {
  streamPump, putStrLn, delay,
  AlphaRecord, readAlphaRecStream
} from '@watr/commonlib';

import * as E from 'fp-ts/Either';
import { DatabaseContext, insertAlphaRecords } from '~/db/db-api';
import { Logger } from 'winston';

export interface SpiderService {
  crawlScheduler: CrawlScheduler;
  scraper: Scraper;
  run(alphaRecordStream: Readable): Promise<Readable>; // Readable<UrlFetchData|undefined>
  scrape(url: string): Promise<UrlFetchData | undefined>;
  quit(): Promise<void>;
}

export async function createSpiderService(logger: Logger): Promise<SpiderService> {
  const scraper = await initScraper(logger);

  const crawlScheduler = initCrawlScheduler();

  const service: SpiderService = {
    scraper,
    crawlScheduler,
    async scrape(url: string): Promise<UrlFetchData | undefined> {
      return scraper.scrapeUrl(url)
        .then(resultOrError => {
          return E.match(
            (_err: string) => {
              console.warn('Scraping Result', _err);
              return undefined;
            },
            (succ: UrlFetchData) => succ
          )(resultOrError);
        });
    },
    async run(alphaRecordStream: Readable): Promise<Readable> {
      const urlCount = await crawlScheduler.addUrls(alphaRecordStream);
      const seedUrlStream = crawlScheduler.getUrlStream();
      let i = 0;
      return streamPump.createPump()
        .viaStream<string>(seedUrlStream)
        .throughF(async (urlString) => {
          logger.debug(`url ${i} of ${urlCount}`);
          i += 1;
          return scraper.scrapeUrl(urlString)
            .then((didScrape) => {
              if (didScrape) {
                return delay(1000);
              }
            })
            .catch((error) => logger.warn('Error', error))
          ;
        })
        .toReadableStream();
    },
    quit() {
      return scraper.quit();
    }
  };

  return service;
}

export async function insertNewAlphaRecords(
  dbCtx: DatabaseContext,
  alphaRecordCsv: string,
): Promise<void> {
  const inputStream = readAlphaRecStream(alphaRecordCsv);

  putStrLn('Reading CSV Records...');
  const alphaRecords = await streamPump.createPump()
    .viaStream<AlphaRecord>(inputStream)
    .gather()
    .toPromise();
  if (alphaRecords === undefined) {
    putStrLn(`No records found in CSV ${alphaRecordCsv}`);
    return;
  }

  putStrLn(`Inserting ${alphaRecords.length} Records`);
  const newRecs = await insertAlphaRecords(dbCtx, alphaRecords);
  const len = newRecs.length;
  putStrLn(`Inserted ${len} new records`);
}
