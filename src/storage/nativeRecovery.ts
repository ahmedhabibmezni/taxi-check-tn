const KEY = 'taxi-check.native-recovery';

export function readCleanupRecovery(): 'clear' | 'blocked' | 'unavailable' {
  try { return localStorage.getItem(KEY) === 'cleanup' ? 'blocked' : 'clear'; }
  catch { return 'unavailable'; }
}

export function establishCleanupRecovery(): boolean {
  try {
    localStorage.setItem(KEY, 'cleanup');
    return localStorage.getItem(KEY) === 'cleanup';
  } catch { return false; }
}

export function readNativeRecovery(): 'clear' | 'blocked' | 'unavailable' {
  try { return localStorage.getItem(KEY) === null ? 'clear' : 'blocked'; }
  catch { return 'unavailable'; }
}

export function establishNativeRecovery(): boolean {
  try {
    localStorage.setItem(KEY, '1');
    return localStorage.getItem(KEY) === '1';
  } catch { return false; }
}

export function clearNativeRecovery(): boolean {
  try {
    localStorage.removeItem(KEY);
    return localStorage.getItem(KEY) === null;
  } catch { return false; }
}
