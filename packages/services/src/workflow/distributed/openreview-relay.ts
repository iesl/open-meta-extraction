import _ from 'lodash';

import Async from 'async';

import axios from 'axios';
import { AxiosError } from 'axios';
type ErrorTypes = AxiosError | unknown;


import {
  AxiosRequestConfig,
  AxiosInstance
} from 'axios';

import {
  CommLink,
  defineSatelliteService, SatelliteService
} from '@watr/commlinks';
import { ErrorRecord, URLRequest } from '../common/datatypes';
import { CanonicalFieldRecords } from '@watr/field-extractors';
import { WorkflowConductor } from './workers';
import { initConfig, prettyFormat, prettyPrint } from '@watr/commonlib';


interface User {
  id: string;
}

interface Credentials {
  token: string;
  user: User;
}

interface NoteContent {
  'abstract'?: string;
  html?: string; // this is a URL
  venueid: string;
}
interface Note {
  id: string;
  content: NoteContent;
}
interface Notes {
  notes: Note[];
  count: number;
}

interface NoteBatch {
  notes: Note[];
  initialOffset: number;
  finalOffset: number;
  availableNoteCount: number;
  summary: Record<string, number>;
  errors: string[];
}

type NumNumNum = [number, number, number];

// interface QueryFields {
//   invitation: 'dblp.org/-/record';
//   sort: 'number:desc';
//   offset: number;
// }

const config = initConfig();

const OpenReviewAPIBase = config.get('openreview:restApi');

