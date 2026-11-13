// ---------------------------------------------------------------------------
// How to run a command as root on this box.
//
// The agent normally runs AS root already (android/supervise.sh), so
// commands run directly through sh. Started as an ordinary user (e.g. by
// hand in Termux) it falls back to su — whose location and syntax differ
// between Android builds (/system/bin/su on the TX3, /system/xbin/su on the
// RK3568), but `su -c "<cmd>"` and `su 0 sh -c "<cmd>"` cover both.
// ---------------------------------------------------------------------------

const fs = require('fs')

let cached = null

/** → [program, argsBeforeCommand] — spawn(program, [...args, commandString]) */
function rootShell() {
  if (cached) return cached
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    cached = ['/system/bin/sh', ['-c']]
    return cached
  }
  const su = ['/system/bin/su', '/system/xbin/su', '/sbin/su'].find((p) => fs.existsSync(p))
  if (!su) throw new Error('Not running as root and no su binary found')
  // /system/bin/su (AOSP-derived, TX3) accepts -c; toybox-style su (RK) wants WHO first
  cached = su === '/system/bin/su' ? [su, ['-c']] : [su, ['0', '/system/bin/sh', '-c']]
  return cached
}

module.exports = { rootShell }
