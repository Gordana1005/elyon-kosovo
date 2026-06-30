import { BotCommand } from './_types';

import { command as help } from './help';
import { command as order } from './order';
import { command as myday } from './myday';
import { command as reportdaily } from './reportdaily';
import { command as reportrange } from './reportrange';
import { command as leaderboard } from './leaderboard';
import { command as pending } from './pending';
import { command as mypending } from './mypending';
import { command as callbacksdue } from './callbacksdue';
import { command as mycallbacks } from './mycallbacks';
import { command as codoutstanding } from './codoutstanding';
import { command as health } from './health';
import { command as returns } from './returns';
import { command as cancellations } from './cancellations';
import { command as worktime } from './worktime';
import { command as myshift } from './myshift';
import { command as customer } from './customer';
import { command as pendingshipment } from './pendingshipment';
import { command as topproducts } from './topproducts';
import { command as calls } from './calls';
import { command as mystats } from './mystats';
import { command as mycommission } from './mycommission';
import { command as linkagent } from './linkagent';
import { command as unlinkagent } from './unlinkagent';
import { command as whoami } from './whoami';

export const commands: BotCommand[] = [
  // public
  help,
  // anchors + agent self-service
  order,
  myday,
  mypending,
  mycallbacks,
  myshift,
  mystats,
  mycommission,
  // team lead / admin reporting
  reportdaily,
  reportrange,
  leaderboard,
  pending,
  callbacksdue,
  codoutstanding,
  returns,
  cancellations,
  worktime,
  calls,
  topproducts,
  // admin / warehouse
  customer,
  pendingshipment,
  health,
  // identity management
  linkagent,
  unlinkagent,
  whoami,
];

export const commandMap = new Map<string, BotCommand>(commands.map((c) => [c.data.name, c]));