class OpenReviewRelay {
  credentials?: Credentials;
  commLink: CommLink<SatelliteService<OpenReviewRelay>>;
  constructor(commLink: CommLink<SatelliteService<OpenReviewRelay>>) {
    this.commLink = commLink;
  }

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
        "User-Agent": "open-extraction-service",
        ...auth
      },
      timeout: 10000,
      responseType: "json"
    };

    return config;
  }

  configAxios(): AxiosInstance {
    const conf = this.configRequest();
    return axios.create(conf);
  }

  async getCredentials(): Promise<Credentials> {
    if (this.credentials !== undefined) {
      return this.credentials;
    }
    const user = config.get('openreview:restUser');
    const password = config.get('openreview:restPassword');
    this.commLink.log.info(`User/Password: ${user} ${password}`)
    if (user === undefined || password === undefined) {
      return Promise.reject(new Error(`Openreview API: user or password not defined`))
    }
    const creds = await this.postLogin(user, password);
    this.credentials = creds;
    return creds;
  }

  async postLogin(user: string, password: string): Promise<Credentials> {
    return this.configAxios()
      .post("/login", { id: user, password })
      .then(r => r.data)
      .catch(displayRestError)
  }


  async doUpdateNote(): Promise<void> {
  }

  async apiGET<R>(url: string, query: Record<string, string | number>, retries: number = 0): Promise<R | undefined> {
    return this.configAxios()
      .get(url, { params: query })
      .then(response => {
        const { data } = response;
        return data;
      })
      .catch(error => {
        displayRestError(error);
        this.credentials = undefined;
        this.commLink.log.warn(`apiGET ${url}: retries=${retries} `)
        if (retries > 1) {
          return undefined;
        }
        return this.apiGET(url, query, retries + 1);
      });
  }

  async doFetchNotes(offset: number): Promise<Notes> {
    return this.apiGET<Notes>('/notes', { invitation: 'dblp.org/-/record', sort: 'number:desc', offset })
  }

  async doRunRelay(): Promise<void> {
    this.commLink.log.info('relay.doRunRelay()');
    let offset = 0;
    const batchSize = 1000;
    const noteBatch = await this.createNoteBatch(offset, batchSize);

    const { notes } = noteBatch;

    const foundAbstracts: Note[] = [];
    const allErrors: string[] = [];

    const byHostSuccFailSkipCounts: Record<string, NumNumNum> = {};

    await Async.eachOfSeries(notes, Async.asyncify(async (note: Note) => {
      this.commLink.log.info('doRunRelay/attemptExtractNote');
      const [maybeAbs, errors] = await this.attemptExtractNote(note, byHostSuccFailSkipCounts);
      allErrors.push(...errors);
      if (maybeAbs===undefined) {
        return;
      }
      foundAbstracts.push(note);
    }));

    prettyPrint({ byHostSuccFailSkipCounts, allErrors });
    this.commLink.log.info('DONE: relay.doRunRelay()');
  }

  async attemptExtractNote(note: Note, byHostSuccFailSkipCounts: Record<string, NumNumNum>): Promise<[string|undefined, string[]]> {
    this.commLink.log.debug(`attemptExtractNote(${note.id})`);
    const errors: string[] = [];

    const abs = note.content['abstract'];
    const urlstr = note.content['html'];
    const url = toUrl(urlstr);
    if (typeof url === 'string') {
      errors.push(url)
      return [undefined, errors];
    }
    const [prevSucc, prevFail, prevSkip] = _.get(byHostSuccFailSkipCounts, url.hostname, [0, 0, 0] as const);
    const arg = URLRequest(urlstr);

    if (prevFail > 3) {
      // don't keep processing failed domains
      errors.push('Previous failure count > 3; skipping.')
      byHostSuccFailSkipCounts[url.hostname] = [prevSucc, prevFail, prevSkip + 1];
      return [undefined, errors];
    }

    this.commLink.log.debug(`attemptExtractNote: runOneURLNoDB()`);
    const res: CanonicalFieldRecords | ErrorRecord = await this.commLink.call(
      'runOneURLNoDB', arg, { to: WorkflowConductor.name }
    );

    const pfres = prettyFormat(res)
    this.commLink.log.debug(`runOneURLNoDB() => ${pfres}`);

    if ('error' in res) {
      errors.push(res.error);
      byHostSuccFailSkipCounts[url.hostname] = [prevSucc, prevFail + 1, prevSkip];
      return [undefined, errors];
    }

    this.commLink.log.debug(`attemptExtractNote().1`);
    const abstracts = res.fields.filter((rec, i) => {
      rec.name === 'abstract'
    });
    const abstractsClipped = res.fields.filter((rec, i) => {
      rec.name === 'abstract-clipped'
    });

    this.commLink.log.debug(`attemptExtractNote().2`);
    const hasAbstract = abstracts.length > 0 || abstractsClipped.length > 0;
    if (!hasAbstract) {
      errors.push('no abstract found');
      byHostSuccFailSkipCounts[url.hostname] = [prevSucc, prevFail + 1, prevSkip];
      // return [undefined, errors];
      return ;
    }

    this.commLink.log.debug(`attemptExtractNote().3`);
    byHostSuccFailSkipCounts[url.hostname] = [prevSucc + 1, prevFail, prevSkip];
    const abstrct = abstracts[0] || abstractsClipped[0];

    this.commLink.log.debug(`attemptExtractNote().4`);
    return [abstrct.value, errors];
  }

  async createNoteBatch(_offset: number, batchSize: number): Promise<NoteBatch> {
    const log = this.commLink.log;
    let offset = _offset;
    const self = this;

    const notesWithUrlNoAbs: Note[] = [];
    const notesWithAbstracts: Note[] = [];
    const notesWithoutUrls: Note[] = [];
    log.info(`CreateNoteBatch: starting...`)
    let availableNoteCount = 0;

    await Async.doUntil(
      Async.asyncify(async function(): Promise<number> {
        try {
          const nextNotes: Notes = await self.doFetchNotes(offset);

          const { notes, count } = nextNotes;

          log.info(`fetched ${notes.length} (of ${count}) notes.`)

          availableNoteCount = count;
          offset += notes.length;

          notes.forEach(note => {
            const { id, content } = note;
            const abs = content.abstract;
            const { html, venueid } = content;
            if (html === undefined) {
              notesWithoutUrls.push(note);
              return;
            }
            if (abs === undefined) {
              notesWithUrlNoAbs.push(note);
              return;
            }
            notesWithAbstracts.push(note);
          });
          return notes.length;
        } catch (error) {
          return Promise.reject(error);
        }
      }),
      Async.asyncify(async function test(fetchLength: number): Promise<boolean> {
        log.info(`testing fetchLength = ${fetchLength}`)
        const atBatchLimit = notesWithUrlNoAbs.length >= batchSize;
        const doneFetching = fetchLength === 0;
        return doneFetching || atBatchLimit;
      })
    );
    const notesWithUrlNoAbsLen = notesWithUrlNoAbs.length;
    const notesWithAbstractsLen = notesWithAbstracts.length;
    const notesWithoutUrlsLen = notesWithoutUrls.length;

    const noteCounts: Record<string, number> = {
      notesWithUrlNoAbsLen,
      notesWithAbstractsLen,
      notesWithoutUrlsLen
    };

    const byHostCounts: Record<string, number> = {};

    const errors: string[] = [];

    notesWithUrlNoAbs.forEach(note => {
      const html = note.content.html;
      if (html === undefined) return;
      const url = toUrl(html);
      if (typeof url === 'string') {
        errors.push(url);
        return;
      }
      const { hostname } = url;
      const prevCount = byHostCounts[hostname];
      const newCount = prevCount === undefined ? 1 : prevCount + 1;
      byHostCounts[hostname] = newCount;
    });

    const summary = _.merge(noteCounts, byHostCounts);

    const noteBatch: NoteBatch = {
      notes: notesWithUrlNoAbs,
      initialOffset: _offset,
      finalOffset: offset,
      availableNoteCount,
      summary,
      errors
    }

    return noteBatch;
  }
}



