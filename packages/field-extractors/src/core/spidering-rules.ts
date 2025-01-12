import _ from 'lodash';

import {
    compose,
    ExtractionEnv,
} from '~/predef/extraction-prelude';

import {
    initExtractionEnv
} from '~/core/extraction-primitives';

import { HTTPResponse } from 'puppeteer';

import {
    ScriptablePageInstanceOptions,
    spiderTaskflow as sfp,
    scrapingPrimitives as spPrim,
    scrapingTaskflow as stflow,
    UrlFetchData,
    urlMatchAny,

} from '@watr/spider';


const emptyUrlFetchData: UrlFetchData = {
    responseUrl: '',
    fetchChain: [],
    requestUrl: '',
    status: '',
    timestamp: ''
};


type Transform<A, B> = stflow.Transform<A, B>

const {
    attemptEach,
    mapEnv,
} = sfp;

const {
    scrapeUrl,
    httpResponseToUrlFetchData,
    writeResponseBody,
    writePageFrames,
    cleanArtifacts,
} = spPrim;

const allowJSInBrowserUrls = [
    /linkinghub.elsevier.com/,
    /aaai.org/
];
const linkinghubSpideringRule: Transform<URL, HTTPResponse> = compose(
    urlMatchAny(allowJSInBrowserUrls),
    scrapeUrl(ScriptablePageInstanceOptions),
)

const defaultSpideringRule: Transform<URL, HTTPResponse> = compose(
    scrapeUrl(),
)

const SpideringUrlSpecificAttempts: Transform<URL, HTTPResponse> = attemptEach(
    linkinghubSpideringRule,
    defaultSpideringRule
)

export const SpiderToExtractionEnv = mapEnv<UrlFetchData, ExtractionEnv>(
    (env) => initExtractionEnv(env, emptyUrlFetchData),
    (env, urlFetchData) => initExtractionEnv(env, urlFetchData)
);

export const SpideringPipeline: Transform<URL, UrlFetchData> = compose(
    cleanArtifacts,
    SpideringUrlSpecificAttempts,
    writeResponseBody,
    writePageFrames,
    httpResponseToUrlFetchData,
);
