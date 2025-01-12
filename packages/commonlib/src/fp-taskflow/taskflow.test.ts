import _ from 'lodash';

import * as TE from 'fp-ts/TaskEither';
import { isRight } from 'fp-ts/Either';
import Async from 'async';
import { flow as compose, pipe } from 'fp-ts/function';
import * as ft from './taskflow';
import { prettyPrint } from '~/util/pretty-print';
import { asyncEachOf } from '~/util/async-plus';
import { setLogEnvLevel } from '~/util/basic-logging';


interface EnvT extends ft.BaseEnv {
  b: boolean;
  messages: string[];
}

function initEnv<A>(a: A): ExtractionTask<A> {
  const baseEnv = ft.initBaseEnv('first-env');
  const env0: EnvT = {
    ...baseEnv,
    b: true,
    messages: []
  };

  return TE.right(asW(a, env0));
}

interface OtherEnvT extends ft.BaseEnv {
  otherField: boolean;
}

function initOtherEnv(): OtherEnvT {
  const baseEnv = ft.initBaseEnv('other-env');
  const env: OtherEnvT = {
    ...baseEnv,
    otherField: true
  };

  return env;
}

interface Env3T extends ft.BaseEnv {
  env3Field: number;
}

function initEnv3(): Env3T {
  const baseEnv = ft.initBaseEnv('third-env');
  const env: Env3T = {
    ...baseEnv,
    env3Field: 42
  };

  return env;
}
async function initEnv3Promise(): Promise<Env3T> {
  return initEnv3();
}
const fp = ft.createFPackage<EnvT>();

const fpOther = ft.createFPackage<OtherEnvT>();
const fpEnv3 = ft.createFPackage<Env3T>();

type ExtractionTask<A> = ft.ExtractionTask<A, EnvT>;
type Transform<A, B> = ft.Transform<A, B, EnvT>;
type PerhapsW<A> = ft.PerhapsW<A, EnvT>;
// type FilterTransform<A> = ft.FilterTransform<A, EnvT>;

const {
  tap,
  tapLeft,
  tapEitherEnv,
  filter,
  Transform,
  through,
  asW,
  mapEnv,
  forEachDo,
  attemptEach,
  takeWhileSuccess,
  collectFanout,
} = fp;


const withMessage: <A, B>(name: string, arrow: Transform<A, B>) => Transform<A, B> = (name, arrow) => compose(
  // ra,
  tap((_a, env) => env.messages.push(`${name}:enter:right`)),
  tapLeft((_a, env) => env.messages.push(`${name}:enter:left`)),
  arrow,
  tap((_a, env) => env.messages.push(`${name}:exit:right`)),
  tapLeft((_a, env) => env.messages.push(`${name}:exit:left`)),
);


// const fgood: (s: string) => Transform<string, string> = s => withMessage(`succ:${s}`, filter<string>(() => true));
const fbad: (s: string) => Transform<string, string> = s => withMessage(`fail:${s}`, filter<string>(() => false));
const fgood_: Transform<string, string> = withMessage('succ', filter<string>(() => true));
const fbad_: Transform<string, string> = withMessage('fail', filter<string>(() => false));
const emit = (msg: string) => tap<string>((_a, env) => env.messages.push(msg));
const emitL = (msg: string) => tapLeft<string>((_a, env) => env.messages.push(msg));




function getEnvMessages(res: PerhapsW<unknown>): string[] {
  if (isRight(res)) {
    const [, env] = res.right;
    return env.messages;
  }
  const [, env] = res.left;
  return env.messages;
}

let dummy = 0;
async function runTakeWhileSuccess(fns: Transform<string, string>[]): Promise<string[]> {
  const res = await takeWhileSuccess(...fns)(initEnv(`input#${dummy += 1}`))();
  return getEnvMessages(res);
}


async function runTakeFirstSuccess(fns: Transform<string, string>[]): Promise<string[]> {
  const res = await attemptEach(...fns)(initEnv(`input#${dummy += 1}`))();
  return getEnvMessages(res);
}

async function runGatherSuccess(fns: Transform<string, string>[]): Promise<string[]> {
  const res = await collectFanout(...fns)(initEnv(`input#${dummy += 1}`))();
  return getEnvMessages(res);
}


