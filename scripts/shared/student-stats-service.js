/**
 * Shared Institutional Student Count & Summary Helpers
 * Keeps summary reads consistent across Public Portal, Official Hub, Dashboard, and Admin Panel
 * using the single `settings/config.stats` object to prevent unnecessary collection reads.
 */

export const normalizeByClassStats = (rawByClass = {}) => {
    const out = {};
    if (!rawByClass || typeof rawByClass !== 'object') return out;
    Object.keys(rawByClass)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .forEach((cls) => {
            const entry = rawByClass[cls];
            if (!entry || typeof entry !== 'object') return;
            const male = Number(entry.male) || 0;
            const female = Number(entry.female) || 0;
            const total = entry.total !== undefined && entry.total !== null ? (Number(entry.total) || 0) : (male + female);
            out[cls] = { male, female, total };
        });
    return out;
};

export const normalizeInstitutionalStats = (rawStats = {}) => {
    const src = (rawStats && typeof rawStats === 'object') ? rawStats : {};
    const byClass = normalizeByClassStats(src.byClass);
    const classKeys = Object.keys(byClass);
    const hasStats = src.total !== undefined && src.total !== null;
    const male = Number(src.male) || 0;
    const female = Number(src.female) || 0;
    const total = hasStats ? (Number(src.total) || 0) : 0;
    const activeClassesCount = Number.isFinite(Number(src.activeClassesCount))
        ? Number(src.activeClassesCount)
        : classKeys.length;
    const configuredClassesCount = Number.isFinite(Number(src.configuredClassesCount))
        ? Number(src.configuredClassesCount)
        : activeClassesCount;

    return {
        hasStats,
        academicYear: String(src.academicYear || '').trim(),
        total,
        male,
        female,
        activeClassesCount,
        configuredClassesCount,
        byClass,
        updatedAt: Number(src.updatedAt) || 0,
        syncMode: String(src.syncMode || '')
    };
};

export const areInstitutionalStatsEqual = (a, b) => {
    if (!a || !b) return false;
    const na = normalizeInstitutionalStats(a);
    const nb = normalizeInstitutionalStats(b);
    if (!na.hasStats || !nb.hasStats) return false;
    if (na.academicYear !== nb.academicYear) return false;
    if (na.total !== nb.total || na.male !== nb.male || na.female !== nb.female) return false;
    if (na.activeClassesCount !== nb.activeClassesCount) return false;

    const keysA = Object.keys(na.byClass);
    const keysB = Object.keys(nb.byClass);
    if (keysA.length !== keysB.length) return false;
    for (let i = 0; i < keysA.length; i += 1) {
        const k = keysA[i];
        if (k !== keysB[i]) return false;
        const ca = na.byClass[k];
        const cb = nb.byClass[k];
        if (!cb || ca.male !== cb.male || ca.female !== cb.female || ca.total !== cb.total) {
            return false;
        }
    }
    return true;
};
