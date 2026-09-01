import { BACKEND_ORIGIN } from '../config/api';

let approvedDrugs = [];
let loadPromise = null;

// Memoised: useCdscoLookup awaits this on every debounced keystroke, and the
// register is static per deployment. The HTTP contract is unchanged.
export async function loadApprovedDrugs() {
	if (loadPromise) return loadPromise;
	loadPromise = (async () => {
		try {
			const response = await fetch(`${BACKEND_ORIGIN}/api/approved-drugs`);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (Array.isArray(data.drugs)) approvedDrugs = data.drugs;
		} catch (error) {
			console.warn('Approved drug list unavailable:', error.message);
			loadPromise = null; // allow a retry on the next call
		}
		return approvedDrugs;
	})();
	return loadPromise;
}

// True once the register has actually arrived. A "listed in neither register"
// verdict is only meaningful when both lists are in memory.
export function isApprovedListLoaded() {
	return approvedDrugs.length > 0;
}

export function searchApprovedDrugs(query, limit = 8) {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [];
	return approvedDrugs
		.filter(drug => drug.genericName.toLowerCase().includes(normalizedQuery))
		.slice(0, limit);
}

export function findApprovedDrug(genericName) {
	const normalizedName = genericName.trim().toLowerCase();
	if (!normalizedName) return null;
	return approvedDrugs.find(drug =>
		drug.genericName.trim().toLowerCase() === normalizedName
	) || null;
}