describe('Extraction Prelude / Primitives', () => {
  // it('should create basic arrows/results', async (done) => {});
  // it('tap() composition', async (done) => { });

  type ExampleType = [Transform<string, string>[], string[]];
  setLogEnvLevel('verbose')

  it('takeWhileSuccess examples', async () => {
    const examples: ExampleType[] = [
      [[emit('A:okay'), fbad_, emit('B:bad')],
      ['A:okay']],
      [[emit('A:okay'), emit('B:okay'), fbad_, emit('B:bad')],
      ['A:okay', 'B:okay']],
      [[emit('A:okay'), fgood_, emit('B:okay'), fbad_, emitL('CL:okay')],
      ['A:okay', 'B:okay', 'CL:okay']],
      [[fbad_, emit('B:bad')],
      []],
    ];


    await Async.eachOf(examples, Async.asyncify(async (ex: ExampleType) => {
      const [example, expectedMessages] = ex;
      const messages = await runTakeWhileSuccess(example);

      const haveExpectedMessages = _.every(expectedMessages, em => messages.includes(em));
      const haveBadMessages = _.some(messages, msg => /bad/.test(msg));

      // prettyPrint({ msg: `example: ${n}`, messages, expectedMessages });

      expect(haveExpectedMessages).toBe(true);
      expect(haveBadMessages).toBe(false);
    }));


    // done();
  });

  it('attemptEach examples', async () => {
    const examples: Array<[Transform<string, string>[], string[]]> = [
      // Always stop at first emit:
      [[emit('A:okay'), emit('B:bad')],
      ['A:okay']],
      [[emit('A:okay'), fgood_, emit('B:bad')],
      ['A:okay']],
      [[emit('A:okay'), fbad_, emit('B:bad')],
      ['A:okay']],

      // Skip any initial failures
      [[fbad('1'), emit('A:okay'), emit('B:bad')],
      ['A:okay']],

      [[fbad('2'), fbad('3'), emit('A:okay'), emit('B:bad')],
      ['A:okay']],

      [[fbad_, fgood_, emit('A:okay'), emit('B:bad')],
      []],

    ];


    await Async.eachOf(examples, Async.asyncify(async (ex: ExampleType) => {
      const [example, expectedMessages] = ex;
      const messages = await runTakeFirstSuccess(example);
      const haveExpectedMessages = _.every(expectedMessages, em => messages.includes(em));
      const haveBadMessages = _.some(messages, msg => /bad/.test(msg));

      // prettyPrint({ msg: `example: ${n}`, messages, expectedMessages });

      expect(haveExpectedMessages).toBe(true);
      expect(haveBadMessages).toBe(false);
    }));


    // done();
  });

  it('collectFanout examples', async () => {
    const examples: Array<[Transform<string, string>[], string[]]> = [
      [[emit('A:okay'), emit('B:okay')],
      ['A:okay', 'B:okay']],
      [[emit('A:okay'), fgood_, emit('B:okay')],
      ['A:okay', 'B:okay']],
      [[emit('A:okay'), fbad_, emit('B:okay')],
      ['A:okay', 'B:okay']],
      [[fbad_, fgood_, emit('A:okay'), fbad_, emit('B:okay'), fbad_],
      ['A:okay', 'B:okay']],
    ];


    await Async.eachOf(examples, Async.asyncify(async (ex: ExampleType) => {

      const [example, expectedMessages] = ex;
      const messages = await runGatherSuccess(example);
      const haveExpectedMessages = _.every(expectedMessages, em => messages.includes(em));
      const haveBadMessages = _.some(messages, msg => /bad/.test(msg));

      expect(haveExpectedMessages).toBe(true);
      expect(haveBadMessages).toBe(false);
    }));


  });


  it('forEachDo examples', async () => {
    // Expected results for n=[1..4]
    const expected: Array<string[]> = [
      // if n % 1 === 0 output 'n:okay'
      ['1:okay', '2:okay', '3:okay', '4:okay'],
      // if n % 2 === 0 output 'n:okay'
      ['2:okay', '4:okay'],
      ['3:okay'],
      ['4:okay'],
    ];

    const filterMod0 = (mod: number) => compose(
      filter<number>((n) => n % mod === 0, '% mod?==0'),
      through((n) => `${n}:okay`, 'modOkay')
    );

    await asyncEachOf(expected, async (exp: string[], index) => {
      const n = index + 1;
      const inputs = _.map(_.range(4), i => i + 1);
      prettyPrint({ inputs });
      const env0 = initEnv(inputs);
      const res = await forEachDo(filterMod0(n))(env0)();
      if (isRight(res)) {
        const [finalValue] = res.right;
        // prettyPrint({ msg: `example: ${n}`, finalValue });
        expect(finalValue).toStrictEqual(exp);
      } else {
        fail('!right(res');
      }
    });

  });

  it('should map env types', async () => {
    const inputs = _.map(_.range(4), i => i + 1);
    const env0 = initEnv(inputs);
    const otherEnv = initOtherEnv();
    const runnable = pipe(
      env0,
      tapEitherEnv(e => {
        e.messages
        e.log.info('hello from env')
      }),
      mapEnv((_e) => otherEnv, (_e, _a) => otherEnv),
      fpOther.tapEitherEnv(e => {
        e.log.info(`hello from other env ${e.otherField}`)
      }),
      fpOther.mapEnv((_envLeft) => initEnv3(), (_envRight, _a) => initEnv3Promise()),
      fpEnv3.tapEitherEnv(e => {
        e.log.info(`hello from other env ${e.env3Field}`);
      }),
    )
    await runnable()
  });
});
