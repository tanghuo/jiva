// Notices come from the session-state stream. A detail refresh of the open session can be newer.
export function applySessionNotice(sessions, notice) {
  if (!Array.isArray(sessions) || !notice || !Number.isFinite(notice.id) || !Number.isFinite(notice.revision)) return sessions;
  let changed = false;
  const next = sessions.map(session => {
    if (session.id !== notice.id || session.revision > notice.revision) return session;
    if (session.revision === notice.revision && session.state === notice.state && session.seq === notice.seq) return session;
    changed = true;
    return { ...session, state: notice.state, revision: notice.revision, seq: notice.seq };
  });
  return changed ? next : sessions;
}

export function applySessionNotices(sessions, notices) {
  if (!Array.isArray(sessions) || !notices?.size) return sessions;
  let changed = false;
  const next = sessions.map(session => {
    const [updated] = applySessionNotice([session], notices.get(session.id));
    if (updated !== session) changed = true;
    return updated;
  });
  return changed ? next : sessions;
}
