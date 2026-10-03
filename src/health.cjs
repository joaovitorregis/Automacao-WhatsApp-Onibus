'use strict';
function executorHealthy({schedulerRunning,pid,heartbeat,supervisionStatus,supervisionPid,now=Date.now()}) {
  if(!schedulerRunning || !Number.isInteger(pid) || pid<2 || heartbeat?.pid!==pid || supervisionStatus!==0 || supervisionPid!==pid) return false;
  const age=now-Date.parse(heartbeat.timestamp);
  return Number.isFinite(age) && age>=0 && age<240000;
}
function supervisorPid(output) {
  return Number(output?.match(/^run: .*: \(pid (\d+)\)/)?.[1]) || null;
}
module.exports={executorHealthy,supervisorPid};
