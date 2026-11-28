import { tokensToIdentifier } from './NumberNormalizer';

function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
    for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[a.length][b.length];
}

/**
 * Resolve spoken waypoint tokens against active airport fixes, procedures,
 * and VFR reporting points. Never invents a waypoint.
 *
 * @param {Array<string>} tokens
 * @param {Array<string>} availableWaypoints
 * @returns {{ status: 'resolved'|'ambiguous'|'not_found', waypoint: string|null, candidates: Array<string> }}
 */
export function resolveWaypoint(tokens, availableWaypoints = []) {
    if (!Array.isArray(tokens) || !tokens.length || !availableWaypoints.length) {
        return { status: 'not_found', waypoint: null, candidates: [] };
    }

    const catalog = [...new Set(availableWaypoints.map((w) => String(w).trim().toUpperCase()).filter(Boolean))];
    const rawUpper = tokens.join('').replace(/[^a-z0-9]/gi, '').toUpperCase();
    const phoneticUpper = tokensToIdentifier(tokens);

    // 1. Exact match (raw or phonetic-spelled)
    for (const candidate of [rawUpper, phoneticUpper]) {
        if (candidate && catalog.includes(candidate)) {
            return { status: 'resolved', waypoint: candidate, candidates: [candidate] };
        }
    }

    // 2. Fuzzy phonetic match (max edit distance 1 for <=5 chars, 2 for longer)
    const target = rawUpper.length >= 3 ? rawUpper : phoneticUpper;
    if (!target || target.length < 3) {
        return { status: 'not_found', waypoint: null, candidates: [] };
    }

    const maxDist = target.length <= 5 ? 1 : 2;
    const scored = [];
    for (let i = 0; i < catalog.length; i += 1) {
        const wp = catalog[i];
        if (Math.abs(wp.length - target.length) > maxDist) continue;
        const dist = editDistance(target, wp);
        if (dist <= maxDist) scored.push({ wp, dist });
    }

    if (!scored.length) {
        return { status: 'not_found', waypoint: null, candidates: [] };
    }

    scored.sort((a, b) => a.dist - b.dist);
    const bestDist = scored[0].dist;
    const best = scored.filter((s) => s.dist === bestDist).map((s) => s.wp);

    if (best.length === 1) {
        return { status: 'resolved', waypoint: best[0], candidates: best };
    }

    return { status: 'ambiguous', waypoint: null, candidates: best };
}
