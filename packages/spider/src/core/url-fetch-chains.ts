import _ from 'lodash';

import {
  HTTPRequest, HTTPResponse,
} from 'puppeteer';

export interface UrlChainLink {
  requestUrl: string;
  responseUrl?: string;
  status: string;
  timestamp: string;
}

export type UrlChain = UrlChainLink[];

export interface UrlFetchData extends UrlChainLink {
  responseUrl: string;
  fetchChain: UrlChain;
}

export function getUrlChainFromRequest(request: HTTPRequest): UrlChain {
  const reqRedirectChain = request.redirectChain();
  const urlChain = _.flatMap(reqRedirectChain, req => {
    const requestUrl = req.url();
    const resp = req.response();

    if (resp === null) {
      return [];
    }

    const responseChainHeaders = resp.headers();
    const status = resp.status().toString();

    const { location, date } = responseChainHeaders;

    const chainLink: UrlChainLink = {
      requestUrl,
      responseUrl: location,
      status,
      timestamp: date
    };
    return [chainLink];
  });
  return urlChain;
}


export function getFetchDataFromResponse(requestUrl: string, response: HTTPResponse): UrlFetchData {
  const request: HTTPRequest = response.request();
  const fetchChain = getUrlChainFromRequest(request);

  const responseUrl = response.url();
  const status = response.status().toString();
  const { date } = response.headers();

  const metadata: UrlFetchData = {
    requestUrl,
    responseUrl,
    status,
    fetchChain,
    timestamp: date,
  };
  return metadata;
}
