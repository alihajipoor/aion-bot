/**
 * Mafia Scum — the public face of the module.
 *
 * Three files, three jobs, and the seam between them is the point:
 *
 *   rules.ts    pure. Resolves a night, counts a vote, fires a gun. Knows
 *               nothing about Discord, and is where the tests live.
 *   narrate.ts  turns a resolved night into what the town is allowed to hear,
 *               and separately into the full account only God reads.
 *   console.ts  the buttons, the DMs and the phase machine.
 *
 * Call sites import from here rather than reaching into a file, so the day the
 * console is split in two nothing outside this folder has to change.
 *
 * What events/index.ts needs, and nothing else:
 *
 *   SCUM_ID                      custom-id prefix — route `sc|…` here
 *   scumComponent(i)             every button and select in that namespace
 *   scumModal(i)                 modal submits — a different interaction kind
 *   scumConsole(ev, note?)       God's ephemeral panel, for the panel button
 *   startScum(guild, ev)         seed state on an already-dealt roster
 *   endScum(guild, ev)           teardown: release the voice holds
 *   setScumFinisher(fn)          hand in the event finisher (avoids a cycle)
 *   setScumLimits(id, cfg)       write God's per-role limits before the start
 *   isScum(ev)                   is this event running Scum?
 */
export {
  SCUM_ID,
  scumComponent,
  scumModal,
  scumConsole,
  startScum,
  endScum,
  setScumFinisher,
  isScum,
  // Pure helpers, exported because the flow tests exercise them directly.
  limitFor,
  seedUses,
  mergeUses,
  usesLeft,
  ballotFor,
  voteProgress,
  gunLiveFrom,
  canFireGun,
  gunEligible,
  isDaylight,
  nextDefender,
  vetoCandidate,
  nightTargets,
  nightActors,
  pendingBlock,
  tallyLines,
  type ScumPhase,
  type ScumPending,
  type ScumLimits,
  type ScumState,
  type ScumPick,
  type Seat,
} from './console.js';

export {
  SCUM_ROLES,
  roleOf,
  resolveNight,
  resolveDayVote,
  terroristTriggers,
  fireGun,
  counts,
  canDisable,
  MANDATORY_ROLES,
  type RoleKey,
  type ScumRole,
  type Side,
  type Team,
  type Limits,
  type Gun,
  type NightState,
  type NightPlayer,
  type NightAction,
  type NightResult,
  type ActionLog,
  type Outcome,
  type DetectiveAnswer,
  type VoteOutcome,
  type VoteTally,
  type Removal,
  type Countable,
} from './rules.js';

export { publicFacts, nightStory, godRecap, type PublicFacts } from './narrate.js';

/*
 * Dealing. Kept under its own custom-id namespace rather than SCUM_ID: an
 * unknown step falls through the console's host check, and the Traitor's own
 * side-pick DM would be answered with "faghat gardanande".
 */
export {
  SCUM_DEAL_ID, scumDealComponent, dealScum, distribution, mafiaCount,
  grayAllowance, dealtCounts, limitsFrom, traitorSides, traitorSideOf,
  GRAY_ONE, GRAY_BOTH, asDealt,
  type ScumDealConfig, type DealResult, type Shuffle,
  setScumLimits,
} from './deal.js';
