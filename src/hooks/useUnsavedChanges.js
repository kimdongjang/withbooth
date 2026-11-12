import { useEffect, useRef } from 'react';
import { confirmAction } from '../utils/confirmAction';
const guards = new Set();
let checking;
// A guard asks before in-app navigation only while it is dirty and the user has not
// already agreed to leave (or saved) since it became dirty.
const active = guard => guard.current.dirty && !guard.current.dismissed && guard.current.navigation;
export async function allowNavigation() {
  if (![...guards].some(active)) return true;
  if (checking) return checking;
  checking = confirmAction('작성 중인 내용이 초기화됩니다. 다른 화면으로 이동할까요?', { title: '작성 중인 내용이 있습니다', confirmLabel: '이동', danger: false });
  const result = await checking; checking = null;
  if (result) guards.forEach(guard => { if (guard.current.dirty) guard.current.dismissed = true; });
  return result;
}
// navigation:false keeps only the page-unload warning, for state that survives in-app navigation.
export function useUnsavedChanges(dirty, { navigation = true } = {}) {
  const guard = useRef({ dirty: false, dismissed: false, navigation });
  // Content that became clean (saved, emptied) asks again on its next edit.
  if (!dirty) guard.current.dismissed = false;
  guard.current.dirty = Boolean(dirty);
  guard.current.navigation = navigation;
  useEffect(() => {
    guards.add(guard);
    const beforeUnload = event => { if (guard.current.dirty && !guard.current.dismissed) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { guards.delete(guard); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return () => { guard.current.dismissed = true; };
}
