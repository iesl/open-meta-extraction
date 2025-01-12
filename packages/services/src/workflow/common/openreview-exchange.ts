import _ from 'lodash';

import axios from 'axios';

import {
  AxiosRequestConfig,
  AxiosInstance,
  AxiosError
} from 'axios';

type ErrorTypes = AxiosError | unknown;

import {
  initConfig
} from '@watr/commonlib';

import { Logger } from 'winston';

export interface User {
  id: string;
}

export interface Credentials {
  token: string;
  user: User;
}

export interface NoteContent {
  'abstract'?: string;
  html?: string; // this is a URL
  venueid: string;
  title: string;
  authors: string[];
  authorids: string[];
  venue: string;
  _bibtex: string;
}

export interface Note {
  id: string;
  content: NoteContent;
}

export interface Notes {
  notes: Note[];
  count: number;
}

export interface MessagePostData {
  subject: string;
  message: string,
  groups: string[];
}

export const OpenreviewStatusGroup = 'OpenReview.net/Status';


export interface OpenReviewExchange {
  credentials?: Credentials;
  configRequest(): AxiosRequestConfig;
  configAxios(): AxiosInstance;
  getCredentials(): Promise<Credentials>;
  postLogin(user: string, password: string): Promise<Credentials>;
  apiGET<R>(url: string, query: Record<string, string | number>, retries?: number): Promise<R | undefined>;
  apiPOST<PD extends object, R>(url: string, postData: PD, retries?: number): Promise<R | undefined>;
  postStatusMessage(subject: string, message: string): Promise<void>;
  log: Logger;
}

// Send emails using the POST /messages endpoint.
// The body of the request requires
// { subject: <Some Status Title>, message: <Body>, groups: [ 'OpenReview.net/Status' ] }

export function makeMessagePost(subject: string, message: string): MessagePostData {
  return {
    subject,
    message,
    groups: [OpenreviewStatusGroup]
  };
}

export function newOpenReviewExchange(log: Logger): OpenReviewExchange {
  const config = initConfig();
  const OpenReviewAPIBase = config.get('openreview:restApi');

  return {
    log,
    configRequest(): AxiosRequestConfig {
      let auth = {};
      if (this.credentials) {
        auth = {
          Authorization: `Bearer ${this.credentials.token}`
        };
      }

      const config: AxiosRequestConfig = {
        baseURL: OpenReviewAPIBase,
        headers: {
          'User-Agent': 'open-extraction-service',
          ...auth
        },
        timeout: 10000,
        responseType: 'json'
      };

      return config;
    },

    configAxios(): AxiosInstance {
      const conf = this.configRequest();
      return axios.create(conf);
    },

    async getCredentials(): Promise<Credentials> {
      if (this.credentials !== undefined) {
        return this.credentials;
      }
      const user = config.get('openreview:restUser');
      const password = config.get('openreview:restPassword');

      this.log.info(`Logging in as ${user}`);
      if (user === undefined || password === undefined) {
        return Promise.reject(new Error('Openreview API: user or password not defined'));
      }
      const creds = await this.postLogin(user, password);

      this.log.info(`Logged in as ${creds.user.id}`);

      this.credentials = creds;
      return creds;
    },

    async postLogin(user: string, password: string): Promise<Credentials> {
      return this.configAxios()
        .post('/login', { id: user, password })
        .then(r => r.data)
        .catch(displayRestError);
    },

    async apiGET<R>(url: string, query: Record<string, string | number>, retries: number = 1): Promise<R | undefined> {
      await this.getCredentials();
      return this.configAxios()
        .get(url, { params: query })
        .then(response => {
          const { data } = response;
          return data;
        })
        .catch(error => {
          displayRestError(error);
          this.credentials = undefined;
          this.log.warn(`apiGET ${url}: retries=${retries} `);
          if (retries <= 0) {
            return undefined;
          }
          return this.apiGET(url, query, retries - 1);
        });
    },

    async apiPOST<PD extends object, R>(url: string, postData: PD, retries: number = 1): Promise<R | undefined> {
      await this.getCredentials();
      return this.configAxios()
        .post(url, postData)
        .then(response => {
          const { data } = response;
          return data;
        })
        .catch(error => {
          displayRestError(error);
          this.credentials = undefined;
          this.log.warn(`apiPOST ${url}: retries=${retries} `);
          if (retries <= 0) {
            return undefined;
          }
          return this.apiPOST(url, postData, retries - 1);
        });
    },
    async postStatusMessage(subject: string, message: string): Promise<void> {
      const mp = makeMessagePost(subject, message);
      this.log.info(`Sending message ${mp.subject}`);
      await this.apiPOST('/messages', mp);
      this.log.info(`Sent message ${mp.subject}`);
    }
  };
}

export function isAxiosError(error: any): error is AxiosError {
  return error['isAxiosError'] !== undefined && error['isAxiosError'];
}

export function displayRestError(error: ErrorTypes): void {
  if (isAxiosError(error)) {
    console.log('HTTP Request Error: ');
    const { response } = error;
    if (response !== undefined) {
      const { status, statusText, data } = response;
      console.log(`Error: ${status}/${statusText}`);
      console.log(data);
    }
    return;
  }

  console.log(error);
}
