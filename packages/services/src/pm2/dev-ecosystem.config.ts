import { pm2CliJob } from './eco-helpers';
import _ from 'lodash';


const apps = [
  pm2CliJob('run-relay-extract', { args: '--count 4' }),
  pm2CliJob('run-relay-fetch', { args: '--count 4' }),
  pm2CliJob('scheduler'),
  pm2CliJob('preflight-check', { autorestart: false })
];


module.exports = {
  apps
};
