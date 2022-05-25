import _ from 'lodash';

import { Logger } from 'winston';
import { Page } from 'puppeteer';

import { taskflow as ft } from '@watr/commonlib';
import { BrowserInstance, BrowserPool } from './browser-pool';
import { UrlFetchData } from './url-fetch-chains';


export interface ExtractionSharedEnv {
  log: Logger;
  browserPool: BrowserPool;
  urlFetchData?: UrlFetchData;
};

export interface ExtractionEnv extends ExtractionSharedEnv {
  ns: string[];
  entryPath: string;
  urlFetchData: UrlFetchData;
  fileContentCache: Record<string, any>;
  browserPageCache: Record<string, Page>;
  browserInstance: BrowserInstance;
  enterNS(ns: string[]): void;
  exitNS(ns: string[]): void;
};

const fp = ft.createFPackage<ExtractionEnv>();

export const {
  tap,
  tapLeft,
  tapEitherEnv,
  through,
  log,
  filter,
  ClientFunc,
  Transform,
  forEachDo,
  attemptEach,
  takeWhileSuccess,
  collectFanout,
} = fp;

// export type ControlInstruction = ft.ControlInstruction;

type EnvT = ExtractionEnv;

export type ExtractionTask<A> = ft.ExtractionTask<A, EnvT>;
// export type PerhapsW<A> = ft.PerhapsW<A, EnvT>;
// export type ClientFunc<A, B> = ft.ClientFunc<A, B, EnvT>;
// export type ClientResult<A> = ft.ClientResult<A>;
export type Transform<A, B> = ft.Transform<A, B, EnvT>;
export type FilterTransform<A> = ft.FilterTransform<A, EnvT>;

export type ExtractionRule = (ra: ExtractionTask<unknown>) => ExtractionTask<unknown>;

export const compose = ft.compose;