// Pull data from OpenReview into abstract finder and post the
//   results back via HTTP/Rest API
export const OpenReviewRelayService = defineSatelliteService<OpenReviewRelay>(
  'OpenReviewRelayService',
  async (commLink) => {
    return new OpenReviewRelay(commLink);
  }, {
  async networkReady() {
    await this.cargo
      .getCredentials()
      .catch(error => {
        this.log.error(`Error: ${error}`);
      });
  },
  async startup() {
    this.commLink.log.info('relay startup');
    await this.cargo
      .doRunRelay()
      .catch(error => {
        this.log.warn(`Error: ${error}`);
      });
  },
  async shutdown() {
  }
});


function toUrl(instr: unknown): URL | string {
  if (typeof instr !== 'string') {
    return 'toURL error: input must be string';
  }
  const str = instr.trim();
  if (typeof str === 'string') {
    if (instr.includes(' ')) {
      return 'toURL error: input string has spaces';
    }

    try {
      return new URL(str); // eslint-disable-line no-new
    } catch (error) {
      return `toURL error: new URL() threw ${error}`;
    }
  }

}

function isAxiosError(error: unknown): error is AxiosError {
  return error['isAxiosError'] !== undefined && error['isAxiosError'];
}

function displayRestError(error: ErrorTypes): void {
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

// # We use the Super User, but we are going to create a separate user just for this script
// client = openreview.Client(baseurl = 'https://api.openreview.net', username = 'OpenReview.net', password = '')
//
// # Notes that will be updated with an abstract if they don't have one
// dblp_notes=openreview.tools.iterget_notes(client, invitation='dblp.org/-/record', sort='number:desc')
//
// for note in tqdm(dblp_notes):
//     if not note.content.get('abstract') and note.content.get('html'):
//         noteId=note.id
//         url=note.content['html']
//
//         # 10.128.0.33 is the local IP address of the server that hosts the abstract extraction service
//         response=requests.post('http://10.128.0.33/extractor/record.json', json={
//          "noteId": noteId,
//           "url": url
//         })
//
//         if response.status_code == 502:
//             print(f'{url}: 502 error, wait for 20 seconds and try again...')
//             time.sleep(20)
//             response=requests.post('http://10.128.0.33/extractor/record.json', json={
//              "noteId": noteId,
//               "url": url
//             })
//
//         if response.status_code == 200:
//             json_response = response.json()
//             for f in json_response.get('fields', []):
//                 if 'abstract' in f['name']:
//                     #print(noteId, f['value'])
//                     note = openreview.Note(
//                                 referent=noteId,
//                                 content={
//                                     'abstract': f['value']
//                                 },
//                                 invitation='dblp.org/-/abstract',
//                                 readers = ['everyone'],
//                                 writers = [],
//                                 signatures = ['dblp.org'])
//                     try:
//                         r=client.post_note(note)
//                     except:
//                         # If it fails because the token of the client expired, we retry with a new token
//                         client = openreview.Client(baseurl = 'https://api.openreview.net', username = 'OpenReview.net', password = '')
//                         r=client.post_note(note)
//         else:
//             print('Error', url, response)
